"""Acesso ao Supabase do gestor pela API REST, com a service key (ignora RLS,
como as Netlify Functions). Grava a guia do mesmo jeito que a tela
Parcelamentos (src/pages/parcelamentos/parcelamentosApi.js): arquivo no bucket
"documentos", linha em `documentos` ligada ao parcelamento e, se inequívoco,
à obrigação de parcelamento do mês.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone

import requests

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
BUCKET = "documentos"


def _req(metodo: str, caminho: str, **kw):
    r = requests.request(metodo, f"{URL}{caminho}", headers={**H, **kw.pop("headers", {})}, timeout=60, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"Supabase {metodo} {caminho}: {r.status_code} {r.text[:300]}")
    return r.json() if r.text else None


def agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def parcelamentos_para_buscar(origem: str = "PGFN") -> list[dict]:
    return _req("GET", "/rest/v1/parcelamentos", params={
        "select": "*,clientes(nome)",
        "origem": f"eq.{origem}", "status": "eq.ativo", "busca_automatica": "is.true",
        "order": "created_at.asc",
    })


def atualizar_parcelamento(pid: str, patch: dict) -> None:
    _req("PATCH", "/rest/v1/parcelamentos", params={"id": f"eq.{pid}"},
         json={**patch, "updated_at": agora()}, headers={"Prefer": "return=minimal"})


def marcar_busca(pid: str, status: str, msg: str | None = None) -> None:
    atualizar_parcelamento(pid, {"ultima_busca_em": agora(), "ultima_busca_status": status, "ultima_busca_msg": msg})


def guia_ja_existe(linha_digitavel: str) -> bool:
    r = _req("GET", "/rest/v1/documentos", params={"select": "id", "linha_digitavel": f"eq.{linha_digitavel}", "limit": 1})
    return bool(r)


def _obrigacao_do_mes(cliente_id: str, dados: dict) -> str | None:
    if not dados.get("vencimento"):
        return None
    comp = f"{dados['vencimento'][5:7]}/{dados['vencimento'][:4]}"
    obs = _req("GET", "/rest/v1/obrigacoes", params={
        "select": "id,titulo,tipo", "cliente_id": f"eq.{cliente_id}",
        "competencia": f"eq.{comp}", "status": "in.(pendente,vencido)",
    }) or []
    parc = [o for o in obs if re.search(r"PARCEL", f"{o.get('titulo') or ''} {o.get('tipo') or ''}", re.I)]
    if len(parc) == 1:
        return parc[0]["id"]
    padrao = r"MEI" if dados["origem"] == "PARCMEI" else r"PGFN|D[IÍ]VIDA|ATIVA"
    da_origem = [o for o in parc if re.search(padrao, f"{o.get('titulo') or ''} {o.get('tipo') or ''}", re.I)]
    return da_origem[0]["id"] if len(da_origem) == 1 else None


def gravar_guia(parcelamento: dict, conteudo: bytes, nome_arquivo: str, dados: dict) -> dict:
    caminho = f"parcelamentos/{uuid.uuid4()}.pdf"
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", data=conteudo,
         headers={"Content-Type": "application/pdf"})
    cliente_id = parcelamento.get("cliente_id")
    obrigacao_id = _obrigacao_do_mes(cliente_id, dados) if cliente_id else None
    tipo = "PARCELAMENTO MEI" if dados["origem"] == "PARCMEI" else "PARCELAMENTO PGFN"
    ts = agora()
    _req("POST", "/rest/v1/documentos", headers={"Prefer": "return=minimal"}, json={
        "cliente_id": cliente_id, "nome_arquivo": nome_arquivo, "storage_path": caminho,
        "tipo_mime": "application/pdf", "tamanho_bytes": len(conteudo),
        "tipo_documento_sugerido": tipo, "status": "confirmado", "confirmado_em": ts,
        "obrigacao_id": obrigacao_id, "valor_guia": dados.get("valor"),
        "vencimento_guia": dados.get("vencimento"), "valor_guia_extraido_em": ts,
        "linha_digitavel": dados.get("linha_digitavel"), "codigos_extraidos_em": ts,
        "parcelamento_id": parcelamento["id"], "parcela_numero": dados.get("parcela"),
    })
    return {"storage_path": caminho, "ligada_obrigacao": bool(obrigacao_id)}
