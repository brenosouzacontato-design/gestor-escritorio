"""Avisos do robô: WhatsApp (Evolution API 1.x ou 2.x, a mesma do gestor) e,
opcionalmente, Telegram. Nunca derruba o robô — falha de aviso só vai pro log.
"""
from __future__ import annotations

import base64
import logging
import os

import requests

log = logging.getLogger("notificador")

EVO_URL = os.environ.get("EVOLUTION_API_URL", "http://evolution:8080").rstrip("/")
EVO_KEY = os.environ.get("EVOLUTION_API_KEY", "")
EVO_INST = os.environ.get("EVOLUTION_INSTANCE", "gestor-escritorio")
NUMEROS = [n.strip() for n in os.environ.get("NOTIFICAR_WHATSAPP", "").split(",") if n.strip()]
TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "")


_versao: int | None = None


def _versao_evo() -> int:
    """1 ou 2: EVOLUTION_API_VERSAO, ou o que a Evolution informa em GET /.
    A 2.x mudou o corpo do envio (ver netlify/functions/lib/whatsapp.js)."""
    global _versao
    fixa = os.environ.get("EVOLUTION_API_VERSAO", "").strip()
    if fixa:
        return 1 if fixa.startswith("1") else 2
    if _versao is None:
        try:
            v = str(requests.get(f"{EVO_URL}/", timeout=5).json().get("version", ""))
            _versao = 2 if v.split(".")[0].isdigit() and int(v.split(".")[0]) >= 2 else 1
        except (requests.RequestException, ValueError) as e:
            log.warning("Evolution: versão desconhecida (%s), usando o formato da 1.x", e)
            return 1
    return _versao


def _corpo_texto(msg: str) -> dict:
    return {"text": msg} if _versao_evo() >= 2 else {"textMessage": {"text": msg}}


def _corpo_documento(midia: dict) -> dict:
    midia = {"mediatype": "document", "mimetype": "application/pdf", **midia}
    return midia if _versao_evo() >= 2 else {"mediaMessage": midia}


def _evo(caminho: str, corpo: dict) -> None:
    if not (EVO_KEY and NUMEROS):
        return
    for numero in NUMEROS:
        try:
            r = requests.post(f"{EVO_URL}{caminho}/{EVO_INST}", json={"number": numero, **corpo},
                              headers={"apikey": EVO_KEY}, timeout=30)
            if r.status_code >= 400:
                log.warning("Evolution %s -> %s: %s", caminho, r.status_code, r.text[:300])
        except requests.RequestException as e:
            log.warning("Evolution %s falhou: %s", caminho, e)


def _tg(metodo: str, data: dict, files: dict | None = None) -> None:
    if not (TG_TOKEN and TG_CHAT):
        return
    try:
        requests.post(f"https://api.telegram.org/bot{TG_TOKEN}/{metodo}",
                      data={"chat_id": TG_CHAT, **data}, files=files, timeout=30)
    except requests.RequestException as e:
        log.warning("Telegram %s falhou: %s", metodo, e)


def texto(msg: str) -> None:
    log.info("AVISO: %s", msg.replace("\n", " | "))
    _evo("/message/sendText", _corpo_texto(msg))
    _tg("sendMessage", {"text": msg, "disable_web_page_preview": "true"})


def documento_para(numero: str, conteudo: bytes, nome_arquivo: str, legenda: str = "",
                   mimetype: str = "application/pdf") -> str | None:
    """Arquivo para um número/grupo qualquer (ex.: a NF-e para o cliente).
    Devolve None se foi, ou o erro — quem chama decide o que fazer."""
    if not EVO_KEY:
        return "EVOLUTION_API_KEY não configurada."
    try:
        r = requests.post(f"{EVO_URL}/message/sendMedia/{EVO_INST}", headers={"apikey": EVO_KEY}, timeout=60, json={
            "number": numero, **_corpo_documento({
                "mimetype": mimetype, "fileName": nome_arquivo, "caption": legenda,
                "media": base64.b64encode(conteudo).decode(),
            })})
        if r.status_code >= 400:
            return f"WhatsApp recusou ({r.status_code}): {r.text[:200]}"
        return None
    except requests.RequestException as e:
        return str(e)


def documento(conteudo: bytes, nome_arquivo: str, legenda: str = "") -> None:
    _evo("/message/sendMedia", _corpo_documento({
        "fileName": nome_arquivo, "caption": legenda,
        "media": base64.b64encode(conteudo).decode(),
    }))
    _tg("sendDocument", {"caption": legenda}, files={"document": (nome_arquivo, conteudo, "application/pdf")})
