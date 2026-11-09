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
    c = conteudo.lstrip(b"\xef\xbb\xbf").lstrip()
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


def chave_da_tela(page: Page) -> str | None:
    """Chave de acesso da tela "A NFS-e foi gerada com sucesso"."""
    try:
        m = re.search(r"Chave de Acesso:?\s*(\d{50})", page.inner_text("body"))
    except Exception:  # noqa: BLE001
        return None
    return m.group(1) if m else None


def numero_da_chave(chave: str) -> str:
    """Chave da NFS-e: município(7) amb(1) tpInsc(1) inscrição(14) nNFSe(13) AAMM(4) código(9) DV(1)."""
    return str(int(chave[23:36]))


def baixar_arquivos(t: Tela, chave: str, nome: str) -> tuple[bytes | None, bytes]:
    """PDF (DANFSe) e XML pela lista de notas emitidas. O portal pede um captcha (hCaptcha) para
    baixar: o robô avisa no WhatsApp e espera alguém marcar "Sou humano" pela tela remota (o robô
    não resolve captcha). Com o captcha resolvido pela pessoa, o robô clica em "Confirmar"; se o
    portal recusar a validação, reabre um captcha novo e avisa de novo."""
    page = t.page
    baixados: list = []

    def ligar(p: Page) -> None:
        p.on("download", lambda d: baixados.append(d))

    ligar(page)
    page.context.on("page", ligar)  # o portal pode abrir o arquivo em outra aba
    achados: dict[str, bytes] = {}
    avisos = 0
    for tipo in ("NFSe", "DANFSe"):
        page.goto(f"{URL}/Notas/Emitidas", wait_until="networkidle")
        link = page.locator(f"a[href*='/Download/{tipo}/{chave}']").first
        if not link.count():
            t.print("lista-sem-nota", html=True)
            raise ErroPortal(f"A nota {chave} não apareceu na lista de emitidas do portal.")
        antes = len(baixados)
        link.evaluate("a => a.click()")
        confirmou = False
        avisou_agora = False
        fim = time.time() + MINUTOS_PESSOA * 60
        while len(baixados) == antes and time.time() < fim:
            page.wait_for_timeout(1500)
            modal = page.locator(".modal.show, .modal.in, .modal[style*='display: block']").locator("visible=true").first
            if not modal.count():
                continue
            if page.get_by_text(re.compile(r"n.o foi poss.vel validar o hcaptcha", re.I)).locator("visible=true").count():
                # recusado: fecha e pede um captcha novo
                t.print("captcha-recusado")
                cancelar = modal.get_by_role("button", name=re.compile(r"cancelar", re.I)).first
                if cancelar.count():
                    cancelar.click()
                page.wait_for_timeout(1000)
                link.evaluate("a => a.click()")
                confirmou = False
                avisou_agora = False
                continue
            if not avisou_agora and avisos < 4:
                t.print("captcha")
                aviso.texto(f"🔐 NFS-e {numero_da_chave(chave)} de {nome} emitida. Para baixar o PDF/XML o portal pede o "
                            f"captcha: abra {LINK_TELA} e marque \"Sou humano\" (o robô clica em Confirmar sozinho).")
                avisou_agora = True
                avisos += 1
            resolvido = page.evaluate("() => [...document.querySelectorAll(\"[name='h-captcha-response'], "
                                      "[name='g-recaptcha-response']\")].some((e) => e.value)")
            if resolvido and not confirmou:
                page.wait_for_timeout(800)
                botao = modal.get_by_role("button", name=re.compile(r"confirmar", re.I)).first
                if botao.count():
                    botao.click()
                    confirmou = True
        if len(baixados) == antes:
            raise ErroPortal("Ninguém resolveu o captcha a tempo para baixar o PDF/XML.")
        conteudo = Path(baixados[-1].path()).read_bytes()
        tipo_ok = tipo_arquivo(conteudo)
        if tipo_ok:
            achados[tipo_ok] = conteudo
    if "xml" not in achados:
        raise ErroPortal("O arquivo baixado do portal não é o XML da NFS-e.")
    return achados.get("pdf"), achados["xml"]


def guardar_e_entregar(n: dict, pdf: bytes | None, xml: bytes, nome: str) -> None:
    """Leva PDF/XML para o gestor e pede ao gestor que mande no WhatsApp do cliente."""
    nid = n["id"]
    d = dados_xml(xml.decode("utf-8", "ignore"))
    db.marcar(nid, "emitida", f"NFS-e {d['numero'] or ''} emitida", numero=d["numero"], chave=d["chave"],
              xml_path=db.guardar_arquivo(nid, xml, "xml", "application/xml"),
              pdf_path=db.guardar_arquivo(nid, pdf, "pdf", "application/pdf") if pdf else None)
    erro = db.entregar_pelo_gestor(nid)
    if erro:
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {d['numero']} emitida; o gestor não mandou no WhatsApp: {erro}"[:500]})
    else:
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {d['numero']} emitida e enviada ao cliente pelo gestor"})
    aviso.texto(f"🧾 NFS-e {d['numero']} de {nome} (R$ {valor_br(n['valor'])}) emitida"
                + (f" — mas não foi ao cliente: {erro}" if erro else " e enviada ao cliente pelo gestor"))


# ---------------------------------------------------------------- execução
def pagina_impressao(t: Tela, chave: str) -> bytes:
    """Versão para impressão da nota (Notas/Visualizar/Impressao): o XML autorizado passado por
    XSLT, com todos os dados do DANFSe. Abre sem captcha (o download de PDF/XML pede captcha)."""
    page = t.page
    page.goto(f"{URL}/Notas/Visualizar/Index/{chave}", wait_until="networkidle")
    link = page.locator("a[href*='Visualizar/Impressao']").first
    if not link.count():
        t.print("visualizar-sem-impressao", html=True)
        raise ErroPortal(f"A nota {chave} não abriu no portal (sem o link de impressão).")
    href = link.get_attribute("href") or ""
    r = page.context.request.get(href if href.startswith("http") else "https://www.nfse.gov.br" + href)
    corpo = r.body()
    if r.status != 200 or chave.encode() not in corpo:
        raise ErroPortal(f"O portal não devolveu a página de impressão da nota (HTTP {r.status}).")
    return corpo


def entregar_com_impressao(t: Tela, n: dict, chave: str, nome: str) -> None:
    """Guarda a página de impressão no gestor; o gestor monta o DANFSe (PDF) com ela e manda no
    WhatsApp do cliente. Sem captcha: o XML fica no portal (python robo.py mei-baixar, se precisar)."""
    nid = n["id"]
    numero = numero_da_chave(chave)
    db.guardar_arquivo(nid, pagina_impressao(t, chave), "html", "text/html; charset=utf-8")
    erro = db.entregar_pelo_gestor(nid)
    if erro:
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {numero} emitida; o gestor não mandou no WhatsApp: {erro}"[:500]})
    else:
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {numero} emitida e enviada ao cliente pelo gestor"})
    aviso.texto(f"🧾 NFS-e {numero} de {nome} (R$ {valor_br(n['valor'])}) emitida"
                + (f" — mas não foi ao cliente: {erro}" if erro else " e enviada ao cliente pelo gestor"))


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
    except ErroPortal:
        raise
    except Exception as e:  # noqa: BLE001 — qualquer falha depois do clique pode ter emitido
        raise TalvezEmitida(f"Falha depois de emitir ({e}). Confira no portal antes de mandar de novo.") from e
    chave = chave_da_tela(page)
    if not chave:
        raise TalvezEmitida("O portal não mostrou a chave da nota. Confira no portal antes de mandar de novo.")
    # emitida: grava número e chave já, antes de qualquer outra coisa
    numero = numero_da_chave(chave)
    db.marcar(nid, "emitida", f"NFS-e {numero} emitida; montando o PDF", numero=numero, chave=chave)
    try:
        entregar_com_impressao(t, n, chave, nome)
    except Exception as e:  # noqa: BLE001 — a nota já saiu: nunca volta para a fila
        log.warning("NFS-e %s emitida, mas não foi entregue: %s", numero, e)
        db.atualizar(nid, {"robo_mensagem": f"NFS-e {numero} emitida, mas não foi ao cliente: {e}"[:500]})
        aviso.texto(f"⚠️ NFS-e {numero} de {nome} emitida, mas não mandei ao cliente ({e}). "
                    f"Para tentar de novo: python robo.py mei-entregar {nid}")


def entregar(nid: str) -> None:
    """Nota já emitida (tem chave) que não chegou ao cliente: entra, pega a página de impressão
    (sem captcha), e o gestor monta o PDF e manda no WhatsApp."""
    n = db.nota(nid)
    if not n or not n.get("chave"):
        raise SystemExit("Nota não encontrada ou sem chave de acesso.")
    nome = f"{n['clientes']['nome']} → {n.get('tomador_nome') or 'sem tomador'}"
    with sync_playwright() as pw:
        nav = _navegador(pw)
        page = nav.new_context(locale="pt-BR", viewport={"width": 1280, "height": 800}).new_page()
        t = Tela(page, PASTA / nid[:8])
        try:
            entrar(t, n["clientes"]["cnpj"], db.senha(n["clientes"]["id"]))
            entregar_com_impressao(t, n, n["chave"], nome)
            print("Pronto:", db.nota(nid).get("robo_mensagem"))
        finally:
            nav.close()


def baixar(nid: str) -> None:
    """PDF e XML oficiais do portal (pede captcha pela tela remota): entra, baixa, leva para o
    gestor e o gestor manda no WhatsApp. Só quando alguém precisar do XML; o normal é o PDF
    montado pelo gestor (entregar)."""
    n = db.nota(nid)
    if not n or not n.get("chave"):
        raise SystemExit("Nota não encontrada ou sem chave de acesso.")
    nome = f"{n['clientes']['nome']} → {n.get('tomador_nome') or 'sem tomador'}"
    with sync_playwright() as pw:
        nav = _navegador(pw)
        page = nav.new_context(accept_downloads=True, locale="pt-BR", viewport={"width": 1280, "height": 800}).new_page()
        t = Tela(page, PASTA / nid[:8])
        try:
            entrar(t, n["clientes"]["cnpj"], db.senha(n["clientes"]["id"]))
            pdf, xml = baixar_arquivos(t, n["chave"], nome)
            guardar_e_entregar(n, pdf, xml, nome)
            print("Pronto:", db.nota(nid).get("robo_mensagem"))
        finally:
            nav.close()


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
