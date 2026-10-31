"""Avisos do robô: WhatsApp (Evolution API v1.8, a mesma do gestor) e,
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
    # Evolution v1.x exige o texto em textMessage.text (ver netlify/functions/lib/whatsapp.js)
    _evo("/message/sendText", {"textMessage": {"text": msg}})
    _tg("sendMessage", {"text": msg, "disable_web_page_preview": "true"})


def documento(conteudo: bytes, nome_arquivo: str, legenda: str = "") -> None:
    _evo("/message/sendMedia", {"mediaMessage": {
        "mediatype": "document", "fileName": nome_arquivo, "caption": legenda,
        "media": base64.b64encode(conteudo).decode(),
    }})
    _tg("sendDocument", {"caption": legenda}, files={"document": (nome_arquivo, conteudo, "application/pdf")})
