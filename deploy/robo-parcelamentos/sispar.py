"""Emissão da parcela no SISPAR público da PGFN (o atalho "DARF prestação" do
Regularize): CPF/CNPJ + número do parcelamento + hCaptcha. Não precisa de
login gov.br. O captcha é resolvido por uma pessoa pela tela remota (noVNC);
o robô só espera o token aparecer e segue sozinho.

Seletores conferidos na tela real em 30/10/2026 (versão 2.6.5 do SISPAR).
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Callable

from playwright.sync_api import Page, TimeoutError as PWTimeout

URL_FORM = "https://sisparnet.pgfn.fazenda.gov.br/sisparInternet/internet/darf/consultaParcelamentoDarfInternet.xhtml"
CAMPO_DOC = '[id="formConsultaParcelamentoDarf:imNrCpfCnpjParcelamento"]'
CAMPO_CONTA = '[id="formConsultaParcelamentoDarf:imNrContaParcelamento"]'


class SemEmissao(Exception):
    """O SISPAR recusou a emissão (ex.: 'situação do parcelamento não permite')."""


class CaptchaNaoResolvido(Exception):
    pass


@dataclass
class Emissao:
    conteudo: bytes
    prestacao: int | None
    total_parcelas: int | None
    pagas: int | None
    linhas: list = field(default_factory=list)


def _preencher(page: Page, seletor: str, valor: str) -> None:
    campo = page.locator(seletor)
    campo.click()
    campo.press("Control+A")
    campo.press("Delete")
    # máscara do campo: limpar via JS antes de digitar evita sobra do valor anterior
    page.eval_on_selector(seletor, "el => { el.value = '' }")
    campo.type(valor, delay=60)
    if re.sub(r"\D", "", campo.input_value()) != valor:
        raise RuntimeError(f"Campo não aceitou o valor ({campo.input_value()!r}).")


def _token_captcha(page: Page) -> str:
    return page.evaluate("() => document.querySelector('[name=h-captcha-response]')?.value || ''")


def esperar_captcha(page: Page, minutos: int, ao_esperar: Callable[[int], None] | None = None) -> None:
    """Espera alguém clicar no hCaptcha pela tela remota. `ao_esperar(min)` é
    chamado a cada 10 minutos de espera (lembrete)."""
    inicio = time.time()
    proximo_lembrete = 10
    while time.time() - inicio < minutos * 60:
        if _token_captcha(page):
            return
        decorrido = int((time.time() - inicio) / 60)
        if ao_esperar and decorrido >= proximo_lembrete:
            ao_esperar(decorrido)
            proximo_lembrete += 10
        page.wait_for_timeout(1500)
    raise CaptchaNaoResolvido(f"Captcha não resolvido em {minutos} min.")


def _linhas_prestacoes(page: Page) -> list[list[str]]:
    return page.evaluate("""() => [...document.querySelectorAll('tr')]
        .map(tr => [...tr.cells].map(td => td.innerText.trim()))
        .filter(c => c.length >= 5 && /^\\d{4}$/.test(c[0]))""")


def emitir_parcela(page: Page, documento: str, conta: str, minutos_captcha: int,
                   ao_preencher: Callable[[], None] | None = None,
                   ao_esperar: Callable[[int], None] | None = None) -> Emissao:
    page.goto(URL_FORM, wait_until="domcontentloaded")
    rejeitar = page.get_by_role("button", name="Rejeitar")
    if rejeitar.count() and rejeitar.first.is_visible():
        rejeitar.first.click()

    _preencher(page, CAMPO_DOC, documento)
    _preencher(page, CAMPO_CONTA, conta)
    if ao_preencher:
        ao_preencher()
    esperar_captcha(page, minutos_captcha, ao_esperar)

    page.get_by_role("button", name="Consultar").click()
    try:  # JSF: a resposta pode ser outra página ou mensagem na mesma
        page.wait_for_function(
            "() => document.body && /Dados da Negocia|N[AÃ]O PERMITE|INV[AÁ]LID|N[AÃ]O ENCONTRAD/i.test(document.body.innerText)",
            timeout=45000)
    except PWTimeout:
        pass
    page.wait_for_load_state("domcontentloaded")
    texto = page.inner_text("body")
    if "NAO PERMITE EMISSAO" in texto.upper().replace("Ã", "A"):
        raise SemEmissao("Situação do parcelamento não permite emissão de DARF.")
    if "consultaParcelamento" in page.url and "Dados da Negocia" not in texto:
        msgs = [l for l in texto.splitlines() if l.isupper() and len(l) > 15]
        raise RuntimeError("SISPAR não abriu o parcelamento: " + (msgs[-1] if msgs else "sem mensagem"))

    total = re.search(r"Total de Parcelas:\s*(\d+)", texto)
    linhas = _linhas_prestacoes(page)
    pagas = sum(1 for c in linhas if c[2] in ("0.00", "0,00"))

    nao_emitido = page.get_by_role("link", name="Não emitido")
    if not nao_emitido.count():
        raise SemEmissao("Nenhuma parcela em aberto para emitir.")
    alvo = nao_emitido.first
    prestacao = alvo.evaluate("a => a.closest('tr')?.cells[0]?.innerText.trim()")
    alvo.click()

    page.get_by_role("button", name="Emitir").locator("visible=true").first.click(timeout=20000)
    page.wait_for_load_state("networkidle")
    link_pdf = page.get_by_role("link", name=re.compile(r"^\d{10,}$")).first
    try:
        with page.expect_download(timeout=60000) as info:
            link_pdf.click()
        caminho = info.value.path()
        conteudo = open(caminho, "rb").read()
    except PWTimeout:
        raise RuntimeError("Cliquei no documento gerado, mas o PDF não baixou.")
    if not conteudo.startswith(b"%PDF"):
        raise RuntimeError("O arquivo baixado não é PDF.")

    return Emissao(
        conteudo=conteudo,
        prestacao=int(prestacao) if prestacao and prestacao.isdigit() else None,
        total_parcelas=int(total.group(1)) if total else None,
        pagas=pagas,
        linhas=linhas,
    )
