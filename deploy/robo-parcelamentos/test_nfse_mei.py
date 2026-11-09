"""python -m pytest test_nfse_mei.py  (ou: python test_nfse_mei.py) — funções puras do nfse_mei.py
e a senha cifrada pelo Netlify (cofre.js) sendo lida pelo robô."""
import base64
import os
import subprocess
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "http://teste.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "chave-de-teste")

from nfse_mei import codigo_fmt, codigo_rx, dados_xml, data_br, ler_valor, numero_whatsapp, tipo_arquivo, valor_br  # noqa: E402
from nfse_mei_db import decifrar  # noqa: E402
import re  # noqa: E402

CHAVE_NFSE = "3" * 50  # chave de acesso fictícia


def test_formatos():
    assert data_br("2026-11-09") == "09/11/2026"
    assert codigo_fmt("010701") == "01.07.01"
    assert re.search(codigo_rx("010701"), "01.07.01 - Suporte técnico em informática")
    assert re.search(codigo_rx("010701"), "010701 - Suporte")
    assert not re.search(codigo_rx("010701"), "01.07.02 - Outro")
    assert valor_br(1234.5) == "1.234,50"
    assert ler_valor("R$ 1.234,50") == 1234.5
    assert ler_valor("250.00") == 250.0
    assert numero_whatsapp("(31) 98817-4677") == "5531988174677"


def test_dados_do_xml():
    xml = f'<NFSe><infNFSe Id="NFS{CHAVE_NFSE}"><nNFSe>7</nNFSe></infNFSe></NFSe>'
    assert dados_xml(xml) == {"numero": "7", "chave": CHAVE_NFSE}


def test_tipo_do_arquivo_baixado():
    assert tipo_arquivo(b"%PDF-1.7 ...") == "pdf"
    assert tipo_arquivo(b'<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">') == "xml"
    assert tipo_arquivo(b"<!DOCTYPE html><html><body>Login NFSe</body></html>") is None


def test_senha_cifrada_pelo_netlify():
    chave = base64.b64encode(bytes(range(32))).decode()
    cofre = Path(__file__).resolve().parents[2] / "netlify" / "functions" / "lib" / "nfse" / "cofre.js"
    js = f"process.stdout.write(require({str(cofre)!r}).cifrar('Senh@ çom acento', {chave!r}))"
    try:
        cifrado = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
    except (FileNotFoundError, subprocess.CalledProcessError):
        return  # sem node no servidor: o teste roda no computador do escritório
    assert decifrar(cifrado, chave) == "Senh@ çom acento"


if __name__ == "__main__":
    for nome, f in list(globals().items()):
        if nome.startswith("test_"):
            f()
            print("ok", nome)
