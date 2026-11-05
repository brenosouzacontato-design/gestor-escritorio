"""Robô do Emissor (sistema.emissor.app): emite a NF-e de venda dos pedidos
que o cliente fez pelo app do gestor (?pedido=) e que o escritório aprovou
(Fiscal → Pedidos de NF-e → "Emitir pelo robô").

Para cada pedido na fila:
  1. entra no Emissor com a conta de parceiro do escritório (perfil do
     navegador guardado em /dados/emissor/perfil; se a sessão caiu, faz login
     com /dados/emissor/login.txt ou pede pela tela remota) e abre a empresa
     pelo CNPJ;
  2. garante o destinatário e os produtos no cadastro do Emissor (produto
     novo é criado com o NCM do pedido e o grupo tributário padrão da empresa);
  3. preenche a nota (destinatário, itens, frete, observação) e clica em
     "Gerar Nota" — ou, com EMISSOR_TRANSMITIR=0, espera alguém conferir e
     clicar pela tela remota;
  4. baixa o DANFE (PDF) e o XML, grava no pedido e manda os dois para o
     WhatsApp do cliente.

O Emissor é um app Vue sem ids fixos: os campos são achados pelo texto da
legenda (<legend>) de cada fieldset. `python robo.py emissor-explorar ID`
faz tudo menos cadastrar e transmitir, e guarda prints em
/dados/emissor/<pedido>/ para ajustar os seletores.

Nunca tenta de novo sozinho um pedido que travou depois do "Gerar Nota":
ele fica com erro para alguém conferir no Emissor, para não sair nota em dobro.
"""
from __future__ import annotations

import logging
import os
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Locator, Page, sync_playwright

import emissor_db as db
import notificador as aviso

log = logging.getLogger("emissor")

URL = os.environ.get("EMISSOR_URL", "https://sistema.emissor.app").rstrip("/")
PASTA = Path(os.environ.get("PASTA_DADOS", "/dados")) / "emissor"
LOGIN_ARQ = Path(os.environ.get("EMISSOR_LOGIN_ARQUIVO", str(PASTA / "login.txt")))
LINK_TELA = os.environ.get("LINK_TELA_REMOTA", "")
TRANSMITIR = os.environ.get("EMISSOR_TRANSMITIR", "1") == "1"
MINUTOS_PESSOA = int(os.environ.get("MINUTOS_CAPTCHA", "30"))
ESPERA = int(os.environ.get("EMISSOR_ESPERA_MS", "15000"))


class ErroEmissor(Exception):
    """Falha que o escritório precisa ver (vai para o pedido)."""


class TalvezEmitida(ErroEmissor):
    """Travou depois do "Gerar Nota": a nota pode ter saído."""


# ---------------------------------------------------------------- funções puras
def digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def fmt_cnpj(doc: str) -> str:
    d = digitos(doc)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return d


def numero_whatsapp(valor) -> str | None:
    """Mesmo critério de netlify/functions/lib/whatsapp.js (numeroWhatsapp)."""
    v = str(valor or "").strip()
    if not v:
        return None
    if v.endswith("@g.us"):
        return v
    d = digitos(v).lstrip("0")
    if len(d) in (10, 11):
        d = "55" + d
    return d if 12 <= len(d) <= 13 else None


def teclas_dinheiro(valor: float, casas: int = 2) -> str:
    """Campos v-money do Emissor montam o número da direita para a esquerda:
    12,5 com 2 casas → digitar "1250"."""
    return str(round(float(valor) * 10 ** casas))


def casas_do_campo(texto: str, padrao: int = 2) -> int:
    m = re.search(r",(\d+)\s*$", texto or "")
    return len(m.group(1)) if m else padrao


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower().strip()


def dados_xml(xml: str) -> dict:
    """Número e chave da NF-e autorizada."""
    numero = re.search(r"<nNF>(\d+)</nNF>", xml)
    chave = re.search(r"<chNFe>(\d{44})</chNFe>", xml) or re.search(r'Id="NFe(\d{44})"', xml)
    return {"numero": numero.group(1) if numero else None, "chave": chave.group(1) if chave else None}


FRETE_OPCAO = {
    "emitente": r"emitente|remetente|\bCIF\b|^0",
    "destinatario": r"destinat|\bFOB\b|^1",
    "terceiros": r"terceiros|^2",
    "sem_frete": r"sem (ocorr|frete)|^9",
}


# ---------------------------------------------------------------- tela
class Tela:
    """Ajudantes para os componentes do Emissor (bootstrap-vue + vue-select)."""

    def __init__(self, page: Page, pasta_prints: Path | None = None):
        self.page = page
        self.pasta = pasta_prints
        self.n = 0

    def print(self, nome: str) -> None:
        if not self.pasta:
            return
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.n += 1
        try:
            self.page.screenshot(path=str(self.pasta / f"{self.n:02d}-{nome}.png"), full_page=True)
        except Exception:  # noqa: BLE001
            pass

    def grupo(self, legenda: str, visivel: bool = True, n: int = 0) -> Locator:
        rx = re.compile(rf"^\s*{legenda}\s*$", re.I)
        loc = self.page.locator("fieldset.form-group").filter(has=self.page.locator("legend", has_text=rx))
        if visivel:
            loc = loc.locator("visible=true")
        return loc.nth(n)

    def mostrar(self, grupo: Locator) -> None:
        """Abre a aba onde o campo está (as abas do bootstrap-vue escondem o resto)."""
        if grupo.is_visible():
            return
        painel = grupo.locator("xpath=ancestor::div[contains(@class,'tab-pane')][1]")
        pid = painel.get_attribute("id") if painel.count() else None
        if pid:
            self.page.locator(f"[aria-controls='{pid}'], a[href='#{pid}']").first.click()
            grupo.wait_for(state="visible", timeout=5000)

    def texto(self, legenda: str, valor, n: int = 0) -> None:
        if valor in (None, ""):
            return
        g = self.grupo(legenda, visivel=False, n=n)
        self.mostrar(g)
        campo = g.locator("input:not([type=search]), textarea").first
        campo.fill(str(valor))
        campo.dispatch_event("change")

    def dinheiro(self, legenda: str, valor: float, n: int = 0, grupo: Locator | None = None) -> None:
        g = grupo or self.grupo(legenda, visivel=False, n=n)
        self.mostrar(g)
        campo = g.locator("input").first
        casas = casas_do_campo(campo.input_value())
        campo.click()
        campo.press("Control+a")
        campo.press("Backspace")
        campo.type(teclas_dinheiro(valor, casas), delay=30)

    def escolher(self, legenda_ou_grupo, busca: str, opcao: str | None = None, n: int = 0) -> bool:
        """vue-select: digita `busca` e escolhe a primeira opção que bate com
        `opcao` (regex) ou a primeira da lista. False se não houver resultado."""
        g = legenda_ou_grupo if isinstance(legenda_ou_grupo, Locator) else self.grupo(legenda_ou_grupo, visivel=False, n=n)
        self.mostrar(g)
        campo = g.locator("input.vs__search").first
        campo.click()
        campo.fill("")
        campo.type(busca, delay=40)
        lista = g.locator(".vs__dropdown-menu")
        opcoes = g.locator(".vs__dropdown-option")
        fim = time.time() + 8
        while time.time() < fim:
            if opcoes.count():
                break
            if lista.count() and re.search(r"nenhum", lista.first.inner_text(), re.I):
                break
            self.page.wait_for_timeout(300)
        self.page.wait_for_timeout(400)  # a busca é remota: deixa a lista assentar
        if not opcoes.count():
            campo.press("Escape")
            return False
        alvo = opcoes.filter(has_text=re.compile(opcao, re.I)).first if opcao else opcoes.first
        if opcao and not alvo.count():
            campo.press("Escape")
            return False
        alvo.click()
        return True

    def botao(self, texto: str) -> Locator:
        return self.page.get_by_role("button", name=re.compile(rf"^\s*{texto}\s*$", re.I)).first

    def esperar_aviso(self, segundos: int = 20) -> str:
        """Texto do toast/alerta que aparecer (sucesso ou erro), ou ''."""
        sel = ".toast, .b-toast, .alert, .swal2-popup, .modal.show .modal-body, .notification, [role=alert]"
        fim = time.time() + segundos
        while time.time() < fim:
            for el in self.page.locator(sel).all():
                try:
                    t = el.inner_text().strip()
                except Exception:  # noqa: BLE001
                    continue
                if t:
                    return t
            self.page.wait_for_timeout(500)
        return ""


# ---------------------------------------------------------------- sessão
def _login_salvo() -> tuple[str, str] | None:
    try:
        linhas = LOGIN_ARQ.read_text(encoding="utf-8").splitlines()
        return (linhas[0].strip(), linhas[1].strip()) if len(linhas) >= 2 else None
    except OSError:
        return None


def checar_bloqueio(page: Page) -> None:
    """O Cloudflare do Emissor às vezes bloqueia o IP do servidor: avisa em vez de esperar à toa."""
    if page.get_by_text(re.compile(r"you have been blocked|unable to access", re.I)).count():
        raise ErroEmissor("O Emissor (Cloudflare) bloqueou o acesso do servidor do robô. "
                          "Peça ao suporte do Emissor para liberar o IP do servidor.")


def garantir_login(page: Page) -> None:
    page.goto(f"{URL}/parceiro/empresas", wait_until="networkidle")
    checar_bloqueio(page)
    if "/login" not in page.url:
        return
    cred = _login_salvo()
    if cred:
        page.locator("input[type=email], input[name*=mail i], input[type=text]").first.fill(cred[0])
        page.locator("input[type=password]").first.fill(cred[1])
        page.locator("button[type=submit], button:has-text('Entrar'), button:has-text('Acessar')").first.click()
        page.wait_for_timeout(4000)
        if "/login" not in page.url:
            return
        log.warning("Login automático no Emissor não passou.")
    aviso.texto(f"🔐 O robô de NF-e precisa entrar no Emissor. Abra {LINK_TELA} e faça o login; ele segue sozinho.")
    fim = time.time() + MINUTOS_PESSOA * 60
    while "/login" in page.url:
        if time.time() > fim:
            raise ErroEmissor("Ninguém entrou no Emissor a tempo (tela remota).")
        page.wait_for_timeout(3000)


def entrar_empresa(t: Tela, cnpj: str) -> None:
    page = t.page
    # sai da empresa aberta (o Emissor guarda a escolhida no localStorage)
    page.evaluate("() => localStorage.removeItem('empresa')")
    page.goto(f"{URL}/parceiro/empresas", wait_until="networkidle")
    checar_bloqueio(page)
    alvo = fmt_cnpj(cnpj)
    # a lista da aba Empresas carrega depois da página: espera o campo e os cartões aparecerem
    procurar = page.locator("input[placeholder='Procurar']").first
    procurar.wait_for(timeout=ESPERA)
    try:
        page.locator(".card").first.wait_for(timeout=ESPERA)
    except Exception:
        pass
    # a mesma empresa pode ter cadastro "Ativa" e "Inativa"; só a ativa tem "Acessar"
    cartoes = page.locator(".card").filter(has_text=alvo)
    ativo = cartoes.filter(has=page.locator(".badge", has_text=re.compile(r"^\s*Ativ[ao]\s*$")))
    cartao = None
    for busca in (digitos(cnpj), alvo):
        procurar.fill(busca)
        procurar.press("Enter")
        try:
            cartoes.first.wait_for(timeout=15000)
        except Exception:
            continue
        page.wait_for_timeout(1000)  # deixa chegar o resto da lista filtrada
        cartao = ativo.first if ativo.count() else cartoes.first
        break
    if cartao is None:
        t.print("empresa-nao-achada")
        raise ErroEmissor(f"Empresa {alvo} não foi achada na aba Empresas do Emissor.")
    if not ativo.count():
        raise ErroEmissor(f"Empresa {alvo} está inativa no Emissor (aba Empresas).")
    cartao.locator(".dropdown-toggle").first.click()
    cartao.get_by_text(re.compile(r"Acessar", re.I)).first.click()
    page.wait_for_url(re.compile(r"/app/"), timeout=ESPERA)
    t.print("empresa")


# ---------------------------------------------------------------- cadastros
def abrir_emitir(t: Tela) -> None:
    t.page.goto(f"{URL}/app/notas/eletronica/emitir", wait_until="networkidle")
    t.grupo("Natureza da operação").wait_for(timeout=ESPERA)
    if t.page.get_by_text(re.compile(r"Certificado Digital n.o localizado", re.I)).count():
        raise ErroEmissor("A empresa está sem certificado digital no Emissor.")


def destinatario_existe(t: Tela, dest: dict) -> bool:
    return t.escolher("Destinatário/Cliente", digitos(dest["documento"]))


def produto_existe(t: Tela, item: dict) -> bool:
    g = t.page.locator("div").filter(has=t.page.locator("legend", has_text=re.compile(r"^\s*Busca por Nome\s*$"))).last
    rx = rf"^\s*{re.escape(item['descricao'])}\s*$"
    ok = t.escolher(g, item["descricao"][:40], opcao=rx)
    return ok


def cadastrar_destinatario(t: Tela, dest: dict) -> None:
    page = t.page
    page.goto(f"{URL}/app/cadastros/clientes/cadastrar", wait_until="networkidle")
    doc = digitos(dest["documento"])
    t.texto("CPF/CNPJ", fmt_cnpj(doc))
    page.wait_for_timeout(1500)  # o Emissor pode buscar o CNPJ sozinho
    t.texto("Nome", dest["nome"])
    if len(doc) == 11:
        t.escolher("Consumidor Final", "Sim", opcao=r"^\s*Sim")
    if dest.get("ie") and sem_acento(dest["ie"]) != "isento":
        t.escolher("Contribuinte ICMS", "Contribuinte", opcao=r"^\s*Contribuinte\s*(ICMS)?\s*$")
        t.texto("Inscrição Estadual", dest["ie"])
    else:
        t.escolher("Contribuinte ICMS", "Não", opcao=r"n.o contribuinte")
    t.texto("Telefone", dest.get("telefone"))
    t.texto("CEP", dest["cep"])
    page.wait_for_timeout(1500)
    t.texto("Endereço", dest["logradouro"])
    t.texto("Número", dest["numero"])
    t.texto("Complemento", dest.get("complemento"))
    t.texto("Bairro", dest["bairro"])
    t.escolher("Estado", dest["uf"], opcao=rf"\b{dest['uf']}\b")
    page.wait_for_timeout(800)
    if not t.escolher("Cidade", dest["municipio"][:20]):
        raise ErroEmissor(f"Cidade {dest['municipio']}/{dest['uf']} não encontrada no Emissor.")
    t.print("cadastro-cliente")
    t.botao("Salvar").click()
    msg = t.esperar_aviso()
    t.print("cadastro-cliente-salvo")
    if re.search(r"erro|inv.lid|obrigat", msg, re.I):
        raise ErroEmissor(f"Emissor recusou o cadastro de {dest['nome']}: {msg[:200]}")


def cadastrar_produto(t: Tela, item: dict) -> None:
    t.page.goto(f"{URL}/app/cadastros/produtos/cadastrar", wait_until="networkidle")
    t.texto("Código", item.get("codigo"))
    t.texto("Descrição", item["descricao"])
    t.texto("Un. Medida", item.get("unidade") or "UN")
    t.dinheiro("Preço Unitário", item["valor_unitario"])
    if item.get("ncm"):
        t.texto("NCM", item["ncm"])
    t.print("cadastro-produto")
    t.botao("Salvar").click()
    msg = t.esperar_aviso()
    t.print("cadastro-produto-salvo")
    if re.search(r"erro|inv.lid|obrigat", msg, re.I):
        raise ErroEmissor(f"Emissor recusou o produto {item['descricao']}: {msg[:200]}")


def garantir_cadastros(t: Tela, ped: dict, criar: bool = True) -> list[str]:
    """Cria no Emissor o que falta. Devolve o que foi (ou seria) criado."""
    faltando = []
    abrir_emitir(t)
    if not destinatario_existe(t, ped["destinatario"]):
        faltando.append(f"cliente {ped['destinatario']['nome']}")
        if criar:
            cadastrar_destinatario(t, ped["destinatario"])
            abrir_emitir(t)
    for item in ped["itens"]:
        if not produto_existe(t, item):
            faltando.append(f"produto {item['descricao']}")
            if criar:
                cadastrar_produto(t, item)
                abrir_emitir(t)
    return faltando


# ---------------------------------------------------------------- nota
def preencher_nota(t: Tela, ped: dict) -> None:
    page = t.page
    abrir_emitir(t)
    if not destinatario_existe(t, ped["destinatario"]):
        raise ErroEmissor(f"Destinatário {ped['destinatario']['nome']} não apareceu na busca do Emissor.")
    page.wait_for_timeout(1000)
    for n, item in enumerate(ped["itens"], 1):
        if not produto_existe(t, item):
            raise ErroEmissor(f"Produto {item['descricao']} não apareceu na busca do Emissor.")
        page.wait_for_timeout(600)
        t.dinheiro("Quantidade", item["quantidade"])
        t.dinheiro("Valor Unitário", item["valor_unitario"])
        desconto = float(item.get("desconto") or 0)
        if desconto > 0:
            # desconto do item (vDesc); o da nota toda já vem repartido entre os itens
            g = page.locator("fieldset.form-group").filter(
                has=page.locator("legend", has_text=re.compile(r"^\s*(valor (do )?)?desconto", re.I))).first
            if not g.count():
                raise ErroEmissor(f"Campo de desconto do item {n} não achado no Emissor (R$ {desconto:.2f}).")
            t.dinheiro("", desconto, grupo=g)
        t.botao(r"\+ Adicionar").click()
        page.wait_for_timeout(1200)
        t.print(f"item-{n}")
    if ped.get("frete_modalidade"):
        g = t.page.locator("fieldset.form-group").filter(
            has=t.page.locator("legend", has_text=re.compile(r"modalidade.*frete|frete por conta", re.I))).first
        if g.count():
            t.escolher(g, "", opcao=FRETE_OPCAO[ped["frete_modalidade"]])
        else:
            log.warning("Campo de modalidade do frete não achado — fica o padrão do Emissor.")
    if float(ped.get("frete_valor") or 0) > 0:
        t.dinheiro("Valor frete", float(ped["frete_valor"]))
    if ped.get("observacao"):
        g = t.page.locator("fieldset.form-group").filter(
            has=t.page.locator("legend", has_text=re.compile(r"informa..es (complementares|adicionais)", re.I))).filter(
            has=t.page.locator("textarea")).first
        if g.count():
            t.mostrar(g)
            g.locator("textarea").first.fill(ped["observacao"])
    t.print("nota-preenchida")
    conferir_total(t, ped)


def conferir_total(t: Tela, ped: dict) -> None:
    g = t.grupo("Valor Nota", visivel=False)
    if not g.count():
        return
    t.mostrar(g)
    v = g.locator("input").first.input_value()
    valor = float(re.sub(r"[^\d,]", "", v).replace(",", ".") or 0)
    if abs(valor - float(ped["valor_total"])) > 0.05:
        raise ErroEmissor(f"Total no Emissor (R$ {valor:.2f}) não bate com o pedido (R$ {float(ped['valor_total']):.2f}).")


def transmitir(t: Tela, ped: dict) -> None:
    page = t.page
    if TRANSMITIR:
        t.botao("Gerar Nota").click()
    else:
        aviso.texto(f"🧾 NF-e de {ped['clientes']['nome']} para {ped['destinatario']['nome']} preenchida no Emissor. "
                    f"Confira e toque em \"Gerar Nota\" pela tela remota: {LINK_TELA}")
    fim = time.time() + (90 if TRANSMITIR else MINUTOS_PESSOA * 60)
    while time.time() < fim:
        # só os avisos (toast/alerta/modal): o texto da página tem palavras soltas como "erro"
        msg = t.esperar_aviso(2)
        if TRANSMITIR and re.search(r"rejei|\berro\b|n.o autorizad|denegad", msg, re.I):
            t.print("rejeitada")
            raise ErroEmissor(f"SEFAZ/Emissor recusou: {msg[:250]}")
        if re.search(r"autorizad[ao]", msg, re.I) or "/notas/eletronica/emitir" not in page.url:
            t.print("transmitida")
            return
    t.print("sem-resposta")
    raise TalvezEmitida("Não vi a autorização da nota a tempo. Confira no Emissor antes de mandar de novo.")


def _baixar(page: Page, gatilho: Locator) -> bytes:
    """Clique que gera arquivo: download direto ou nova aba com o arquivo."""
    try:
        with page.expect_download(timeout=8000) as d:
            gatilho.click()
        return Path(d.value.path()).read_bytes()
    except Exception:  # noqa: BLE001
        pass
    with page.context.expect_page(timeout=10000) as nova:
        gatilho.click()
    aba = nova.value
    aba.wait_for_load_state()
    conteudo = page.context.request.get(aba.url).body()
    aba.close()
    return conteudo


def baixar_arquivos(t: Tela, ped: dict) -> tuple[bytes, bytes]:
    page = t.page
    page.goto(f"{URL}/app/notas/eletronica/", wait_until="networkidle")
    nome = sem_acento(ped["destinatario"]["nome"])[:15]
    cartao = None
    for c in page.locator(".card").all()[:10]:
        if nome and nome in sem_acento(c.inner_text()):
            cartao = c
            break
    if not cartao:
        raise TalvezEmitida("A nota não apareceu na lista do Emissor para baixar o PDF/XML.")
    t.print("lista")
    arquivos = {}
    for tipo, rx in (("pdf", r"danfe|pdf|imprimir"), ("xml", r"\bxml\b")):
        cartao.locator(".dropdown-toggle").first.click()
        item = page.locator(".dropdown-menu.show").get_by_text(re.compile(rx, re.I)).first
        arquivos[tipo] = _baixar(page, item)
        page.keyboard.press("Escape")
    if not arquivos["xml"].lstrip().startswith(b"<"):
        raise TalvezEmitida("O XML baixado do Emissor não parece um XML.")
    return arquivos["pdf"], arquivos["xml"]


# ---------------------------------------------------------------- execução
def _abrir_navegador(pw):
    (PASTA / "perfil").mkdir(parents=True, exist_ok=True)
    contexto = pw.chromium.launch_persistent_context(
        str(PASTA / "perfil"), headless=os.environ.get("ROBO_HEADLESS") == "1", accept_downloads=True,
        locale="pt-BR", viewport=None, args=["--window-size=1280,800", "--window-position=0,0"])
    page = contexto.pages[0] if contexto.pages else contexto.new_page()
    return contexto, page


def entregar(ped: dict, pdf: bytes, xml: bytes) -> str | None:
    cli = ped["clientes"]
    destino = numero_whatsapp(cli.get("whatsapp_entrega") or cli.get("telefone"))
    if not destino:
        return "empresa sem WhatsApp de entrega"
    d = dados_xml(xml.decode("utf-8", "ignore"))
    nome = f"NF-e {d['numero'] or ''} {ped['destinatario']['nome'][:30]}".strip()
    valor = f"{float(ped['valor_total']):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    legenda = f"✅ NF-e {d['numero'] or ''} emitida — {ped['destinatario']['nome']}\nValor: R$ {valor}"
    erro = aviso.documento_para(destino, pdf, f"{nome}.pdf", legenda)
    if not erro:
        erro = aviso.documento_para(destino, xml, f"{nome}.xml", "", mimetype="application/xml")
    return erro


def emitir_pedido(page: Page, ped: dict) -> None:
    pid = ped["id"]
    t = Tela(page, PASTA / pid[:8])
    db.marcar_robo(pid, "processando", "Abrindo o Emissor", robo_tentativas=(ped.get("robo_tentativas") or 0) + 1)
    garantir_login(page)
    entrar_empresa(t, ped["clientes"]["cnpj"])
    criados = garantir_cadastros(t, ped, criar=True)
    if criados:
        log.info("Cadastrado no Emissor: %s", ", ".join(criados))
    preencher_nota(t, ped)
    db.marcar_robo(pid, "processando" if TRANSMITIR else "aguardando_pessoa",
                   "Transmitindo" if TRANSMITIR else "Preenchida, esperando alguém clicar em Gerar Nota")
    try:
        transmitir(t, ped)
        pdf, xml = baixar_arquivos(t, ped)
    except TalvezEmitida:
        raise
    except ErroEmissor:
        raise
    except Exception as e:  # noqa: BLE001 — qualquer outra falha depois do clique pode ter emitido
        raise TalvezEmitida(f"Falha depois de transmitir ({e}). Confira no Emissor antes de mandar de novo.") from e
    d = dados_xml(xml.decode("utf-8", "ignore"))
    agora = datetime.now().astimezone().isoformat()
    db.atualizar(pid, {
        "status": "emitida", "emitida_em": agora,
        "nfe_numero": d["numero"], "nfe_chave": d["chave"],
        "nfe_pdf_path": db.guardar_arquivo(pid, pdf, "pdf", "application/pdf"),
        "nfe_xml_path": db.guardar_arquivo(pid, xml, "xml", "application/xml"),
    })
    erro = entregar(ped, pdf, xml)
    if erro:
        db.marcar_robo(pid, "ok", f"NF {d['numero']} emitida; não foi pelo WhatsApp: {erro}")
    else:
        db.marcar_robo(pid, "ok", f"NF {d['numero']} emitida e enviada ao cliente" + (f" (cadastrado: {', '.join(criados)})" if criados else ""),
                       nfe_enviada_em=agora)
    aviso.texto(f"🧾 NF-e {d['numero']} de {ped['clientes']['nome']} para {ped['destinatario']['nome']} emitida"
                + ("" if not erro else f" — mas não foi ao cliente: {erro}"))


def rodar() -> int:
    """Processa a fila. Devolve quantos pedidos pegou."""
    fila = db.pedidos_na_fila()
    if not fila:
        return 0
    log.info("NF-e: %d pedido(s) na fila", len(fila))
    with sync_playwright() as pw:
        contexto, page = _abrir_navegador(pw)
        for ped in fila:
            nome = f"{ped['clientes']['nome']} → {ped['destinatario']['nome']}"
            try:
                if not digitos(ped["clientes"].get("cnpj")):
                    raise ErroEmissor("Empresa sem CNPJ no cadastro do gestor.")
                emitir_pedido(page, ped)
            except ErroEmissor as e:
                talvez = isinstance(e, TalvezEmitida)
                log.warning("NF-e %s: %s", nome, e)
                db.marcar_robo(ped["id"], "erro", ("⚠️ " if talvez else "") + str(e))
                aviso.texto(f"❌ Robô de NF-e ({nome}): {e}")
            except Exception as e:  # noqa: BLE001 — antes de transmitir: seguro mandar de novo
                log.exception("NF-e %s", nome)
                try:
                    page.screenshot(path=str(PASTA / f"erro-{ped['id'][:8]}-{datetime.now():%H%M%S}.png"), full_page=True)
                except Exception:  # noqa: BLE001
                    pass
                db.marcar_robo(ped["id"], "erro", f"Falha antes de transmitir: {str(e)[:300]}")
                aviso.texto(f"❌ Robô de NF-e ({nome}) parou antes de transmitir: {str(e)[:200]}")
        contexto.close()
    return len(fila)


def explorar(pid: str) -> None:
    """Calibração: entra, confere cadastros (sem criar) e preenche a nota sem
    transmitir. Prints em /dados/emissor/<pedido>/."""
    ped = db.pedido(pid)
    if not ped:
        raise SystemExit("Pedido não encontrado.")
    with sync_playwright() as pw:
        contexto, page = _abrir_navegador(pw)
        t = Tela(page, PASTA / pid[:8])
        garantir_login(page)
        entrar_empresa(t, ped["clientes"]["cnpj"])
        faltando = garantir_cadastros(t, ped, criar=False)
        print("Faltaria cadastrar:", faltando or "nada")
        if not faltando:
            preencher_nota(t, ped)
            print("Nota preenchida, NÃO transmitida. Confira pela tela remota; prints em", t.pasta)
            page.wait_for_timeout(5 * 60 * 1000)
        contexto.close()
