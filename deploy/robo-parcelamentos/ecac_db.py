"""Gravação do robô do e-CAC no Supabase (service key, via gestor_db._req).
Schema: supabase-schema-ecac.sql.
"""
from __future__ import annotations

import base64
import hashlib
import os
import uuid
from datetime import date, timedelta

import requests

import cruzamento as cz
from gestor_db import BUCKET, KEY, _req, agora

GESTOR_URL = os.environ.get("GESTOR_URL", "https://gestorcount.netlify.app").rstrip("/")
BAIXA_POR = "robô e-CAC"


def empresas_para_consultar() -> list[dict]:
    """Clientes ativos com CNPJ (14 dígitos), menos os desmarcados na tela
    (ecac_empresas.monitorar = false). Junta o status da última consulta."""
    clientes = _req("GET", "/rest/v1/clientes", params={
        "select": "id,nome,cnpj", "ativo": "is.true", "order": "nome.asc",
    }) or []
    status = {e["cliente_id"]: e for e in (_req("GET", "/rest/v1/ecac_empresas", params={"select": "*"}) or [])}
    saida = []
    for c in clientes:
        cnpj = cz.digitos(c.get("cnpj"))
        e = status.get(c["id"], {})
        if len(cnpj) != 14 or e.get("monitorar") is False:
            continue
        saida.append({**c, "cnpj": cnpj, "ecac": e})
    return saida


def marcar(cliente_id: str, **campos) -> None:
    _req("POST", "/rest/v1/ecac_empresas", params={"on_conflict": "cliente_id"},
         headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
         json={"cliente_id": cliente_id, **campos, "atualizado_em": agora()})


# ---------------------------------------------------------------- situação fiscal
def _segredo_interno() -> str:
    # mesmo cálculo de netlify/functions/lib/autenticacao.js
    return hashlib.sha256(f"{KEY}:gestor-interno".encode()).hexdigest()


def gravar_situacao_fiscal(cliente: dict, pdf: bytes, competencia: str) -> dict:
    """Sobe o PDF, lê com a mesma IA do upload manual e grava em
    situacao_fiscal_rfb (substitui o da mesma competência)."""
    caminho = f"ecac/situacao/{uuid.uuid4()}.pdf"
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", data=pdf, headers={"Content-Type": "application/pdf"})
    r = requests.post(f"{GESTOR_URL}/.netlify/functions/extrair-situacao-fiscal", timeout=120,
                      headers={"content-type": "application/json", "x-segredo-interno": _segredo_interno()},
                      json={"pdfBase64": base64.b64encode(pdf).decode(), "filename": f"situacao-fiscal-{cliente['cnpj']}.pdf"})
    if r.status_code >= 400:
        raise RuntimeError(f"Leitura do relatório falhou ({r.status_code}): {r.text[:200]}")
    ex = r.json()
    if ex.get("tipoDocumento") not in (None, "relatorio"):
        raise RuntimeError(f"O PDF baixado não parece o Relatório de Situação Fiscal ({ex.get('tipoDocumento')}).")
    _req("POST", "/rest/v1/situacao_fiscal_rfb", params={"on_conflict": "cliente_id,competencia"},
         headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, json={
             "cliente_id": cliente["id"], "competencia": competencia,
             "data_emissao": ex.get("dataEmissao"), "situacao_geral": ex.get("situacaoGeral"),
             "debitos": ex.get("debitos") or [], "parcelamentos": ex.get("parcelamentos") or [],
             "dividas_ativas": ex.get("dividasAtivas") or [], "storage_path": caminho,
             "observacao_ia": ((ex.get("observacao") or "") + " (baixado pelo robô do e-CAC)").strip(),
         })
    return ex


# ---------------------------------------------------------------- pagamentos
def guias_da_empresa(cliente_id: str) -> list[dict]:
    """Guias anexadas da empresa (direto no cliente ou pela obrigação) dos
    últimos ~13 meses — as candidatas ao cruzamento."""
    desde = (date.today() - timedelta(days=400)).isoformat()
    campos = "id,linha_digitavel,valor_guia,vencimento_guia,pago_em,created_at"
    obrig = _req("GET", "/rest/v1/obrigacoes", params={"select": "id", "cliente_id": f"eq.{cliente_id}"}) or []
    guias = {}
    consultas = [{"cliente_id": f"eq.{cliente_id}"}]
    ids = [o["id"] for o in obrig]
    for i in range(0, len(ids), 150):  # URL não pode ficar enorme
        consultas.append({"obrigacao_id": f"in.({','.join(ids[i:i + 150])})"})
    for filtro in consultas:
        for g in _req("GET", "/rest/v1/documentos", params={
            "select": campos, "status": "eq.confirmado", "created_at": f"gte.{desde}", **filtro,
        }) or []:
            if g.get("linha_digitavel") or g.get("valor_guia") is not None:
                guias[g["id"]] = g
    return list(guias.values())


def gravar_pagamentos(cliente: dict, linhas: list[dict]) -> dict:
    """Grava os pagamentos lidos e dá baixa nas guias que baterem.
    Devolve contagem {novos, baixadas, sem_guia}."""
    regs = [r for r in (cz.normalizar_linha(l) for l in linhas) if r]
    existentes = {p["numero_documento"]: p for p in (_req("GET", "/rest/v1/ecac_pagamentos", params={
        "select": "id,numero_documento,guia_id", "cliente_id": f"eq.{cliente['id']}"}) or [])}
    guias = guias_da_empresa(cliente["id"])
    usadas = {p["guia_id"] for p in existentes.values() if p.get("guia_id")}
    cont = {"novos": 0, "baixadas": 0, "sem_guia": 0}

    for reg in regs:
        ant = existentes.get(reg["numero_documento"])
        if ant and ant.get("guia_id"):
            continue  # já cruzado antes
        guia, como = cz.achar_guia(reg, guias, usadas)
        linha = {**reg, "cliente_id": cliente["id"], "guia_id": guia["id"] if guia else None, "como_cruzou": como}
        _req("POST", "/rest/v1/ecac_pagamentos", params={"on_conflict": "cliente_id,numero_documento"},
             headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, json=linha)
        if not ant:
            cont["novos"] += 1
        if not guia:
            if not ant:
                cont["sem_guia"] += 1
            continue
        usadas.add(guia["id"])
        if not guia.get("pago_em") and dar_baixa(guia["id"], reg):
            guia["pago_em"] = reg.get("data_arrecadacao")
            cont["baixadas"] += 1
    return cont


def dar_baixa(guia_id: str, pagamento: dict) -> bool:
    """Marca a guia como paga (só se ainda estiver em aberto — nunca passa
    por cima de uma baixa manual)."""
    pago = pagamento.get("data_arrecadacao")
    r = _req("PATCH", "/rest/v1/documentos", params={"id": f"eq.{guia_id}", "pago_em": "is.null", "select": "id"},
             headers={"Prefer": "return=representation"}, json={
                 "pago_em": f"{pago}T12:00:00Z" if pago else agora(),
                 "valor_pago": pagamento.get("valor_total"),
                 "baixa_manual": False, "baixa_justificativa": None,
                 "baixa_por": BAIXA_POR, "baixa_registrada_em": agora(),
             })
    return bool(r)
