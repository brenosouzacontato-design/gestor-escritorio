"""Supabase do gestor para o robô de NFS-e de MEI (nfse_mei.py).

Tabelas em supabase-schema-nfse-mei.sql. Mesma conexão do gestor_db.py
(service key, ignora RLS). A senha do portal vem cifrada (AES-256-GCM) com a
mesma chave do Netlify (NFSE_CERT_KEY), formato de netlify/functions/lib/nfse/cofre.js:
base64( iv[12] | tag[16] | dados ).
"""
from __future__ import annotations

import base64
import os

import requests

from gestor_db import BUCKET, _req, agora


def decifrar(b64: str, chave_b64: str | None = None) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    chave = base64.b64decode(chave_b64 or os.environ.get("NFSE_CERT_KEY", ""))
    if len(chave) != 32:
        raise RuntimeError("NFSE_CERT_KEY ausente ou inválida no .env do robô (a mesma do Netlify).")
    buf = base64.b64decode(b64)
    iv, tag, dados = buf[:12], buf[12:28], buf[28:]
    return AESGCM(chave).decrypt(iv, dados + tag, None).decode("utf-8")


_CLIENTE = "clientes(id,nome,cnpj,telefone,whatsapp_entrega)"


def notas_na_fila(limite: int = 5) -> list[dict]:
    try:
        return _req("GET", "/rest/v1/nfse_mei_notas", params={
            "select": f"*,{_CLIENTE}", "status": "eq.na_fila",
            "order": "criado_em.asc", "limit": str(limite),
        }) or []
    except RuntimeError as e:
        if "nfse_mei_notas" in str(e):  # SQL ainda não rodado: sem fila
            return []
        raise


def nota(nid: str) -> dict | None:
    r = _req("GET", "/rest/v1/nfse_mei_notas", params={"select": f"*,{_CLIENTE}", "id": f"eq.{nid}"})
    return r[0] if r else None


def _gestor(corpo: dict) -> requests.Response:
    gestor = os.environ.get("GESTOR_URL", "https://gestorcount.netlify.app").rstrip("/")
    return requests.post(f"{gestor}/.netlify/functions/nfse-mei", json=corpo, timeout=60,
                         headers={"x-robo-chave": os.environ["SUPABASE_SERVICE_KEY"]})


def entregar_pelo_gestor(nid: str) -> str | None:
    """O gestor manda o PDF/XML da nota no WhatsApp do cliente (mesmo envio do botão da tela;
    gera o DANFSe se o portal não deu o PDF). Devolve None se foi, ou o erro."""
    try:
        r = _gestor({"acao": "entregar", "id": nid})
    except requests.RequestException as e:
        return f"gestor não respondeu: {e}"
    if r.status_code >= 400:
        try:
            return r.json().get("erro") or r.text[:200]
        except ValueError:
            return r.text[:200]
    return None


def senha(cliente_id: str) -> str | None:
    """Com NFSE_CERT_KEY no .env, decifra aqui; sem ela (é secreta no Netlify), pede ao gestor
    (function nfse-mei), provando que tem a SUPABASE_SERVICE_KEY."""
    if os.environ.get("NFSE_CERT_KEY"):
        r = _req("GET", "/rest/v1/nfse_mei_acessos", params={"select": "senha_cifrada", "cliente_id": f"eq.{cliente_id}"})
        return decifrar(r[0]["senha_cifrada"]) if r else None
    resp = _gestor({"cliente_id": cliente_id})
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise RuntimeError(f"Gestor não entregou a senha do Emissor Nacional ({resp.status_code}): {resp.text[:200]}")
    return resp.json()["senha"]


def atualizar(nid: str, patch: dict) -> None:
    _req("PATCH", "/rest/v1/nfse_mei_notas", params={"id": f"eq.{nid}"},
         json={**patch, "atualizado_em": agora()}, headers={"Prefer": "return=minimal"})


def marcar(nid: str, status: str, msg: str | None = None, **extra) -> None:
    atualizar(nid, {"status": status, "robo_mensagem": (msg or None) and msg[:500], "robo_em": agora(), **extra})


def guardar_arquivo(nid: str, conteudo: bytes, extensao: str, mime: str) -> str:
    caminho = f"nfse-mei/{nid}.{extensao}"
    _req("POST", f"/storage/v1/object/{BUCKET}/{caminho}", data=conteudo,
         headers={"Content-Type": mime, "x-upsert": "true"})
    return caminho
