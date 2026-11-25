"""Robô do OneFlow: faz na tela web do OneFlow o que a API dele não oferece.
Primeira tarefa: baixar o relatório da folha de uma empresa/competência.

O escritório pede pela tela Fechamentos ERP ("Relatório da folha"); a tarefa
entra em tarefas_robo (supabase-schema-tarefas-robo.sql). Para cada tarefa
na fila o robô:
  1. abre o OneFlow com o perfil de navegador guardado em /dados/oneflow/perfil
     (a sessão fica salva; se caiu, avisa no WhatsApp e espera alguém entrar
     pela tela remota: o login da Omie/OneFlow tem reCAPTCHA);
  2. segue o ROTEIRO do tipo de tarefa (/dados/oneflow/roteiros/<tipo>.json):
     uma lista de passos (ir, clicar, preencher, escolher, teclar, esperar,
     baixar) com {competencia}, {cnpj}, {empresa}... no lugar dos valores;
  3. o arquivo do passo "baixar" vai para o bucket "documentos"
     (tarefas-robo/<id>.pdf) e a tarefa fica 'ok' — o link aparece no gestor.

Por que roteiro em JSON e não cliques fixos no código: não temos a tela do
OneFlow aqui. O roteiro é gravado uma vez no servidor, fazendo o caminho à mão
pela tela remota:
  python robo.py oneflow-gravar CNPJ MM/AAAA   # grava os cliques → roteiro rascunho
  python robo.py oneflow-testar CNPJ MM/AAAA   # roda o roteiro sem tarefa, com prints
Enquanto o roteiro não tiver "calibrado": true, as tarefas ficam na fila com o
recado "aguardando calibração" e nada é executado. Ver docs/robo-oneflow.md.

Só LÊ o OneFlow (relatórios). Tipos que alteram dados (calcular folha,
fechar competência) devem esperar aprovação, como o EMISSOR_TRANSMITIR.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import time
import unicodedata
from datetime import datetime
from pathlib import Path

from playwright.sync_api import Locator, Page, sync_playwright

import notificador as aviso
import oneflow_db as db

log = logging.getLogger("oneflow")

PASTA = Path(os.environ.get("PASTA_DADOS", "/dados")) / "oneflow"
ROTEIROS = PASTA / "roteiros"
MODELOS = Path(__file__).resolve().parent / "roteiros"  # exemplos que vêm com o robô
LINK_TELA = os.environ.get("LINK_TELA_REMOTA", "")
MINUTOS_PESSOA = int(os.environ.get("MINUTOS_CAPTCHA", "30"))
ESPERA = int(os.environ.get("ONEFLOW_ESPERA_MS", "20000"))
ENVIAR_PDF = os.environ.get("ONEFLOW_ENVIAR_PDF", "0") == "1"  # 1 = cada relatório vai no WhatsApp do escritório

NOMES = {"relatorio_folha": "Relatório da folha"}
ACOES = {"ir", "clicar", "preencher", "escolher", "teclar", "esperar", "baixar"}
PREFIXO_GRAVACAO = "ROBO_GRAVA:"


class ErroOneflow(Exception):
    """Falha que o escritório precisa ver (vai para a tarefa)."""


class NaoCalibrado(ErroOneflow):
    """Roteiro inexistente ou ainda sem "calibrado": true."""


# ---------------------------------------------------------------- funções puras
def digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def fmt_cnpj(doc: str) -> str:
    d = digitos(doc)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return d


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower().strip()


def variaveis(competencia: str, cnpj: str = "", empresa: str = "") -> dict:
    """Valores que um passo do roteiro pode usar entre chaves."""
    if not re.fullmatch(r"(0[1-9]|1[0-2])/\d{4}", competencia or ""):
        raise ErroOneflow(f"Competência inválida: {competencia!r} (use MM/AAAA)")
    mes, ano = competencia.split("/")
    return {
        "competencia": competencia, "mes": mes, "ano": ano,
        "competencia_iso": f"{ano}-{mes}", "competencia_traco": f"{mes}-{ano}",
        "cnpj": digitos(cnpj), "cnpj_fmt": fmt_cnpj(cnpj), "empresa": empresa or "",
    }


def preencher_variaveis(valor, vars_: dict):
    """Troca {nome} pelos valores; string, lista e dict (recursivo). Chave
    desconhecida é erro — melhor parar do que digitar "{compentencia}" no OneFlow."""
    if isinstance(valor, str):
        def troca(m: re.Match) -> str:
            nome = m.group(1)
            if nome not in vars_:
                raise ErroOneflow(f"Roteiro usa {{{nome}}}, que não existe. Use: {', '.join(sorted(vars_))}.")
            return str(vars_[nome])
        return re.sub(r"\{(\w+)\}", troca, valor)
    if isinstance(valor, list):
        return [preencher_variaveis(v, vars_) for v in valor]
    if isinstance(valor, dict):
        return {k: preencher_variaveis(v, vars_) for k, v in valor.items()}
    return valor


def validar_roteiro(r: dict) -> list[str]:
    """Problemas do roteiro (lista vazia = ok para rodar)."""
    erros = []
    if not isinstance(r, dict):
        return ["o roteiro precisa ser um objeto JSON"]
    if not r.get("inicio"):
        erros.append('falta "inicio" (endereço do OneFlow)')
    passos = r.get("passos")
    if not isinstance(passos, list) or not passos:
        return erros + ['falta a lista "passos"']
    for i, p in enumerate(passos, 1):
        acao = p.get("acao") if isinstance(p, dict) else None
        if acao not in ACOES:
            erros.append(f"passo {i}: ação {acao!r} desconhecida (use {', '.join(sorted(ACOES))})")
            continue
        if acao == "ir" and not p.get("url"):
            erros.append(f"passo {i}: ir sem url")
        if acao in ("clicar", "baixar") and not (p.get("texto") or p.get("seletor")):
            erros.append(f"passo {i}: {acao} sem texto nem seletor")
        if acao in ("preencher", "escolher") and not (p.get("campo") or p.get("seletor")):
            erros.append(f"passo {i}: {acao} sem campo nem seletor")
        if acao in ("preencher", "escolher") and "valor" not in p:
            erros.append(f"passo {i}: {acao} sem valor")
        if acao == "teclar" and not p.get("tecla"):
            erros.append(f"passo {i}: teclar sem tecla")
        if acao == "esperar" and not (p.get("texto") or p.get("seletor") or p.get("ms")):
            erros.append(f"passo {i}: esperar sem texto, seletor nem ms")
    if not any(isinstance(p, dict) and p.get("acao") == "baixar" for p in passos):
        erros.append('nenhum passo "baixar": o robô não teria o que guardar')
    return erros


def tipo_arquivo(conteudo: bytes) -> tuple[str, str] | None:
    """(extensão, mime) do relatório baixado; None se parece página de erro."""
    inicio = conteudo[:8].lstrip()
    if inicio.startswith(b"%PDF"):
        return "pdf", "application/pdf"
    if inicio.startswith(b"PK"):
        return "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if inicio.startswith(b"\xd0\xcf\x11\xe0"):
        return "xls", "application/vnd.ms-excel"
    return None


def nome_arquivo(tipo: str, empresa: str, competencia: str, extensao: str) -> str:
    base = f"{NOMES.get(tipo, tipo)} {empresa[:40]} {competencia.replace('/', '-')}"
    return re.sub(r'[\\/:*?"<>|]+', "-", base).strip() + f".{extensao}"


def generalizar(valor: str, vars_: dict) -> str:
    """Na gravação: troca o que foi digitado pelos {nomes}, para o roteiro
    servir para qualquer empresa/competência."""
    v = valor
    for nome in ("cnpj_fmt", "cnpj", "competencia", "competencia_iso", "competencia_traco", "empresa"):
        alvo = vars_.get(nome)
        if alvo and len(alvo) >= 6 and alvo in v:
            v = v.replace(alvo, "{" + nome + "}")
    return v


def passos_da_gravacao(eventos: list[dict], vars_: dict) -> list[dict]:
    """Eventos capturados na tela (clique, campo, download, navegação) →
    passos do roteiro. É um rascunho: confira antes de marcar calibrado."""
    passos: list[dict] = []
    for e in eventos:
        t = e.get("t")
        if t == "click":
            texto = (e.get("texto") or "").strip()
            if texto and len(texto) <= 40 and "\n" not in texto:
                passo = {"acao": "clicar", "texto": generalizar(texto, vars_)}
            elif e.get("sel"):
                passo = {"acao": "clicar", "seletor": e["sel"]}
            else:
                continue
            if passos and passos[-1] == passo:
                continue  # clique duplo / repetido
            passos.append(passo)
        elif t == "campo":
            passo = {"acao": "escolher" if e.get("tag") == "SELECT" else "preencher",
                     "seletor": e.get("sel"), "valor": generalizar(str(e.get("valor") or ""), vars_)}
            if e.get("rotulo"):
                passo["campo"] = e["rotulo"]
            if not passo["seletor"]:
                passo.pop("seletor")
            # o mesmo campo editado várias vezes: vale o último valor
            if passos and passos[-1].get("acao") == passo["acao"] and passos[-1].get("seletor") == passo.get("seletor"):
                passos[-1] = passo
            else:
                passos.append(passo)
        elif t == "download":
            # o clique que gerou o download vira o passo "baixar"
            if passos and passos[-1]["acao"] == "clicar":
                passos[-1] = {**passos[-1], "acao": "baixar"}
            else:
                passos.append({"acao": "baixar", "texto": "AJUSTAR: botão que gera o arquivo"})
    return passos


# ---------------------------------------------------------------- roteiro
def caminho_roteiro(tipo: str) -> Path:
    return ROTEIROS / f"{tipo}.json"


def carregar_roteiro(tipo: str) -> dict:
    arq = caminho_roteiro(tipo)
    if not arq.exists():
        modelo = MODELOS / f"{tipo}.exemplo.json"
        if modelo.exists():  # primeira vez: deixa o exemplo no lugar, para editar
            ROTEIROS.mkdir(parents=True, exist_ok=True)
            shutil.copy(modelo, arq)
        else:
            raise NaoCalibrado(f"Sem roteiro para {tipo}: grave com python robo.py oneflow-gravar.")
    try:
        r = json.loads(arq.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise NaoCalibrado(f"Roteiro {arq} ilegível: {e}") from e
    erros = validar_roteiro(r)
    if erros:
        raise NaoCalibrado(f"Roteiro {arq.name} com problema: " + "; ".join(erros))
    if r.get("calibrado") is not True:
        raise NaoCalibrado(f"Roteiro {arq.name} ainda não calibrado (grave e teste com oneflow-gravar/oneflow-testar).")
    return r


# ---------------------------------------------------------------- tela
class Tela:
    """Acha elementos na página e em todos os iframes (a Omie/OneFlow usa iframes)."""

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
            (self.pasta / f"{self.n:02d}-{nome}.html").write_text(self.page.content(), encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    def _candidatos(self, passo: dict, campo: bool = False):
        for frame in self.page.frames:
            if passo.get("seletor"):
                yield frame.locator(passo["seletor"])
                continue
            exato = bool(passo.get("exato"))
            if campo:
                rot = passo["campo"]
                yield frame.get_by_label(rot, exact=exato)
                yield frame.get_by_placeholder(rot, exact=exato)
            else:
                texto = passo["texto"]
                yield frame.get_by_role("button", name=texto, exact=exato)
                yield frame.get_by_role("link", name=texto, exact=exato)
                yield frame.get_by_role("menuitem", name=texto, exact=exato)
                yield frame.get_by_role("tab", name=texto, exact=exato)
                yield frame.get_by_text(texto, exact=exato)

    def achar(self, passo: dict, campo: bool = False, espera_ms: int | None = None) -> Locator:
        fim = time.time() + (espera_ms or passo.get("espera_ms") or ESPERA) / 1000
        n = int(passo.get("n") or 0)
        while True:
            for loc in self._candidatos(passo, campo):
                try:
                    # o n-ésimo VISÍVEL (sem filter(visible=), que não existe no Playwright 1.48 do Dockerfile)
                    visiveis = [loc.nth(i) for i in range(min(loc.count(), 30)) if loc.nth(i).is_visible()]
                    if len(visiveis) > n:
                        return visiveis[n]
                except Exception:  # noqa: BLE001 — frame que sumiu no meio da busca
                    continue
            if time.time() > fim:
                alvo = passo.get("seletor") or passo.get("campo") or passo.get("texto")
                raise ErroOneflow(f"Não achei na tela do OneFlow: {alvo!r}")
            self.page.wait_for_timeout(500)


def _baixar(page: Page, gatilho: Locator) -> bytes:
    """Clique que gera arquivo: download direto ou nova aba com o arquivo."""
    try:
        with page.expect_download(timeout=60000) as d:
            gatilho.click()
        return Path(d.value.path()).read_bytes()
    except Exception:  # noqa: BLE001
        pass
    with page.context.expect_page(timeout=15000) as nova:
        gatilho.click()
    aba = nova.value
    aba.wait_for_load_state()
    conteudo = page.context.request.get(aba.url).body()
    aba.close()
    return conteudo


def executar_roteiro(t: Tela, roteiro: dict, vars_: dict) -> bytes:
    """Roda os passos; devolve o arquivo do último "baixar"."""
    page = t.page
    arquivo = None
    for i, bruto in enumerate(roteiro["passos"], 1):
        p = preencher_variaveis(bruto, vars_)
        acao = p["acao"]
        rotulo = p.get("nota") or p.get("texto") or p.get("campo") or p.get("url") or p.get("tecla") or ""
        log.info("passo %d: %s %s", i, acao, rotulo)
        try:
            if acao == "ir":
                page.goto(p["url"], wait_until="domcontentloaded")
                page.wait_for_load_state("networkidle", timeout=ESPERA)
            elif acao == "clicar":
                t.achar(p).click()
            elif acao == "preencher":
                campo = t.achar(p, campo=bool(p.get("campo") and not p.get("seletor")))
                campo.fill(str(p["valor"]))
                if p.get("enter"):
                    campo.press("Enter")
            elif acao == "escolher":
                campo = t.achar(p, campo=bool(p.get("campo") and not p.get("seletor")))
                try:
                    campo.select_option(label=str(p["valor"]))
                except Exception:  # noqa: BLE001 — combo que não é <select>: abre e clica na opção
                    campo.click()
                    t.achar({"texto": str(p["valor"])}).click()
            elif acao == "teclar":
                page.keyboard.press(p["tecla"])
            elif acao == "esperar":
                if p.get("ms"):
                    page.wait_for_timeout(int(p["ms"]))
                else:
                    t.achar(p, espera_ms=int(p.get("espera_ms") or 120000))
            elif acao == "baixar":
                arquivo = _baixar(page, t.achar(p))
        except ErroOneflow:
            t.print(f"passo{i}-falhou")
            raise
        except Exception as e:  # noqa: BLE001
            t.print(f"passo{i}-falhou")
            raise ErroOneflow(f"Passo {i} ({acao} {rotulo}) falhou: {str(e)[:200]}") from e
        if p.get("pausa_ms"):
            page.wait_for_timeout(int(p["pausa_ms"]))
        t.print(f"passo{i}-{acao}")
    if arquivo is None:
        raise ErroOneflow("O roteiro terminou sem baixar arquivo.")
    return arquivo


# ---------------------------------------------------------------- sessão
def _parece_login(page: Page, roteiro: dict) -> bool:
    url = page.url.lower()
    if any(s.lower() in url for s in roteiro.get("login_se_url_contem") or ["login", "signin", "auth"]):
        return True
    return page.locator("input[type=password]").locator("visible=true").count() > 0


def garantir_login(page: Page, roteiro: dict, ao_esperar=None) -> None:
    page.goto(roteiro["inicio"], wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if not _parece_login(page, roteiro):
        return
    if ao_esperar:
        ao_esperar()
    aviso.texto(f"🔐 O robô do OneFlow precisa entrar no OneFlow. Abra {LINK_TELA}, faça o login "
                "(e o captcha, se aparecer); ele segue sozinho.")
    fim = time.time() + MINUTOS_PESSOA * 60
    while _parece_login(page, roteiro):
        if time.time() > fim:
            raise ErroOneflow("Ninguém entrou no OneFlow a tempo (tela remota).")
        page.wait_for_timeout(3000)
    page.wait_for_timeout(3000)  # deixa o OneFlow terminar de abrir depois do login


def _abrir_navegador(pw):
    (PASTA / "perfil").mkdir(parents=True, exist_ok=True)
    contexto = pw.chromium.launch_persistent_context(
        str(PASTA / "perfil"), headless=os.environ.get("ROBO_HEADLESS") == "1", accept_downloads=True,
        locale="pt-BR", viewport=None, args=["--window-size=1280,800", "--window-position=0,0"])
    page = contexto.pages[0] if contexto.pages else contexto.new_page()
    return contexto, page


# ---------------------------------------------------------------- execução
def processar(page: Page, tarefa: dict, roteiro: dict) -> str:
    tid = tarefa["id"]
    cli = tarefa.get("clientes") or {}
    empresa = cli.get("nome") or "empresa"
    if len(digitos(cli.get("cnpj"))) != 14:
        raise ErroOneflow("Empresa sem CNPJ no cadastro do gestor.")
    vars_ = variaveis(tarefa["competencia"], cli["cnpj"], empresa)
    t = Tela(page, PASTA / "execucoes" / tid[:8])
    garantir_login(page, roteiro, ao_esperar=lambda: db.marcar(tid, "aguardando_pessoa", "Esperando alguém entrar no OneFlow pela tela remota"))
    db.marcar(tid, "processando", "Gerando o relatório no OneFlow")
    conteudo = executar_roteiro(t, roteiro, vars_)
    tipo = tipo_arquivo(conteudo)
    if not tipo:
        t.print("arquivo-estranho")
        raise ErroOneflow("O OneFlow devolveu algo que não é PDF nem planilha (página de erro?). Veja os prints no servidor.")
    ext, mime = tipo
    nome = nome_arquivo(tarefa["tipo"], empresa, tarefa["competencia"], ext)
    caminho = db.guardar_arquivo(tid, conteudo, ext, mime)
    db.marcar(tid, "ok", f"{NOMES.get(tarefa['tipo'], tarefa['tipo'])} baixado ({len(conteudo) // 1024} KB)",
              arquivo_path=caminho, arquivo_nome=nome)
    if ENVIAR_PDF and ext == "pdf":
        aviso.documento(conteudo, nome, f"{empresa} — {NOMES.get(tarefa['tipo'], tarefa['tipo'])} {tarefa['competencia']}")
    # prints de execução que deu certo não precisam ficar ocupando o disco
    shutil.rmtree(t.pasta, ignore_errors=True)
    return nome


_ultimo_recado = ""


def rodar() -> int:
    """Processa a fila. Devolve quantas tarefas pegou."""
    global _ultimo_recado
    db.reabrir_travadas()
    fila = db.na_fila()
    if not fila:
        return 0
    roteiros: dict[str, dict] = {}
    prontas = []
    for tarefa in fila:
        try:
            roteiros.setdefault(tarefa["tipo"], carregar_roteiro(tarefa["tipo"]))
            prontas.append(tarefa)
        except NaoCalibrado as e:
            recado = f"Aguardando calibração do robô: {e}"
            if recado != _ultimo_recado:  # roda a cada minuto: avisa só quando muda
                db.avisar_fila(recado)
                aviso.texto(f"⚙️ Robô do OneFlow: há tarefas na fila, mas {e}")
                _ultimo_recado = recado
    if not prontas:
        return 0
    _ultimo_recado = ""
    log.info("OneFlow: %d tarefa(s) na fila", len(prontas))
    resultados = []
    with sync_playwright() as pw:
        contexto, page = _abrir_navegador(pw)
        for tarefa in prontas:
            empresa = (tarefa.get("clientes") or {}).get("nome") or tarefa["cliente_id"]
            if not db.pegar(tarefa):
                continue  # cancelada pela tela agora há pouco
            try:
                resultados.append(("✅", empresa, processar(page, tarefa, roteiros[tarefa["tipo"]])))
            except ErroOneflow as e:
                log.warning("OneFlow %s: %s", empresa, e)
                db.marcar(tarefa["id"], "erro", str(e))
                resultados.append(("❌", empresa, str(e)[:150]))
            except Exception as e:  # noqa: BLE001
                log.exception("OneFlow %s", empresa)
                db.marcar(tarefa["id"], "erro", f"Falha inesperada: {str(e)[:300]}")
                resultados.append(("❌", empresa, str(e)[:150]))
        contexto.close()
    if resultados:
        ok = sum(1 for r in resultados if r[0] == "✅")
        linhas = "\n".join(f"{s} {n}" + ("" if s == "✅" else f": {m}") for s, n, m in resultados)
        aviso.texto(f"🤖 Robô do OneFlow: {ok}/{len(resultados)} relatório(s) prontos no gestor (Fechamentos ERP).\n\n{linhas}")
    return len(resultados)


# ---------------------------------------------------------------- calibração
GRAVADOR_JS = r"""
(() => {
  if (window.__roboGrava) return; window.__roboGrava = true;
  const log = (o) => console.log('%s' + JSON.stringify(o));
  const css = (el) => {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && !/\d{3,}/.test(el.id)) return '#' + CSS.escape(el.id);
    const nome = el.getAttribute('name');
    if (nome) return el.tagName.toLowerCase() + '[name="' + nome + '"]';
    const partes = [];
    for (let e = el; e && e.nodeType === 1 && partes.length < 4; e = e.parentElement) {
      if (e.id && !/\d{3,}/.test(e.id)) { partes.unshift('#' + CSS.escape(e.id)); break; }
      const irmaos = e.parentElement ? [...e.parentElement.children].filter(x => x.tagName === e.tagName) : [];
      partes.unshift(e.tagName.toLowerCase() + (irmaos.length > 1 ? ':nth-of-type(' + (irmaos.indexOf(e) + 1) + ')' : ''));
    }
    return partes.join(' > ');
  };
  const rotulo = (el) => ((el.labels && el.labels[0] && el.labels[0].innerText) || el.placeholder ||
                          el.getAttribute('aria-label') || '').trim().slice(0, 60);
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('a,button,[role=button],[role=menuitem],[role=tab],[role=option],li,td,label') || ev.target;
    if (el.matches && el.matches('input[type=password]')) return;
    const texto = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 80);
    log({ t: 'click', texto, sel: css(el) });
  }, true);
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!el.matches || !el.matches('input,select,textarea') || el.type === 'password') return;
    const valor = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] || {}).text : el.value;
    log({ t: 'campo', tag: el.tagName, valor, sel: css(el), rotulo: rotulo(el) });
  }, true);
})();
""" % PREFIXO_GRAVACAO


def gravar(cnpj: str, competencia: str, tipo: str = "relatorio_folha", minutos: int = 20) -> Path:
    """Abre o OneFlow na tela remota e grava o caminho feito à mão até o
    download do relatório. Salva roteiros/<tipo>.gravado.json (rascunho)."""
    cli = db.cliente_por_cnpj(cnpj) or {}
    vars_ = variaveis(competencia, cnpj, cli.get("nome") or "")
    base = {"inicio": os.environ.get("ONEFLOW_URL", "https://app.omie.com.br/")}
    try:
        base = json.loads(caminho_roteiro(tipo).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    eventos: list[dict] = []
    pasta = PASTA / "gravacao"
    pasta.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        contexto, page = _abrir_navegador(pw)
        garantir_login(page, base)
        contexto.add_init_script(GRAVADOR_JS)

        def no_console(msg):
            if msg.text.startswith(PREFIXO_GRAVACAO):
                try:
                    eventos.append(json.loads(msg.text[len(PREFIXO_GRAVACAO):]))
                except ValueError:
                    pass

        baixou = []

        def no_download(d):
            eventos.append({"t": "download", "nome": d.suggested_filename})
            destino = pasta / d.suggested_filename
            d.save_as(str(destino))
            baixou.append(destino)

        def ligar(p: Page):
            p.on("console", no_console)
            p.on("download", no_download)

        ligar(page)
        contexto.on("page", ligar)
        page.reload()
        aviso.texto(f"🎥 Gravando o roteiro do OneFlow ({NOMES.get(tipo, tipo)}). Abra {LINK_TELA} e faça o caminho "
                    f"até baixar o relatório de {vars_['empresa'] or vars_['cnpj_fmt']} — {competencia}. "
                    f"A gravação para sozinha no download (ou em {minutos} min).")
        print(f"Gravando... faça o caminho pela tela remota até o download ({minutos} min no máximo).")
        fim = time.time() + minutos * 60
        while not baixou and time.time() < fim:
            page.wait_for_timeout(1000)
        page.wait_for_timeout(2000)
        contexto.close()
    roteiro = {**{k: v for k, v in base.items() if k not in ("passos", "calibrado")},
               "calibrado": False, "passos": passos_da_gravacao(eventos, vars_)}
    destino = ROTEIROS / f"{tipo}.gravado.json"
    ROTEIROS.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(roteiro, ensure_ascii=False, indent=2), encoding="utf-8")
    (pasta / f"eventos-{datetime.now():%Y%m%d-%H%M%S}.json").write_text(json.dumps(eventos, ensure_ascii=False, indent=2))
    print(f"{len(roteiro['passos'])} passo(s) gravados em {destino}" + (f"; arquivo em {baixou[0]}" if baixou else " (sem download!)"))
    print(f"Confira, renomeie para {caminho_roteiro(tipo).name}, rode oneflow-testar e marque \"calibrado\": true.")
    return destino


def testar(cnpj: str, competencia: str, tipo: str = "relatorio_folha", arquivo: str | None = None) -> None:
    """Roda o roteiro (calibrado ou não) para uma empresa, sem tarefa nem
    gravar no gestor. Prints e o arquivo em /dados/oneflow/teste/."""
    arq = Path(arquivo) if arquivo else caminho_roteiro(tipo)
    roteiro = json.loads(arq.read_text(encoding="utf-8"))
    erros = validar_roteiro(roteiro)
    if erros:
        raise SystemExit("Roteiro com problema:\n- " + "\n- ".join(erros))
    cli = db.cliente_por_cnpj(cnpj) or {}
    vars_ = variaveis(competencia, cnpj, cli.get("nome") or "")
    pasta = PASTA / "teste" / datetime.now().strftime("%Y%m%d-%H%M%S")
    with sync_playwright() as pw:
        contexto, page = _abrir_navegador(pw)
        t = Tela(page, pasta)
        garantir_login(page, roteiro)
        try:
            conteudo = executar_roteiro(t, roteiro, vars_)
        finally:
            contexto.close()
    tipo_arq = tipo_arquivo(conteudo)
    destino = pasta / nome_arquivo(tipo, vars_["empresa"] or vars_["cnpj"], competencia, tipo_arq[0] if tipo_arq else "bin")
    destino.write_bytes(conteudo)
    print(f"OK: {destino} ({len(conteudo) // 1024} KB)" + ("" if tipo_arq else " — ATENÇÃO: não parece PDF/planilha"))
    print(f"Prints de cada passo em {pasta}. Se estiver certo, marque \"calibrado\": true em {caminho_roteiro(tipo)}.")
