"""Robô do e-CAC: situação fiscal e pagamentos de todas as empresas com
procuração para o certificado A1 do escritório.

Uma execução:
  1. abre o e-CAC com o certificado (Playwright entrega o .pfx sozinho, sem
     janela de escolha) e espera o login — o captcha do gov.br é resolvido por
     uma pessoa pela tela remota (noVNC), com aviso no WhatsApp, igual ao
     robô de parcelamentos. É UM captcha por execução, não um por empresa;
  2. para cada empresa: troca o perfil (procurador → CNPJ), baixa o Relatório
     de Situação Fiscal (1x por semana, ECAC_SITUACAO_DIAS) e consulta os
     pagamentos dos últimos ECAC_DIAS_PAGAMENTOS dias;
  3. grava tudo no gestor (ecac_db.py) e manda o resumo no WhatsApp.

As telas do e-CAC mudam sem aviso, então o robô procura os serviços pelo
texto do link no menu e captura qualquer PDF que passe pelo navegador, em vez
de depender de ids fixos. `python robo.py ecac-explorar CNPJ` salva prints e
HTML de cada tela em /dados/ecac/explorar/ para ajustar os seletores.
"""
from __future__ import annotations

import logging
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from playwright.sync_api import Frame, Page, sync_playwright

import cruzamento as cz
import ecac_db as db
import notificador as aviso

log = logging.getLogger("ecac")

TZ_NOME = os.environ.get("TZ", "America/Sao_Paulo")
PASTA = Path(os.environ.get("PASTA_DADOS", "/dados"))
LINK_TELA = os.environ.get("LINK_TELA_REMOTA", "")
MINUTOS_LOGIN = int(os.environ.get("MINUTOS_CAPTCHA", "30"))

# Certificado e senha ficam em /dados/certificado (configurar-ecac.sh), fora
# do .env — o instalar.sh reescreve o .env a cada atualização.
CERT_PFX = os.environ.get("ECAC_CERT_PFX", "/dados/certificado/certificado.pfx")
CERT_SENHA_ARQ = os.environ.get("ECAC_CERT_SENHA_ARQUIVO", "/dados/certificado/senha.txt")


def _senha_cert() -> str:
    try:
        return Path(CERT_SENHA_ARQ).read_text(encoding="utf-8").strip()
    except OSError:
        return os.environ.get("ECAC_CERT_SENHA", "")


# sites que pedem o certificado no login (gov.br e o login próprio do e-CAC)
CERT_ORIGENS = [o.strip() for o in os.environ.get(
    "ECAC_CERT_ORIGENS",
    "https://certificado.sso.acesso.gov.br,https://certificado.cav.receita.fazenda.gov.br",
).split(",") if o.strip()]

URL_LOGIN = os.environ.get("ECAC_URL_LOGIN", "https://cav.receita.fazenda.gov.br/autenticacao/login")
URL_HOME = os.environ.get("ECAC_URL_HOME", "https://cav.receita.fazenda.gov.br/ecac/")
# Se vazios, o serviço é achado pelo texto do link no menu do e-CAC
URL_SITFIS = os.environ.get("ECAC_URL_SITUACAO", "")
URL_PAGTOS = os.environ.get("ECAC_URL_PAGAMENTOS", "")
TEXTO_SITFIS = os.environ.get("ECAC_TEXTO_SITUACAO", r"Situa..o Fiscal|Diagn.stico Fiscal")
TEXTO_PAGTOS = os.environ.get("ECAC_TEXTO_PAGAMENTOS", r"Comprovante de (Pagamento|Arrecada)|Consultar? Pagamentos")

DIAS_PAGAMENTOS = int(os.environ.get("ECAC_DIAS_PAGAMENTOS", "90"))
SITUACAO_DIAS = int(os.environ.get("ECAC_SITUACAO_DIAS", "7"))


class LoginNaoFeito(Exception):
    pass


class SemProcuracao(Exception):
    pass


class SessaoCaiu(Exception):
    pass


def configurado() -> str | None:
    """None se dá pra rodar; senão, o que falta."""
    if not Path(CERT_PFX).exists():
        return f"certificado não encontrado em {CERT_PFX}"
    if not _senha_cert():
        return f"senha do certificado não encontrada em {CERT_SENHA_ARQ} (rode configurar-ecac.sh)"
    return None


# ---------------------------------------------------------------- navegador
class Navegador:
    """Chromium visível (tela remota) com o certificado e captura de PDFs."""

    def __init__(self, pw):
        senha = _senha_cert()
        self.browser = pw.chromium.launch(
            headless=os.environ.get("ROBO_HEADLESS") == "1",
            args=["--window-size=1280,800", "--window-position=0,0"],
        )
        self.ctx = self.browser.new_context(
            viewport=None, accept_downloads=True, locale="pt-BR",
            client_certificates=[{"origin": o, "pfxPath": CERT_PFX, "passphrase": senha} for o in CERT_ORIGENS],
        )
        self.respostas_pdf: list = []
        self.downloads: list = []
        self.ctx.on("response", self._resposta)
        self.ctx.on("page", lambda p: p.on("download", lambda d: self.downloads.append(d)))
        self.page = self.ctx.new_page()
        # a primeira aba pode nascer antes do evento "page" ser tratado
        self.page.on("download", lambda d: self.downloads.append(d) if d not in self.downloads else None)

    def _resposta(self, r) -> None:
        if "pdf" in (r.headers.get("content-type") or "").lower():
            self.respostas_pdf.append(r)

    def limpar_pdfs(self) -> None:
        self.respostas_pdf.clear()
        self.downloads.clear()

    def pdf_capturado(self) -> bytes | None:
        for d in list(self.downloads):
            try:
                dado = Path(d.path()).read_bytes()
                if dado.startswith(b"%PDF"):
                    return dado
            except Exception:  # noqa: BLE001
                pass
        for r in list(self.respostas_pdf):
            try:
                dado = r.body()
                if dado.startswith(b"%PDF"):
                    return dado
            except Exception:  # noqa: BLE001
                pass
        return None

    def fechar(self) -> None:
        try:
            self.browser.close()
        except Exception:  # noqa: BLE001
            pass


def _frames(page: Page) -> list[Frame]:
    return [page.main_frame] + [f for f in page.frames if f != page.main_frame]


def _clicar_texto(page: Page, padrao: str, papeis=("button", "link")) -> bool:
    """Clica no primeiro botão/link visível (em qualquer frame) cujo nome bate."""
    rx = re.compile(padrao, re.I)
    for fr in _frames(page):
        for papel in papeis:
            loc = fr.get_by_role(papel, name=rx)
            try:
                for i in range(min(loc.count(), 5)):
                    item = loc.nth(i)
                    if item.is_visible():
                        item.click(timeout=5000)
                        return True
            except Exception:  # noqa: BLE001
                continue
    return False


def _texto_pagina(page: Page) -> str:
    partes = []
    for fr in _frames(page):
        try:
            partes.append(fr.evaluate("() => document.body ? document.body.innerText : ''"))
        except Exception:  # noqa: BLE001
            pass
    return "\n".join(partes)


def _na_tela_de_login(page: Page) -> bool:
    u = page.url.lower()
    return "autenticacao" in u or "sso.acesso.gov.br" in u


def logado(page: Page) -> bool:
    u = page.url.lower()
    return "cav.receita.fazenda.gov.br" in u and "/ecac" in u and "autenticacao" not in u


def salvar_tela(page: Page, nome: str, pasta: str = "erros") -> Path:
    destino = PASTA / pasta
    destino.mkdir(parents=True, exist_ok=True)
    base = destino / f"{nome}_{datetime.now():%Y%m%d_%H%M%S}"
    try:
        page.screenshot(path=f"{base}.png", full_page=True)
    except Exception:  # noqa: BLE001
        pass
    try:
        html = []
        for i, fr in enumerate(_frames(page)):
            html.append(f"<!-- frame {i}: {fr.url} -->\n{fr.content()}")
        Path(f"{base}.html").write_text("\n\n".join(html), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    return base


# ---------------------------------------------------------------- login
def entrar(page: Page, minutos: int = MINUTOS_LOGIN, ao_esperar: Callable[[int], None] | None = None) -> None:
    """Abre o login e espera chegar no e-CAC. O robô clica nos passos óbvios
    (gov.br → certificado digital) uma vez por tela; captcha e qualquer
    autorização do gov.br ficam pra pessoa na tela remota."""
    page.goto(URL_HOME, wait_until="domcontentloaded")
    if logado(page):
        return
    if not _na_tela_de_login(page):
        page.goto(URL_LOGIN, wait_until="domcontentloaded")
    inicio = time.time()
    proximo_lembrete = 10
    clicados: set[str] = set()
    while not logado(page):
        chave = page.url.split("?")[0]
        if chave not in clicados:
            clicados.add(chave)
            page.wait_for_timeout(1500)
            if "cav.receita" in chave:
                _clicar_texto(page, r"gov\.?br|entrar") or _clicar_texto(page, r"certificado")
            elif "sso.acesso.gov.br" in chave and "certificado." not in chave:
                _clicar_texto(page, r"certificado digital")
        decorrido = int((time.time() - inicio) / 60)
        if decorrido >= minutos:
            raise LoginNaoFeito(f"Login no e-CAC não concluído em {minutos} min.")
        if ao_esperar and decorrido >= proximo_lembrete:
            ao_esperar(decorrido)
            proximo_lembrete += 10
        page.wait_for_timeout(2000)
    page.wait_for_load_state("domcontentloaded")
    log.info("Login no e-CAC feito.")


# ---------------------------------------------------------------- perfil
JS_MARCAR_PERFIL = r"""
() => {
  document.querySelectorAll('[data-robo]').forEach(e => e.removeAttribute('data-robo'));
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')].filter(vis);
  const ehCnpj = i => /cnpj/i.test([i.id, i.name, i.placeholder, i.getAttribute('aria-label') || ''].join(' '))
    || (/procurador/i.test(i.closest('div,fieldset,form')?.innerText || '')
        && /cnpj/i.test(i.closest('div,fieldset')?.innerText || '')
        && !/cpf/i.test(i.closest('div')?.innerText || ''));
  const campo = document.querySelector('#txtNIPapel2') || inputs.find(ehCnpj);
  if (!campo) return false;
  campo.setAttribute('data-robo', 'cnpj');
  let box = campo.parentElement;
  for (let n = 0; box && n < 6; n++, box = box.parentElement) {
    const b = [...box.querySelectorAll('button, input[type=button], input[type=submit], a')]
      .filter(vis).find(x => /alterar|ok|confirmar/i.test(x.innerText || x.value || ''));
    if (b) { b.setAttribute('data-robo', 'alterar'); return true; }
  }
  return true;
}
"""


def fmt_cnpj(c: str) -> str:
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"


def trocar_perfil(page: Page, cnpj: str) -> None:
    page.goto(URL_HOME, wait_until="domcontentloaded")
    if not logado(page):
        raise SessaoCaiu("Sessão do e-CAC caiu.")
    if not (_clicar_texto(page, r"alterar perfil") or _clicar_seletor(page, "#btnPerfil")):
        raise RuntimeError("Não achei o botão 'Alterar perfil de acesso'.")
    page.wait_for_timeout(1500)
    alvo = None
    for fr in _frames(page):
        try:
            if fr.evaluate(JS_MARCAR_PERFIL):
                alvo = fr
                break
        except Exception:  # noqa: BLE001
            continue
    if not alvo:
        raise RuntimeError("Não achei o campo do CNPJ do procurador na troca de perfil.")
    campo = alvo.locator("[data-robo=cnpj]")
    campo.click()
    campo.fill("")
    campo.type(cnpj, delay=40)
    botao = alvo.locator("[data-robo=alterar]")
    if botao.count():
        botao.first.click()
    else:
        campo.press("Enter")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2500)
    texto = _texto_pagina(page)
    if re.search(r"n[aã]o\s+(h[aá]|existe|possui|foi\s+encontrad[ao])\s+procura[çc]", texto, re.I) or \
            re.search(r"procura[çc][aã]o.{0,40}(inexistente|n[aã]o\s+encontrad|expirad|cancelad)", texto, re.I):
        raise SemProcuracao("Sem procuração ativa para o certificado.")
    if fmt_cnpj(cnpj) not in texto and cnpj not in cz.digitos(texto):
        raise RuntimeError("A troca de perfil não confirmou o CNPJ na tela.")


def _clicar_seletor(page: Page, seletor: str) -> bool:
    for fr in _frames(page):
        loc = fr.locator(seletor)
        try:
            if loc.count() and loc.first.is_visible():
                loc.first.click()
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


# ---------------------------------------------------------------- serviços
JS_LINK = r"""
(p) => {
  const re = new RegExp(p, 'i');
  const a = [...document.querySelectorAll('a[href]')]
    .find(a => re.test(a.textContent || a.title || '') && !/^javascript/i.test(a.getAttribute('href')));
  return a ? a.href : null;
}
"""


def abrir_servico(page: Page, url: str, padrao: str) -> None:
    if not url:
        page.goto(URL_HOME, wait_until="domcontentloaded")
        for fr in _frames(page):
            try:
                url = fr.evaluate(JS_LINK, padrao)
            except Exception:  # noqa: BLE001
                url = None
            if url:
                break
        if not url:
            raise RuntimeError(f"Não achei no menu do e-CAC o serviço /{padrao}/.")
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    if _na_tela_de_login(page):
        raise SessaoCaiu("Sessão do e-CAC caiu.")


def baixar_situacao_fiscal(nav: Navegador, minutos: int = 5) -> bytes:
    page = nav.page
    nav.limpar_pdfs()
    abrir_servico(page, URL_SITFIS, TEXTO_SITFIS)
    fim = time.time() + minutos * 60
    tentados: set[str] = set()
    passos = [
        r"gerar\s+relat|emitir\s+relat|solicitar\s+relat",
        r"(visualizar|baixar|abrir|imprimir|download).{0,20}relat|relat[óo]rio.{0,20}(pdf|gerado)|clique\s+aqui",
    ]
    while time.time() < fim:
        dado = nav.pdf_capturado()
        if dado:
            return dado
        for p in passos:
            if p not in tentados and _clicar_texto(page, p):
                tentados.add(p)
                page.wait_for_timeout(4000)
                break
        else:
            # relatório pode demorar: tenta de novo o link de baixar a cada volta
            tentados.discard(passos[1])
            page.wait_for_timeout(5000)
    raise RuntimeError("O relatório de situação fiscal não chegou (nenhum PDF capturado).")


JS_DATAS = r"""
() => {
  document.querySelectorAll('[data-robo]').forEach(e => e.removeAttribute('data-robo'));
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const campos = [...document.querySelectorAll('input')].filter(vis).filter(i =>
    /date/.test(i.type) || /data|dt|inicio|inicial|final|fim|periodo/i.test([i.id, i.name, i.placeholder].join(' ')));
  if (campos.length < 2) return false;
  campos[0].setAttribute('data-robo', 'inicio');
  campos[1].setAttribute('data-robo', 'fim');
  return true;
}
"""

JS_TABELAS = r"""
() => {
  const out = [];
  for (const t of document.querySelectorAll('table')) {
    const linhas = [...t.querySelectorAll('tr')];
    if (!linhas.length) continue;
    let heads = [...t.querySelectorAll('thead th')].map(x => x.innerText.trim());
    let corpo = [...t.querySelectorAll('tbody tr')];
    if (!heads.length) {
      heads = [...linhas[0].querySelectorAll('th,td')].map(x => x.innerText.trim());
      corpo = linhas.slice(1);
    }
    if (!heads.some(h => /n[úu]mero|documento/i.test(h))) continue;
    for (const tr of corpo) {
      const tds = [...tr.querySelectorAll('td')].map(x => x.innerText.trim());
      if (tds.length < 3) continue;
      const o = {};
      heads.forEach((h, i) => { if (h) o[h] = tds[i] ?? ''; });
      out.push(o);
    }
  }
  return out;
}
"""


def _ler_tabelas(page: Page) -> list[dict]:
    linhas = []
    for fr in _frames(page):
        try:
            linhas += fr.evaluate(JS_TABELAS)
        except Exception:  # noqa: BLE001
            pass
    return linhas


def consultar_pagamentos(page: Page, inicio: str, fim: str) -> list[dict]:
    """Linhas cruas da tabela de pagamentos ({cabeçalho: texto}) no período
    de arrecadação (dd/mm/aaaa)."""
    abrir_servico(page, URL_PAGTOS, TEXTO_PAGTOS)
    alvo = None
    for fr in _frames(page):
        try:
            if fr.evaluate(JS_DATAS):
                alvo = fr
                break
        except Exception:  # noqa: BLE001
            continue
    if not alvo:
        raise RuntimeError("Não achei os campos de data na consulta de pagamentos.")
    for papel, valor in (("inicio", inicio), ("fim", fim)):
        campo = alvo.locator(f"[data-robo={papel}]")
        if (campo.get_attribute("type") or "") == "date":
            campo.fill(f"{valor[6:]}-{valor[3:5]}-{valor[:2]}")
        else:
            campo.fill(valor)
            if cz.digitos(campo.input_value()) != cz.digitos(valor):
                # campo com máscara: digita só os números
                campo.click()
                campo.fill("")
                campo.type(cz.digitos(valor), delay=40)
    if not _clicar_texto(page, r"^\s*(consultar|pesquisar|buscar)\s*$", papeis=("button", "link")):
        alvo.locator("[data-robo=fim]").press("Enter")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    vistos: dict[str, dict] = {}
    for _ in range(30):  # paginação
        novos = 0
        for linha in _ler_tabelas(page):
            chave = "|".join(linha.values())
            if chave not in vistos:
                vistos[chave] = linha
                novos += 1
        if not novos or not _clicar_texto(page, r"^\s*(pr[óo]xim[ao]|>|»)\s*$"):
            break
        page.wait_for_timeout(2500)
    if not vistos and not re.search(r"nenhum|n[aã]o\s+(foram\s+)?encontrad|sem\s+registro", _texto_pagina(page), re.I):
        raise RuntimeError("A consulta de pagamentos não mostrou tabela nem 'nenhum pagamento'.")
    return list(vistos.values())


# ---------------------------------------------------------------- execução
def _precisa_situacao(emp: dict, agora: datetime, forcar: bool) -> bool:
    if forcar:
        return True
    ultima = (emp.get("ecac") or {}).get("situacao_em")
    if not ultima:
        return True
    try:
        return datetime.fromisoformat(ultima.replace("Z", "+00:00")) < agora - timedelta(days=SITUACAO_DIAS)
    except ValueError:
        return True


def _avisar_login(minutos: int) -> None:
    aviso.texto(f"⏳ Robô do e-CAC esperando o login há {minutos} min. Abra {LINK_TELA} e resolva o captcha.")


def rodar(forcar_situacao: bool = False, so_cnpj: str | None = None) -> None:
    falta = configurado()
    if falta:
        aviso.texto(f"⚠️ Robô do e-CAC não rodou: {falta}.")
        return
    agora = datetime.now().astimezone()
    empresas = db.empresas_para_consultar()
    if so_cnpj:
        empresas = [e for e in empresas if e["cnpj"] == cz.digitos(so_cnpj)]
    if not empresas:
        log.info("e-CAC: nenhuma empresa para consultar.")
        return
    inicio, fim = cz.periodo_consulta(agora.date(), DIAS_PAGAMENTOS)
    competencia = cz.competencia_atual(agora)
    aviso.texto(
        f"🤖 Robô do e-CAC: {len(empresas)} empresa(s) para consultar. "
        f"Abra {LINK_TELA} e resolva o captcha do login (é um só); o resto ele faz sozinho."
    )

    res = {"ok": 0, "pendentes": [], "sem_procuracao": [], "erros": [], "baixadas": 0, "sem_guia": 0}
    with sync_playwright() as pw:
        nav = Navegador(pw)
        try:
            try:
                entrar(nav.page, ao_esperar=_avisar_login)
            except LoginNaoFeito as e:
                salvar_tela(nav.page, "ecac_login")
                aviso.texto(f"⏭️ Robô do e-CAC: {e} Fica para a próxima.")
                return
            for i, emp in enumerate(empresas, 1):
                log.info("e-CAC %d/%d: %s", i, len(empresas), emp["nome"])
                for tentativa in (1, 2):
                    try:
                        _consultar_empresa(nav, emp, agora, forcar_situacao, inicio, fim, competencia, res)
                        break
                    except SessaoCaiu as e:
                        if tentativa == 2:
                            db.marcar(emp["id"], status="erro", mensagem=str(e), ultima_consulta_em=db.agora())
                            res["erros"].append(f"{emp['nome']}: {e}")
                            break
                        aviso.texto(f"🔁 A sessão do e-CAC caiu. Resolva o captcha de novo: {LINK_TELA}")
                        entrar(nav.page, ao_esperar=_avisar_login)
                    except SemProcuracao as e:
                        db.marcar(emp["id"], status="sem_procuracao", mensagem=str(e), ultima_consulta_em=db.agora())
                        res["sem_procuracao"].append(emp["nome"])
                        break
                    except Exception as e:  # noqa: BLE001
                        log.exception("e-CAC falhou em %s", emp["nome"])
                        salvar_tela(nav.page, f"ecac_{emp['cnpj']}")
                        db.marcar(emp["id"], status="erro", mensagem=str(e)[:300], ultima_consulta_em=db.agora())
                        res["erros"].append(f"{emp['nome']}: {str(e)[:120]}")
                        break
        except LoginNaoFeito as e:
            aviso.texto(f"⏭️ Robô do e-CAC parou: {e}")
        finally:
            nav.fechar()

    linhas = [f"✅ {res['ok']} empresa(s) consultadas",
              f"💰 {res['baixadas']} guia(s) baixadas pelos pagamentos do e-CAC"]
    if res["sem_guia"]:
        linhas.append(f"🔎 {res['sem_guia']} pagamento(s) novos sem guia no gestor (ver Fiscal → Situação e-CAC)")
    if res["pendentes"]:
        linhas.append("⚠️ Com pendência na Receita: " + ", ".join(res["pendentes"]))
    if res["sem_procuracao"]:
        linhas.append("🔒 Sem procuração: " + ", ".join(res["sem_procuracao"]))
    if res["erros"]:
        linhas.append("❌ Erros:\n" + "\n".join(res["erros"]))
    aviso.texto("🤖 Resumo do e-CAC\n\n" + "\n".join(linhas))


def _consultar_empresa(nav: Navegador, emp: dict, agora: datetime, forcar: bool,
                       inicio: str, fim: str, competencia: str, res: dict) -> None:
    page = nav.page
    trocar_perfil(page, emp["cnpj"])
    partes, campos = [], {}
    if _precisa_situacao(emp, agora, forcar):
        ex = db.gravar_situacao_fiscal(emp, baixar_situacao_fiscal(nav), competencia)
        campos["situacao_em"] = db.agora()
        sit = ex.get("situacaoGeral") or "?"
        partes.append(f"situação {sit}")
        if sit == "pendente":
            res["pendentes"].append(emp["nome"])
    linhas = consultar_pagamentos(page, inicio, fim)
    cont = db.gravar_pagamentos(emp, linhas)
    campos["pagamentos_em"] = db.agora()
    partes.append(f"{len(linhas)} pagamento(s), {cont['baixadas']} guia(s) baixada(s), {cont['sem_guia']} novo(s) sem guia")
    res["ok"] += 1
    res["baixadas"] += cont["baixadas"]
    res["sem_guia"] += cont["sem_guia"]
    db.marcar(emp["id"], status="ok", mensagem=" · ".join(partes), ultima_consulta_em=db.agora(), **campos)


def explorar(cnpj: str) -> None:
    """Calibração: login, troca de perfil e abre cada serviço, salvando print
    e HTML de cada passo em /dados/ecac/explorar/. Não grava nada no gestor."""
    falta = configurado()
    if falta:
        print("Falta configurar:", falta)
        return
    cnpj = cz.digitos(cnpj)
    aviso.texto(f"🔧 Calibração do robô do e-CAC: abra {LINK_TELA} e resolva o captcha do login.")
    with sync_playwright() as pw:
        nav = Navegador(pw)
        page = nav.page
        try:
            entrar(page, ao_esperar=_avisar_login)
            print("login:", salvar_tela(page, "1_logado", "ecac/explorar"))
            try:
                trocar_perfil(page, cnpj)
                print("perfil ok")
            except Exception as e:  # noqa: BLE001
                print("perfil falhou:", e)
            print("perfil:", salvar_tela(page, "2_perfil", "ecac/explorar"))
            for nome, url, padrao in (("3_situacao", URL_SITFIS, TEXTO_SITFIS), ("4_pagamentos", URL_PAGTOS, TEXTO_PAGTOS)):
                try:
                    abrir_servico(page, url, padrao)
                    print(nome, "aberto:", page.url)
                except Exception as e:  # noqa: BLE001
                    print(nome, "falhou:", e)
                print(nome, salvar_tela(page, nome, "ecac/explorar"))
            try:
                pdf = baixar_situacao_fiscal(nav, minutos=3)
                (PASTA / "ecac/explorar/situacao.pdf").write_bytes(pdf)
                print("relatório de situação fiscal baixado:", len(pdf), "bytes")
            except Exception as e:  # noqa: BLE001
                print("relatório falhou:", e)
                salvar_tela(page, "5_situacao_falhou", "ecac/explorar")
            try:
                ini, fim = cz.periodo_consulta(datetime.now().date(), DIAS_PAGAMENTOS)
                linhas = consultar_pagamentos(page, ini, fim)
                print(f"{len(linhas)} linha(s) de pagamento. Primeiras:")
                for l in linhas[:3]:
                    print("  ", l, "→", cz.normalizar_linha(l))
            except Exception as e:  # noqa: BLE001
                print("pagamentos falhou:", e)
            salvar_tela(page, "6_pagamentos", "ecac/explorar")
        finally:
            nav.fechar()
