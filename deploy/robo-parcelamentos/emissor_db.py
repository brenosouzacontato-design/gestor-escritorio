"""Supabase do gestor para o robô do Emissor (pedidos de NF-e de venda).

Tabelas: nfe_solicitacoes (supabase-schema-nfe-solicitacoes.sql e
supabase-schema-nfe-robo.sql) e clientes. Mesma conexão do gestor_db.py
(service key, ignora RLS).
"""
from __future__ import annotations

from gestor_db import BUCKET, _req, agora


def pedidos_na_fila(limite: int = 5) -> list[dict]:
    return _req("GET", "/rest/v1/nfe_solicitacoes", params={
        "select": "*,clientes(id,nome,cnpj,telefone,whatsapp_entrega)",
        "robo_status": "eq.na_fila", "status": "eq.em_emissao",
        "order": "atualizado_em.asc", "limit": str(limite),
    }) or []


def pedido(pid: str) -> dict | None:
    r = _req("GET", "/rest/v1/nfe_solicitacoes", params={
        "select": "*,clientes(id,nome,cnpj,telefone,whatsapp_entrega)", "id": f"eq.{pid}",
    })
    return r[0] if r else None


def atualizar(pid: str, patch: dict) -> None:
    ts = agora()
    _req("PATCH", "/rest/v1/nfe_solicitacoes", params={"id": f"eq.{pid}"},
         json={**patch, "atualizado_em": ts}, headers={"Prefer": "return=minimal"})


def marcar_robo(pid: str, status: str, msg: str | None = None, **extra) -> None:
    atualizar(pid, {"robo_status": status, "robo_mensagem": (msg or None) and msg[:500], "robo_em": agora(), **extra})


def guardar_arquivo(pid: str, conteudo: bytes, extensao: str, mime: str) -> str:
    caminho = f"nfe-vendas/{pid}.{extensao}"
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", data=conteudo,
         headers={"Content-Type": mime, "x-upsert": "true"})
    return caminho


# ---------------------------------------------------------------- importar do Emissor
# (emissor_importar.py; colunas em supabase-schema-nfe-importacao.sql)
def importacoes_na_fila() -> list[dict]:
    try:
        return _req("GET", "/rest/v1/clientes", params={
            "select": "id,nome,cnpj", "emissor_importacao_status": "eq.na_fila",
            "order": "emissor_importacao_em.asc", "limit": "5",
        }) or []
    except RuntimeError as e:
        if "emissor_importacao" in str(e):  # SQL ainda não rodado: sem fila
            return []
        raise


def marcar_importacao(cliente_id: str, status: str, msg: str | None = None) -> None:
    _req("PATCH", "/rest/v1/clientes", params={"id": f"eq.{cliente_id}"}, headers={"Prefer": "return=minimal"},
         json={"emissor_importacao_status": status, "emissor_importacao_msg": msg, "emissor_importacao_em": agora()})


def destinatarios_do_cliente(cliente_id: str) -> list[dict]:
    return _req("GET", "/rest/v1/nfe_destinatarios", params={"select": "*", "cliente_id": f"eq.{cliente_id}", "limit": "5000"}) or []


def produtos_do_cliente(cliente_id: str) -> list[dict]:
    return _req("GET", "/rest/v1/nfe_produtos", params={"select": "*", "cliente_id": f"eq.{cliente_id}", "limit": "5000"}) or []


def criar_cadastro(tabela: str, dados: dict) -> dict:
    r = _req("POST", f"/rest/v1/{tabela}", json=dados, headers={"Prefer": "return=representation"})
    return r[0] if isinstance(r, list) else r


def atualizar_cadastro(tabela: str, cid: str, patch: dict) -> None:
    _req("PATCH", f"/rest/v1/{tabela}", params={"id": f"eq.{cid}"},
         json={**patch, "atualizado_em": agora()}, headers={"Prefer": "return=minimal"})
