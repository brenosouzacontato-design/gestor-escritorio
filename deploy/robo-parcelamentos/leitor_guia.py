"""Leitura de guias de parcelamento (PDF) — versão Python do
src/pages/parcelamentos/leitorGuiaParcelamento.js (mesmas regras, mesmos campos).
"""
from __future__ import annotations

import io
import re
import unicodedata

import pdfplumber

RE_CNPJ = re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b")
RE_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RE_LINHA = re.compile(r"(8\d{10})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)")
MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def _br(s: str | None) -> float | None:
    return float(s.replace(".", "").replace(",", ".")) if s else None


def _iso(s: str | None) -> str | None:
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _competencia(periodo: str | None) -> str | None:
    m = re.match(r"^([A-Za-zÀ-ú]+)/(\d{4})$", periodo or "")
    if not m:
        return None
    nome = _sem_acento(m.group(1))
    return f"{MESES.index(nome) + 1:02d}/{m.group(2)}" if nome in MESES else None


def interpretar_texto(texto: str) -> dict | None:
    t = (texto or "").replace(" ", " ")
    if re.search(r"PARCMEI", t, re.I):
        origem = "PARCMEI"
    elif re.search(r"SISPAR", t, re.I):
        origem = "PGFN"
    else:
        return None

    cnpj, cpf = RE_CNPJ.search(t), RE_CPF.search(t)
    if cnpj and (not cpf or cnpj.start() < cpf.start()):
        doc = cnpj.group(0)
    else:
        doc = cpf.group(0) if cpf else None

    nome = None
    if doc:
        linha = t[t.index(doc) + len(doc):].split("\n")[0]
        nome = re.sub(r"\s+", " ", linha).strip()
        nome = re.sub(r"^\d{2}\.\d{3}\.\d{3}\s+", "", nome)
        nome = re.sub(r"\s+\d{11}$", "", nome) or None

    linha_m = RE_LINHA.search(t)
    num_doc = re.search(r"Número:\s*(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)", t) or re.search(r"\b(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)\b", t)
    venc = re.search(r"Pagar até:\s*(\d{2}/\d{2}/\d{4})", t)
    valor = re.search(r"Valor:\s*([\d.]+,\d{2})", t) or re.search(r"Valor Total do Documento\s+([\d.]+,\d{2})", t)
    parc = re.search(r"Número da Parcela:\s*(\d+)\s*/\s*(\d+)", t)
    if origem == "PGFN":
        conta = re.search(r"SISPAR:\s*(\d+)", t)
    else:
        conta = re.search(r"Número do Parcelamento:\s*(\d+)", t)
    periodo = re.search(r"\b([A-Za-zÀ-ú]+/\d{4})\b", t)

    return {
        "origem": origem,
        "documento": doc,
        "documento_digitos": re.sub(r"\D", "", doc or ""),
        "nome": nome,
        "conta": conta.group(1) if conta else None,
        "parcela": int(parc.group(1)) if parc else None,
        "total_parcelas": int(parc.group(2)) if parc else None,
        "competencia": _competencia(periodo.group(1) if periodo else None),
        "vencimento": _iso(venc.group(1) if venc else None),
        "valor": _br(valor.group(1) if valor else None),
        "linha_digitavel": "".join(linha_m.groups()) if linha_m else None,
        "numero_documento": num_doc.group(1) if num_doc else None,
    }


def ler_pdf(conteudo: bytes) -> dict | None:
    with pdfplumber.open(io.BytesIO(conteudo)) as pdf:
        texto = "\n".join((p.extract_text() or "") for p in pdf.pages[:2])
    return interpretar_texto(texto)
