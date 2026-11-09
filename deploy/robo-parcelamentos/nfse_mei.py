"""Robô de NFS-e de MEI no Emissor Nacional (www.nfse.gov.br/EmissorNacional).

O escritório pede a nota na tela "NFS-e MEI" do gestor (modelo da empresa +
valor + data); ela entra em nfse_mei_notas com status 'na_fila'. Para cada uma:
  1. entra no portal com o CNPJ do MEI e a senha cadastrada (cifrada no banco;
     o login do portal não tem captcha);
  2. preenche a DPS em três passos: Pessoas (competência e tomador), Serviço
     (local, código de tributação nacional, descrição) e Valores;
  3. clica em "Emitir NFS-e" — ou, com MEI_TRANSMITIR=0, espera alguém conferir
     e clicar pela tela remota (avisa no WhatsApp do escritório);
  4. baixa o PDF (DANFSe) e o XML, grava na nota e manda os dois no WhatsApp
     do cliente (WhatsApp de entrega ou telefone do cadastro).

O portal é ASP.NET com ids no padrão Grupo_Campo (ex.: Tomador_Inscricao). O
robô acha os campos por pedaços do id/name e pelo texto dos rótulos; se o
portal mudar, rode `python robo.py mei-explorar ID_DA_NOTA`: preenche tudo
sem emitir e guarda print + HTML de cada passo em /dados/nfse-mei/<nota>/.

Nunca tenta de novo sozinho uma nota que travou depois do clique em "Emitir":
ela fica com erro (talvez_emitida) para alguém conferir no portal.
"""
from __future__ import annotations

import logging
import os
import re
import time
from datetime import date, datetime
from pathlib import Path

from playwright.sync_api import Locator, Page, sync_playwright

import nfse_mei_db as db
import notificador as aviso

log = logging.getLogger("nfse_mei")

URL = os.environ.get("MEI_PORTAL_URL", "https://www.nfse.gov.br/EmissorNacional").rstrip("/")
PASTA = Path(os.environ.get("PASTA_DADOS", "/dados")) / "nfse-mei"
LINK_TELA = os.environ.get("LINK_TELA_REMOTA", "")
# Começa conferindo: o robô preenche e uma pessoa clica em "Emitir NFS-e". Depois das
# primeiras notas certas, MEI_TRANSMITIR=1 no .env para emitir sozinho.
TRANSMITIR = os.environ.get("MEI_TRANSMITIR", "0") == "1"
MINUTOS_PESSOA = int(os.environ.get("MINUTOS_CAPTCHA", "30"))
ESPERA = int(os.environ.get("MEI_ESPERA_MS", "20000"))


class ErroPortal(Exception):
    """Falha que o escritório precisa ver (vai para a nota). Seguro mandar de novo."""


class TalvezEmitida(ErroPortal):
    """Travou depois do clique em "Emitir": a nota pode ter saído."""


# ---------------------------------------------------------------- funções puras
def digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


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


def data_br(iso: str) -> str:
    return date.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")


def codigo_fmt(c: str) -> str:
    """010701 → 01.07.01 (como o portal mostra)."""
    d = digitos(c)
    return f"{d[:2]}.{d[2:4]}.{d[4:6]}" if len(d) == 6 else d


def codigo_rx(c: str) -> str:
    """Regex que acha o código na lista do portal, com ou sem pontos."""
    d = digitos(c)
    return rf"\b{d[:2]}\.?{d[2:4]}\.?{d[4:6]}\b"


def valor_br(v) -> str:
    return f"{float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def ler_valor(texto: str) -> float:
    t = re.sub(r"[^\d,.]", "", texto or "")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t or 0)
    except ValueError:
        return 0.0


def dados_xml(xml: str) -> dict:
    """Número e chave de acesso (50 dígitos) da NFS-e autorizada."""
    numero = re.search(r"<nNFSe>(\d+)</nNFSe>", xml)
    chave = re.search(r'Id="NFS(\d{50})"', xml) or re.search(r"<chNFSe>(\d{50})</chNFSe>", xml)
    return {"numero": numero.group(1) if numero else None, "chave": chave.group(1) if chave else None}


def tipo_arquivo(conteudo: bytes) -> str | None:
    c = conteudo.lstrip()
    if c.startswith(b"%PDF"):
        return "pdf"
    if c.startswith(b"<") and b"NFSe" in c[:4000] and b"<html" not in c[:500].lower():
        return "xml"
    return None


# ---------------------------------------------------------------- tela
class Tela:
    def __init__(self, page: Page, pasta: Path | None = None):
        self.page = page
        self.pasta = pasta
        self.n = 0

    def print(self, nome: str, html: bool = False) -> None:
        if not self.pasta:
            return
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.n += 1
        base = self.pasta / f"{self.n:02d}-{nome}"
        try:
            self.page.screenshot(path=f"{base}.png", full_page=True)
            if html:
                Path(f"{base}.html").write_text(self.page.content(), encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    def campo(self, *pedacos: str, tipo: str = "input, textarea, select") -> Locator:
        """Primeiro campo visível cujo id ou name contém todos os pedaços (sem diferenciar maiúsculas)."""
        cond = "".join(f"[id*='{p}' i]" for p in pedacos)
        cond_n = "".join(f"[name*='{p}' i]" for p in pedacos)
        sel = ", ".join(f"{t.strip()}{c}" for t in tipo.split(",") for c in (cond, cond_n))
        return self.page.locator(sel).locator("visible=true").first

    def tem(self, loc: Locator, ms: int = 0) -> bool:
        try:
            if ms:
                loc.wait_for(state="visible", timeout=ms)
            return loc.count() > 0 and loc.is_visible()
        except Exception:  # noqa: BLE001
            return False

    def radio(self, pedaco_nome: str, rotulo_rx: str) -> str | None:
        """Marca o rádio cujo name/id contém `pedaco_nome` e cujo rótulo bate com a regex."""
        return self.page.evaluate("""([parte, rx]) => {
            const re = new RegExp(rx, 'i'), p = parte.toLowerCase()
            for (const r of document.querySelectorAll('input[type=radio]')) {
                if (!((r.name || '') + ' ' + (r.id || '')).toLowerCase().includes(p)) continue
                const lab = (r.labels && r.labels[0] && r.labels[0].innerText)
                    || (r.closest('label') && r.closest('label').innerText)
                    || (r.nextSibling && r.nextSibling.textContent) || r.value || ''
                if (re.test(lab.trim())) { if (!r.checked) r.click(); return lab.trim() }
            }
            return null
        }""", [pedaco_nome, rotulo_rx])

    def pergunta(self, pergunta_rx: str, rotulo_rx: str) -> str | None:
        """Marca a resposta (rótulo do rádio) de uma pergunta achada pelo texto, ex.:
        "Preencher as informações IBS/CBS?" → "Não". Entre os rádios com o rótulo certo, fica o
        mais perto do texto da pergunta (o grupo dela, não outro grupo da mesma seção)."""
        return self.page.evaluate("""([prx, rrx]) => {
            const P = new RegExp(prx, 'i'), R = new RegExp(rrx, 'i')
            let melhor = null, dist = 99
            for (const r of document.querySelectorAll('input[type=radio]')) {
                const lab = ((r.labels && r.labels[0] && r.labels[0].innerText)
                    || (r.closest('label') && r.closest('label').innerText)
                    || (r.nextSibling && r.nextSibling.textContent) || r.value || '').trim()
                if (!R.test(lab)) continue
                let el = r, d = 0
                while (el && d < 8 && !P.test(el.innerText || '')) { el = el.parentElement; d++ }
                if (el && d < dist) { melhor = [r, lab]; dist = d }
            }
            if (!melhor) return null
            if (!melhor[0].checked) melhor[0].click()
            return melhor[1]
        }""", [pergunta_rx, rotulo_rx])

    def preencher(self, loc: Locator, valor: str) -> None:
        if loc.is_editable():
            loc.click()
            loc.fill(str(valor))
        else:  # campo com calendário (somente leitura): grava o valor direto
            loc.evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})) }", str(valor))
        loc.dispatch_event("change")
        loc.press("Tab")

    def escolher(self, select: Locator, busca: str, opcao_rx: str) -> str | None:
        """<select> comum ou com select2 (busca remota). Devolve o texto escolhido ou None."""
        sid = select.get_attribute("id") or ""
        caixa = self.page.locator(f"#{sid} + .select2, #{sid} ~ span.select2").first if sid else None
        if caixa is not None and caixa.count():
            caixa.click()
            busca_campo = self.page.locator(".select2-container--open .select2-search__field").first
            if self.tem(busca_campo, 3000):
                busca_campo.fill("")
                busca_campo.type(busca, delay=60)
            opcoes = self.page.locator(".select2-container--open .select2-results__option:not(.loading-results)")
            fim = time.time() + 10
            while time.time() < fim:
                textos = [t for t in opcoes.all_inner_texts() if t.strip()]
                if textos and not re.search(r"pesquisando|buscando|searching|digite", textos[0], re.I):
                    break
                self.page.wait_for_timeout(400)
            alvo = opcoes.filter(has_text=re.compile(opcao_rx, re.I)).first
            if not alvo.count():
                self.page.keyboard.press("Escape")
                return None
            texto = alvo.inner_text().strip()
            alvo.click()
            self.page.wait_for_timeout(500)
            return texto
        # <select> comum
        escolhido = self.page.evaluate("""([el, rx]) => {
            const re = new RegExp(rx, 'i')
            const o = [...el.options].find((o) => re.test(o.text))
            if (!o) return null
            el.value = o.value
            el.dispatchEvent(new Event('change', { bubbles: true }))
            return o.text
        }""", [select.element_handle(), opcao_rx])
        return escolhido

    def erros(self) -> str:
        """Mensagens de validação visíveis na página."""
        sel = (".validation-summary-errors, .field-validation-error, .alert-danger, .alert-warning, "
               ".text-danger, .toast-error, .swal2-html-container, .modal.show .modal-body")
        textos = []
        for el in self.page.locator(sel).all():
            try:
                if el.is_visible():
                    t = " ".join(el.inner_text().split())
                    if t and t not in textos:
                        textos.append(t)
            except Exception:  # noqa: BLE001
                continue
        return " | ".join(textos)[:400]

    def avancar(self, passo: str) -> None:
        url = self.page.url
        botao = self.page.locator(
            "button:has-text('Avançar'), input[type=submit][value*='Avançar' i], a.btn:has-text('Avançar')"
        ).locator("visible=true").first
        if not self.tem(botao):
            raise ErroPortal(f"Botão Avançar não achado no passo {passo}.")
        botao.click()
        try:
            self.page.wait_for_url(lambda u: u != url, timeout=ESPERA)
        except Exception:  # noqa: BLE001
            msg = self.erros()
            self.print(f"{passo}-recusado", html=True)
            raise ErroPortal(f"O portal não aceitou o passo {passo}" + (f": {msg}" if msg else "."))
        self.page.wait_for_load_state("networkidle")


# ---------------------------------------------------------------- passos
def entrar(t: Tela, cnpj: str, senha: str) -> None:
    page = t.page
    page.goto(f"{URL}/Login", wait_until="networkidle")
    page.locator("#Inscricao").fill(digitos(cnpj))
    page.locator("#Senha").fill(senha)
    page.locator("form button[type=submit]").first.click()
    page.wait_for_load_state("networkidle")
    if re.search(r"/Login(\?|$)", page.url):
        msg = t.erros()
        t.print("login-recusado")
        raise ErroPortal("O portal recusou o login" + (f": {msg}" if msg else " (confira a senha cadastrada)."))
    t.print("entrou")


def abrir_dps(t: Tela) -> None:
    page = t.page
    page.goto(f"{URL}/DPS/Pessoas", wait_until="networkidle")
    if not t.tem(t.campo("DataCompetencia"), 5000):
        link = page.get_by_role("link", name=re.compile(r"emiss.o completa|nova nfs-?e|emitir", re.I)).first
        if t.tem(link):
            link.click()
            page.wait_for_load_state("networkidle")
    if not t.tem(t.campo("DataCompetencia"), ESPERA):
        t.print("sem-formulario", html=True)
        raise ErroPortal("Não achei o formulário de emissão (DPS) no portal.")


def passo_pessoas(t: Tela, n: dict) -> None:
    page = t.page
    # Desde a NT 009 o formulário fica bloqueado até responder se vai preencher IBS/CBS.
    # MEI: não (as notas de 10/2026 saíram sem IBS/CBS).
    if not t.pergunta(r"preencher as informa..es ibs/cbs", r"^n.o$"):
        log.warning("Pergunta 'Preencher as informações IBS/CBS?' não achada.")
    page.wait_for_timeout(1500)
    data = t.campo("DataCompetencia")
    try:
        data.wait_for(state="visible", timeout=ESPERA)
        page.wait_for_function("el => !el.disabled", arg=data.element_handle(), timeout=ESPERA)
    except Exception:  # noqa: BLE001
        t.print("data-bloqueada", html=True)
        raise ErroPortal("O campo Data de Competência continuou bloqueado (pergunta nova no portal?).")
    t.preencher(data, data_br(n["competencia"]))
    page.wait_for_timeout(1500)  # o portal recarrega partes da tela depois da data
    t.pergunta(r"compra governamental", r"^n.o$")
    doc = digitos(n.get("tomador_doc"))
    if doc:
        if not t.radio("Tomador", r"^brasil"):
            log.warning("Rádio 'Brasil' do tomador não achado; segue com o que estiver marcado.")
        page.wait_for_timeout(800)
        insc = t.campo("Tomador", "Inscricao", tipo="input")
        if not t.tem(insc, 5000):
            t.print("sem-campo-tomador", html=True)
            raise ErroPortal("Campo CPF/CNPJ do tomador não achado.")
        t.preencher(insc, doc)
        lupa = insc.locator("xpath=following::button[1]")
        if t.tem(lupa):
            lupa.click()
        page.wait_for_timeout(2500)  # o portal busca o cadastro do tomador
        nome = t.campo("Tomador", "Nome", tipo="input")
        if t.tem(nome) and not nome.input_value().strip() and n.get("tomador_nome"):
            t.preencher(nome, n["tomador_nome"][:150])
    else:
        t.radio("Tomador", r"n.o informado")
    t.radio("Intermediario", r"n.o informado")
    # "Para fins de apuração do IBS/CBS, o destinatário é o próprio adquirente?" → Sim
    t.pergunta(r"destinat.rio . o pr.prio adquirente", r"^sim$")
    t.print("pessoas", html=True)


def passo_servico(t: Tela, n: dict) -> None:
    page = t.page
    if n.get("municipio_prestacao"):
        mun = t.campo("LocalPrestacao", "Municipio", tipo="select")
        if t.tem(mun) and not t.escolher(mun, n["municipio_prestacao"][:25], re.escape(n["municipio_prestacao"][:25])):
            raise ErroPortal(f"Município de prestação '{n['municipio_prestacao']}' não achado no portal.")
    cod = t.campo("CodigoTributacao", tipo="select")
    if not t.tem(cod, 5000):
        t.print("sem-codigo", html=True)
        raise ErroPortal("Campo do código de tributação nacional não achado.")
    if not (t.escolher(cod, codigo_fmt(n["codigo_tributacao"]), codigo_rx(n["codigo_tributacao"]))
            or t.escolher(cod, digitos(n["codigo_tributacao"]), codigo_rx(n["codigo_tributacao"]))):
        raise ErroPortal(f"Código de tributação {codigo_fmt(n['codigo_tributacao'])} não aparece para esta empresa no portal.")
    page.wait_for_timeout(1000)
    # "Há exportação / imunidade / não incidência?" → Não (quando a pergunta aparece)
    for parte in ("Exportacao", "Imunidade", "NaoIncidencia"):
        t.radio(parte, r"^n.o$")
    desc = page.locator("#ServicoPrestado_Descricao")
    if not t.tem(desc):
        desc = t.campo("Descricao", tipo="textarea")
    if not t.tem(desc):
        t.print("sem-descricao", html=True)
        raise ErroPortal("Campo da descrição do serviço não achado.")
    desc.click()
    desc.fill("")
    desc.press_sequentially(n["descricao"], delay=15)  # tecla a tecla: o portal conta os caracteres no teclado
    desc.dispatch_event("change")
    if desc.input_value().strip() != n["descricao"].strip():
        t.print("descricao-diferente", html=True)
        raise ErroPortal("A descrição não ficou igual no portal.")
    t.print("servico", html=True)


def passo_valores(t: Tela, n: dict) -> None:
    campo = t.campo("ValorServico", tipo="input")
    if not t.tem(campo, 5000):
        campo = t.campo("Valor", "Servico", tipo="input")
    if not t.tem(campo):
        t.print("sem-valor", html=True)
        raise ErroPortal("Campo do valor do serviço não achado.")
    alvo = float(n["valor"])
    campo.click()
    campo.press("Control+a")
    campo.press("Backspace")
    campo.type(valor_br(alvo), delay=40)
    campo.press("Tab")
    if abs(ler_valor(campo.input_value()) - alvo) > 0.009:
        # máscara que monta da direita para a esquerda: digita só os centavos
        campo.click()
        campo.press("Control+a")
        campo.press("Backspace")
        campo.type(str(round(alvo * 100)), delay=40)
        campo.press("Tab")
    lido = ler_valor(campo.input_value())
    if abs(lido - alvo) > 0.009:
        raise ErroPortal(f"Valor no portal (R$ {valor_br(lido)}) não bate com a nota (R$ {valor_br(alvo)}).")
    # "Valor aproximado dos tributos" (obrigatório): as notas dos MEIs saem sem valor estimado
    if not (t.radio("TipoValorTributos", r"n.o informar") or t.pergunta(r"valor aproximado dos tributos", r"n.o informar")):
        log.warning("Opção 'Não informar valor estimado dos tributos' não achada.")
    t.print("valores", html=True)


def emitir(t: Tela, n: dict, nome: str) -> None:
    page = t.page
    botao = page.locator(
        "button:has-text('Emitir NFS-e'), input[type=submit][value*='Emitir' i], button:has-text('Emitir')"
    ).locator("visible=true").first
    if not t.tem(botao, ESPERA):
        t.print("sem-botao-emitir", html=True)
        raise ErroPortal("Botão 'Emitir NFS-e' não achado na conferência.")
    t.print("conferencia", html=True)
    url = page.url
    antes = t.erros()  # avisos que já estavam na tela não contam como recusa
    if TRANSMITIR:
        botao.click()
        prazo = 120
    else:
        db.marcar(n["id"], "aguardando_pessoa", "Preenchida no portal, esperando alguém clicar em Emitir NFS-e")
        aviso.texto(f"🧾 NFS-e de {nome} (R$ {valor_br(n['valor'])}) preenchida no Emissor Nacional. "
                    f"Confira e toque em \"Emitir NFS-e\" pela tela remota: {LINK_TELA}")
        prazo = MINUTOS_PESSOA * 60
    fim = time.time() + prazo
    while time.time() < fim:
        page.wait_for_timeout(1500)
        if page.locator("a[href*='Download' i]").count() or re.search(r"/(Notas|DPS/Emitida|Sucesso)", page.url, re.I) \
                or page.get_by_text(re.compile(r"(nfs-?e|nota).{0,30}(emitida|gerada) com sucesso", re.I)).count():
            t.print("emitida", html=True)
            return
        if page.url == url:
            msg = t.erros()
            if msg and msg != antes and TRANSMITIR:
                t.print("recusada", html=True)
                raise TalvezEmitida(f"O portal respondeu: {msg}")
    t.print("sem-resposta", html=True)
    raise TalvezEmitida("Não vi a NFS-e emitida a tempo. Confira no portal antes de mandar de novo.")


def baixar_arquivos(t: Tela) -> tuple[bytes | None, bytes]:
    """PDF (DANFSe) e XML pelos links de download da tela de nota emitida;
    se não estiverem lá, pela lista de notas emitidas (a mais recente)."""
    page = t.page
    achados: dict[str, bytes] = {}

    def pelos_links(escopo) -> None:
        for a in escopo.locator("a[href*='Download' i], a[href*='DANFSe' i], a[href*='/XML' i]").all():
            href = a.get_attribute("href") or ""
            if not href or href.startswith("#") or href.startswith("javascript"):
                continue
            try:
                r = page.context.request.get(_absoluta(page, href), timeout=60000)
            except Exception:  # noqa: BLE001
                continue
            tipo = tipo_arquivo(r.body())
            if tipo and tipo not in achados:
                achados[tipo] = r.body()

    pelos_links(page)
    if "xml" not in achados:
        page.goto(f"{URL}/Notas/Emitidas", wait_until="networkidle")
        t.print("lista-emitidas", html=True)
        linha = page.locator("table tbody tr").first
        if t.tem(linha):
            menu = linha.locator(".dropdown-toggle, button[data-toggle], button[data-bs-toggle]").first
            if t.tem(menu):
                menu.click()
                page.wait_for_timeout(500)
            pelos_links(linha)
            if "xml" not in achados:
                pelos_links(page.locator(".dropdown-menu.show, .popover, .menu-suspenso").first)
    if "xml" not in achados:
        raise TalvezEmitida("A nota parece emitida, mas não consegui baixar o XML. Confira no portal.")
    return achados.get("pdf"), achados["xml"]


def _absoluta(page: Page, href: str) -> str:
    if href.startswith("http"):
        return href
    base = re.match(r"https?://[^/]+", page.url).group(0)
    return base + (href if href.startswith("/") else "/" + href)


# ---------------------------------------------------------------- execução
def entregar(n: dict, pdf: bytes | None, xml: bytes, numero: str | None) -> str | None:
    cli = n["clientes"]
    destino = numero_whatsapp(cli.get("whatsapp_entrega") or cli.get("telefone"))
    if not destino:
        return "empresa sem WhatsApp no cadastro"
    tomador = n.get("tomador_nome") or "tomador não identificado"
    nome = f"NFS-e {numero or ''} {tomador[:30]}".strip()
    legenda = f"✅ NFS-e {numero or ''} emitida — {tomador}\nValor: R$ {valor_br(n['valor'])}"
    if pdf:
        erro = aviso.documento_para(destino, pdf, f"{nome}.pdf", legenda)
        if erro:
            return erro
        legenda = ""
    return aviso.documento_para(destino, xml, f"{nome}.xml", legenda, mimetype="application/xml")


def preencher(t: Tela, n: dict, senha: str) -> None:
    entrar(t, n["clientes"]["cnpj"], senha)
    abrir_dps(t)
    passo_pessoas(t, n)
    t.avancar("Pessoas")
    passo_servico(t, n)
    t.avancar("Serviço")
    passo_valores(t, n)
    t.avancar("Valores")


def emitir_nota(page: Page, n: dict) -> None:
    nid = n["id"]
    cli = n["clientes"]
    nome = f"{cli['nome']} → {n.get('tomador_nome') or 'sem tomador'}"
    t = Tela(page, PASTA / nid[:8])
    db.marcar(nid, "processando", "Entrando no Emissor Nacional", tentativas=(n.get("tentativas") or 0) + 1)
    senha = db.senha(cli["id"])
    if not senha:
        raise ErroPortal("Empresa sem senha do Emissor Nacional cadastrada no gestor.")
    preencher(t, n, senha)
    try:
        emitir(t, n, nome)
        pdf, xml = baixar_arquivos(t)
    except ErroPortal:
        raise
    except Exception as e:  # noqa: BLE001 — qualquer falha depois do clique pode ter emitido
        raise TalvezEmitida(f"Falha depois de emitir ({e}). Confira no portal antes de mandar de novo.") from e
    d = dados_xml(xml.decode("utf-8", "ignore"))
    agora = datetime.now().astimezone().isoformat()
    db.marcar(nid, "emitida", f"NFS-e {d['numero'] or ''} emitida", numero=d["numero"], chave=d["chave"],
              xml_path=db.guardar_arquivo(nid, xml, "xml", "application/xml"),
              pdf_path=db.guardar_arquivo(nid, pdf, "pdf", "application/pdf") if pdf else None)
    erro = entregar(n, pdf, xml, d["numero"])
    if erro:
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {d['numero']} emitida; não foi pelo WhatsApp: {erro}"[:500]})
    else:
        db.atualizar(nid, {"whatsapp_enviado_em": agora, "robo_mensagem": f"NFS-e {d['numero']} emitida e enviada ao cliente"
                           + ("" if pdf else " (só o XML: o portal não deu o PDF)")})
    aviso.texto(f"🧾 NFS-e {d['numero']} de {nome} (R$ {valor_br(n['valor'])}) emitida"
                + (f" — mas não foi ao cliente: {erro}" if erro else " e enviada ao cliente"))


def _navegador(pw):
    return pw.chromium.launch(headless=os.environ.get("ROBO_HEADLESS") == "1",
                              args=["--window-size=1280,800", "--window-position=0,0"])


def rodar() -> int:
    """Processa a fila. Devolve quantas notas pegou."""
    fila = db.notas_na_fila()
    if not fila:
        return 0
    log.info("NFS-e MEI: %d nota(s) na fila", len(fila))
    with sync_playwright() as pw:
        nav = _navegador(pw)
        for n in fila:
            nome = f"{n['clientes']['nome']} → {n.get('tomador_nome') or 'sem tomador'}"
            # uma sessão por nota: cada MEI entra com o próprio CNPJ
            contexto = nav.new_context(accept_downloads=True, locale="pt-BR", viewport={"width": 1280, "height": 800})
            page = contexto.new_page()
            try:
                if not digitos(n["clientes"].get("cnpj")):
                    raise ErroPortal("Empresa sem CNPJ no cadastro do gestor.")
                emitir_nota(page, n)
            except ErroPortal as e:
                talvez = isinstance(e, TalvezEmitida)
                log.warning("NFS-e MEI %s: %s", nome, e)
                db.marcar(n["id"], "erro", ("⚠️ " if talvez else "") + str(e), talvez_emitida=talvez)
                aviso.texto(f"❌ Robô de NFS-e MEI ({nome}): {e}")
            except Exception as e:  # noqa: BLE001 — antes de emitir: seguro mandar de novo
                log.exception("NFS-e MEI %s", nome)
                try:
                    PASTA.mkdir(parents=True, exist_ok=True)
                    base = PASTA / f"erro-{n['id'][:8]}-{datetime.now():%H%M%S}"
                    page.screenshot(path=f"{base}.png", full_page=True)
                    Path(f"{base}.html").write_text(page.content(), encoding="utf-8")
                except Exception:  # noqa: BLE001
                    pass
                db.marcar(n["id"], "erro", f"Falha antes de emitir: {str(e)[:300]}")
                aviso.texto(f"❌ Robô de NFS-e MEI ({nome}) parou antes de emitir: {str(e)[:200]}")
            finally:
                contexto.close()
        nav.close()
    return len(fila)


def explorar(nid: str) -> None:
    """Calibração: entra e preenche a nota até a conferência, SEM emitir.
    Prints e HTML de cada passo em /dados/nfse-mei/<nota>/."""
    n = db.nota(nid)
    if not n:
        raise SystemExit("Nota não encontrada.")
    senha = db.senha(n["clientes"]["id"])
    if not senha:
        raise SystemExit("Empresa sem senha do Emissor Nacional cadastrada no gestor.")
    with sync_playwright() as pw:
        nav = _navegador(pw)
        page = nav.new_context(locale="pt-BR", viewport={"width": 1280, "height": 800}).new_page()
        t = Tela(page, PASTA / nid[:8])
        try:
            preencher(t, n, senha)
            t.print("conferencia", html=True)
            print("Preenchida até a conferência, NÃO emitida. Confira pela tela remota; prints e HTML em", t.pasta)
            page.wait_for_timeout(5 * 60 * 1000)
        except ErroPortal as e:
            t.print("parou", html=True)
            print("Parou:", e, "— prints e HTML em", t.pasta)
        nav.close()
