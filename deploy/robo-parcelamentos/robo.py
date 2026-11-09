"""Robô de guias de parcelamento do gestor (servidor 24h).

Uso (dentro do container):
  python robo.py agendar        # fica rodando; executa nos dias de DIAS_EXECUCAO
  python robo.py rodar          # executa agora (ex.: docker compose exec robo python robo.py rodar)
  python robo.py rodar --forcar # busca mesmo quem já tem guia do mês
  python robo.py testar-aviso   # manda uma mensagem de teste no WhatsApp/Telegram
  python robo.py ecac [--situacao] [CNPJ]  # e-CAC agora (situação fiscal + pagamentos); ver ecac.py
  python robo.py ecac-explorar CNPJ        # calibração do e-CAC: prints/HTML em /dados/ecac/explorar
  python robo.py emissor                   # NF-e de venda: processa a fila agora (ver emissor.py)
  python robo.py emissor-explorar PEDIDO   # calibração do Emissor: preenche sem cadastrar nem transmitir
  python robo.py emissor-importar          # copia clientes/produtos do Emissor das empresas na fila (ver emissor_importar.py)
  python robo.py mei                       # NFS-e de MEI no Emissor Nacional: processa a fila agora (ver nfse_mei.py)
  python robo.py mei-entregar NOTA         # nota já emitida que não chegou ao cliente: o gestor monta o PDF e manda (sem captcha)
  python robo.py mei-baixar NOTA           # nota já emitida: baixa PDF/XML (captcha pela tela remota) e o gestor manda no WhatsApp
  python robo.py mei-explorar NOTA         # calibração do Emissor Nacional: preenche sem emitir, prints/HTML em /dados/nfse-mei

Fluxo de uma execução:
  1. lê no Supabase os parcelamentos PGFN ativos com busca_automatica;
  2. pula quem já tem guia com vencimento neste mês;
  3. avisa no WhatsApp que há captchas esperando, com o link da tela remota;
  4. para cada um: preenche o SISPAR, espera o captcha, emite, confere o PDF
     (CPF/CNPJ e conta), grava no gestor e manda o PDF no WhatsApp;
  5. manda o resumo (inclui os PARCMEI, que por enquanto são manuais).
"""
from __future__ import annotations

import calendar
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

import ecac
import emissor
import emissor_importar
import nfse_mei
import gestor_db as db
import notificador as aviso
import sispar
from leitor_guia import ler_pdf

TZ = ZoneInfo(os.environ.get("TZ", "America/Sao_Paulo"))
LINK_TELA = os.environ.get("LINK_TELA_REMOTA", "")
MINUTOS_CAPTCHA = int(os.environ.get("MINUTOS_CAPTCHA", "30"))
DIAS = [int(d) for d in os.environ.get("DIAS_EXECUCAO", "20,25").split(",") if d.strip()]
HORA = os.environ.get("HORA_EXECUCAO", "09:00")
PASTA = Path(os.environ.get("PASTA_DADOS", "/dados"))
# e-CAC: dias da semana (0 = segunda) e hora; vazio desliga
ECAC_DIAS = [int(d) for d in os.environ.get("ECAC_DIAS_SEMANA", "0,3").split(",") if d.strip()]
ECAC_HORA = os.environ.get("ECAC_HORA", "08:00")
# NF-e de venda (emissor.py): olha a fila a cada minuto; EMISSOR_ATIVO=0 desliga
EMISSOR_ATIVO = os.environ.get("EMISSOR_ATIVO", "1") == "1"
# NFS-e de MEI no Emissor Nacional (nfse_mei.py): olha a fila a cada minuto; MEI_ATIVO=0 desliga
MEI_ATIVO = os.environ.get("MEI_ATIVO", "1") == "1"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("robo")

fmt_moeda = lambda v: ("R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")) if v is not None else "—"
fmt_data = lambda iso: f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}" if iso else "—"


def nome_de(p: dict) -> str:
    return (p.get("clientes") or {}).get("nome") or p.get("nome_devedor") or p.get("conta")


def tem_guia_do_mes(p: dict, hoje: date) -> bool:
    return (p.get("ultima_guia_vencimento") or "").startswith(hoje.strftime("%Y-%m"))


def rodar(forcar: bool = False) -> None:
    hoje = datetime.now(TZ).date()
    todos = db.parcelamentos_para_buscar("PGFN")
    fila = [p for p in todos if forcar or not tem_guia_do_mes(p, hoje)]
    parcmei = [p for p in db.parcelamentos_para_buscar("PARCMEI") if not tem_guia_do_mes(p, hoje)]
    log.info("PGFN: %d ativos, %d na fila; PARCMEI sem guia do mês: %d", len(todos), len(fila), len(parcmei))

    if not fila:
        if parcmei:
            aviso.texto("🤖 Parcelamentos: nenhuma guia PGFN pendente.\n" + linha_parcmei(parcmei))
        return

    aviso.texto(
        f"🤖 Robô de parcelamentos: {len(fila)} guia(s) PGFN pra buscar — "
        + ", ".join(nome_de(p) for p in fila)
        + f".\n\nCada uma pede um captcha. Abra {LINK_TELA} e toque em \"I am human\" quando aparecer; "
        "o robô passa pro próximo sozinho."
    )

    resultados = []
    (PASTA / "erros").mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        navegador = pw.chromium.launch(headless=os.environ.get("ROBO_HEADLESS") == "1", args=["--window-size=1280,800", "--window-position=0,0"])
        contexto = navegador.new_context(viewport=None, accept_downloads=True, locale="pt-BR")
        page = contexto.new_page()
        for i, p in enumerate(fila, 1):
            nome = nome_de(p)
            try:
                emissao = sispar.emitir_parcela(
                    page, p["documento_devedor"], p["conta"], MINUTOS_CAPTCHA,
                    ao_preencher=lambda: db.marcar_busca(p["id"], "aguardando_captcha", f"Captcha {i}/{len(fila)}"),
                    ao_esperar=lambda m, nome=nome: aviso.texto(f"⏳ Ainda esperando o captcha de {nome} ({m} min). {LINK_TELA}"),
                )
                resultados.append(processar(p, emissao))
            except sispar.SemEmissao as e:
                # guarda a tela e a tabela de prestações, pra entender o porquê
                if e.diagnostico:
                    log.warning("Sem emissão em %s — tabela do SISPAR:\n%s", nome, e.diagnostico)
                foto = PASTA / "erros" / f"{p['conta']}_sem_emissao_{datetime.now():%Y%m%d_%H%M%S}.png"
                try:
                    page.screenshot(path=str(foto), full_page=True)
                except Exception:  # noqa: BLE001
                    pass
                # "não permite emissão" costuma ser rescisão/suspensão — vira alerta no gestor
                status = "nao_permite_emissao" if "não permite" in str(e) else "ok"
                db.marcar_busca(p["id"], status, str(e))
                resultados.append(("⚠️", nome, str(e)))
            except sispar.CaptchaNaoResolvido as e:
                db.marcar_busca(p["id"], "aguardando_captcha", str(e))
                resultados.append(("⏭️", nome, "captcha não resolvido — pulei"))
            except Exception as e:  # noqa: BLE001
                log.exception("Falha em %s", nome)
                foto = PASTA / "erros" / f"{p['conta']}_{datetime.now():%Y%m%d_%H%M%S}.png"
                try:
                    page.screenshot(path=str(foto), full_page=True)
                except Exception:  # noqa: BLE001
                    pass
                db.marcar_busca(p["id"], "erro", str(e)[:300])
                resultados.append(("❌", nome, str(e)[:200]))
        navegador.close()

    linhas = [f"{s} {n}: {m}" for s, n, m in resultados]
    if parcmei:
        linhas.append(linha_parcmei(parcmei))
    aviso.texto("🤖 Resumo dos parcelamentos\n\n" + "\n".join(linhas))


def processar(p: dict, emissao: sispar.Emissao) -> tuple[str, str, str]:
    nome = nome_de(p)
    dados = ler_pdf(emissao.conteudo)
    if not dados:
        raise RuntimeError("Não consegui ler o PDF emitido.")
    if dados["documento_digitos"] != p["documento_devedor"] or dados["conta"] != p["conta"]:
        raise RuntimeError(f"PDF não bate com o parcelamento (veio {dados['documento']} / {dados['conta']}).")
    dados["parcela"] = dados.get("parcela") or emissao.prestacao

    if dados.get("linha_digitavel") and db.guia_ja_existe(dados["linha_digitavel"]):
        db.marcar_busca(p["id"], "ok", "Guia já estava no gestor.")
        return ("✅", nome, "guia já estava no gestor")

    venc = dados.get("vencimento") or ""
    nome_arquivo = f"PARC {nome[:40]} {venc[5:7]}-{venc[:4]}.pdf".replace("/", "-")
    r = db.gravar_guia(p, emissao.conteudo, nome_arquivo, dados)

    patch = {"valor_parcela": dados.get("valor"), "ultima_guia_vencimento": venc or None}
    if emissao.total_parcelas:
        patch["total_parcelas"] = emissao.total_parcelas
    if emissao.prestacao:
        patch["parcela_atual"] = emissao.prestacao
    db.atualizar_parcelamento(p["id"], patch)

    faltam = f" · faltam {emissao.total_parcelas - emissao.prestacao}" if emissao.total_parcelas and emissao.prestacao else ""
    resumo = f"parcela {emissao.prestacao or '?'}/{emissao.total_parcelas or '?'} · {fmt_moeda(dados.get('valor'))} · vence {fmt_data(venc)}{faltam}"
    db.marcar_busca(p["id"], "ok", resumo + ("" if r["ligada_obrigacao"] else " · sem obrigação do mês"))
    aviso.documento(emissao.conteudo, nome_arquivo, f"{nome} — {resumo}")
    return ("✅", nome, resumo)


def linha_parcmei(lista: list[dict]) -> str:
    return f"📄 PARCMEI (Receita) sem guia do mês — emitir manual por enquanto: {', '.join(nome_de(p) for p in lista)}"


# ---------------------------------------------------------------- agenda
def dia_alvo(hoje: date, dia: int) -> date:
    """Dia `dia` do mês (ou o último), empurrado pra segunda se cair no fim de
    semana — o SISPAR/Regularize só funciona em dia útil."""
    alvo = date(hoje.year, hoje.month, min(dia, calendar.monthrange(hoje.year, hoje.month)[1]))
    while alvo.weekday() >= 5:
        alvo += timedelta(days=1)
    return alvo


def agendar() -> None:
    marca = PASTA / "ultima_execucao.txt"
    marca_ecac = PASTA / "ecac_ultima_execucao.txt"
    PASTA.mkdir(parents=True, exist_ok=True)
    log.info("Agenda: dias %s às %s (%s); e-CAC: dias da semana %s às %s", DIAS, HORA, TZ, ECAC_DIAS, ECAC_HORA)
    if ECAC_DIAS and ecac.configurado():
        log.warning("e-CAC desligado até configurar: %s", ecac.configurado())
    erro_nfe = ""
    erro_mei = ""
    while True:
        agora = datetime.now(TZ)
        hoje = agora.date()
        # e-CAC e parcelamentos usam a mesma tela remota: rodam um depois do outro
        ja_ecac = marca_ecac.read_text().strip() if marca_ecac.exists() else ""
        if (ECAC_DIAS and hoje.weekday() in ECAC_DIAS and agora.strftime("%H:%M") >= ECAC_HORA
                and agora.hour < 20 and ja_ecac != hoje.isoformat() and not ecac.configurado()):
            marca_ecac.write_text(hoje.isoformat())
            try:
                ecac.rodar()
            except Exception as e:  # noqa: BLE001
                log.exception("e-CAC falhou")
                aviso.texto(f"❌ Robô do e-CAC falhou: {e}")
        ja = marca.read_text().strip() if marca.exists() else ""
        if (agora.strftime("%H:%M") >= HORA and ja != hoje.isoformat()
                and any(dia_alvo(hoje, d) == hoje for d in DIAS) and agora.hour < 21):
            marca.write_text(hoje.isoformat())
            try:
                rodar()
            except Exception as e:  # noqa: BLE001
                log.exception("Execução falhou")
                aviso.texto(f"❌ Robô de parcelamentos falhou: {e}")
        if EMISSOR_ATIVO:
            try:
                emissor.rodar()
                emissor_importar.rodar()
                erro_nfe = ""
            except Exception as e:  # noqa: BLE001
                log.exception("Robô de NF-e falhou")
                if str(e) != erro_nfe:  # roda a cada minuto: avisa só quando o erro muda
                    aviso.texto(f"❌ Robô de NF-e falhou: {e}")
                erro_nfe = str(e)
        if MEI_ATIVO:
            try:
                nfse_mei.rodar()
                erro_mei = ""
            except Exception as e:  # noqa: BLE001
                log.exception("Robô de NFS-e MEI falhou")
                if str(e) != erro_mei:
                    aviso.texto(f"❌ Robô de NFS-e MEI falhou: {e}")
                erro_mei = str(e)
        time.sleep(60)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "agendar"
    if cmd == "rodar":
        rodar(forcar="--forcar" in sys.argv)
    elif cmd == "ecac":
        cnpj = next((a for a in sys.argv[2:] if not a.startswith("--")), None)
        ecac.rodar(forcar_situacao="--situacao" in sys.argv, so_cnpj=cnpj)
    elif cmd == "ecac-explorar":
        if len(sys.argv) < 3:
            sys.exit("Uso: python robo.py ecac-explorar CNPJ")
        ecac.explorar(sys.argv[2])
    elif cmd == "emissor":
        print(f"{emissor.rodar()} pedido(s) processado(s)")
    elif cmd == "emissor-explorar":
        if len(sys.argv) < 3:
            sys.exit("Uso: python robo.py emissor-explorar ID_DO_PEDIDO")
        emissor.explorar(sys.argv[2])
    elif cmd == "mei":
        print(f"{nfse_mei.rodar()} nota(s) processada(s)")
    elif cmd == "mei-explorar":
        if len(sys.argv) < 3:
            sys.exit("Uso: python robo.py mei-explorar ID_DA_NOTA")
        nfse_mei.explorar(sys.argv[2])
    elif cmd == "mei-entregar":
        if len(sys.argv) < 3:
            sys.exit("Uso: python robo.py mei-entregar ID_DA_NOTA")
        nfse_mei.entregar(sys.argv[2])
    elif cmd == "mei-baixar":
        if len(sys.argv) < 3:
            sys.exit("Uso: python robo.py mei-baixar ID_DA_NOTA")
        nfse_mei.baixar(sys.argv[2])
    elif cmd == "emissor-importar":
        print(f"{emissor_importar.rodar()} empresa(s) importada(s)")
    elif cmd == "testar-aviso":
        aviso.texto(f"🤖 Teste do robô de parcelamentos. Tela remota: {LINK_TELA}")
    else:
        agendar()
