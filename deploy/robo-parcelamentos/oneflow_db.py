"""Supabase do gestor para o robô do OneFlow (oneflow.py).

Tabela: tarefas_robo (supabase-schema-tarefas-robo.sql), pedida pela tela
Fechamentos ERP via netlify/functions/tarefas-robo.js. Mesma conexão do
gestor_db.py (service key, ignora RLS).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from gestor_db import BUCKET, _req, agora

SELECT = "*,clientes(id,nome,cnpj)"


def _sem_tabela(e: RuntimeError) -> bool:
    return "tarefas_robo" in str(e)


def na_fila(limite: int = 10) -> list[dict]:
    try:
        return _req("GET", "/rest/v1/tarefas_robo", params={
            "select": SELECT, "status": "eq.na_fila", "order": "criado_em.asc", "limit": str(limite),
        }) or []
    except RuntimeError as e:
        if _sem_tabela(e):  # SQL ainda não rodado: sem fila
            return []
        raise


def tarefa(tid: str) -> dict | None:
    r = _req("GET", "/rest/v1/tarefas_robo", params={"select": SELECT, "id": f"eq.{tid}"})
    return r[0] if r else None


def pegar(t: dict) -> bool:
    """Passa a tarefa de 'na_fila' para 'processando'. False se alguém mudou
    antes (cancelada pela tela no mesmo instante)."""
    ts = agora()
    r = _req("PATCH", "/rest/v1/tarefas_robo", params={"id": f"eq.{t['id']}", "status": "eq.na_fila"},
             headers={"Prefer": "return=representation"},
             json={"status": "processando", "robo_mensagem": "Abrindo o OneFlow", "robo_em": ts,
                   "atualizado_em": ts, "tentativas": (t.get("tentativas") or 0) + 1})
    return bool(r)


def marcar(tid: str, status: str | None, msg: str | None = None, **extra) -> None:
    ts = agora()
    patch = {"robo_mensagem": (msg or None) and msg[:500], "robo_em": ts, "atualizado_em": ts, **extra}
    if status:
        patch["status"] = status
    _req("PATCH", "/rest/v1/tarefas_robo", params={"id": f"eq.{tid}"}, json=patch,
         headers={"Prefer": "return=minimal"})


def avisar_fila(msg: str) -> None:
    """Recado nas tarefas que esperam (sem mudar o status), ex.: roteiro não calibrado."""
    try:
        _req("PATCH", "/rest/v1/tarefas_robo", params={"status": "eq.na_fila"},
             json={"robo_mensagem": msg[:500]}, headers={"Prefer": "return=minimal"})
    except RuntimeError as e:
        if not _sem_tabela(e):
            raise


def reabrir_travadas(horas: int = 2, max_tentativas: int = 3) -> int:
    """Tarefa em 'processando' há mais de `horas` = o robô caiu no meio.
    Relatório não tem efeito colateral: volta para a fila (até max_tentativas)."""
    limite = (datetime.now(timezone.utc) - timedelta(hours=horas)).isoformat()
    try:
        travadas = _req("GET", "/rest/v1/tarefas_robo", params={
            "select": "id,tentativas", "status": "in.(processando,aguardando_pessoa)", "robo_em": f"lt.{limite}",
        }) or []
    except RuntimeError as e:
        if _sem_tabela(e):
            return 0
        raise
    for t in travadas:
        if (t.get("tentativas") or 0) >= max_tentativas:
            marcar(t["id"], "erro", "O robô parou no meio desta tarefa várias vezes. Confira no OneFlow e tente de novo.")
        else:
            marcar(t["id"], "na_fila", "O robô parou no meio; voltou para a fila.")
    return len(travadas)


def guardar_arquivo(tid: str, conteudo: bytes, extensao: str, mime: str) -> str:
    caminho = f"tarefas-robo/{tid}.{extensao}"
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", data=conteudo,
         headers={"Content-Type": mime, "x-upsert": "true"})
    return caminho


def cliente_por_cnpj(cnpj: str) -> dict | None:
    r = _req("GET", "/rest/v1/clientes", params={"select": "id,nome,cnpj", "limit": "5000"}) or []
    alvo = re.sub(r"\D", "", cnpj or "")
    return next((c for c in r if re.sub(r"\D", "", c.get("cnpj") or "") == alvo), None)
