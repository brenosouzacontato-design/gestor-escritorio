"""Cruzamento dos pagamentos do e-CAC com as guias anexadas no gestor.

Funções puras (sem rede), testadas em test_cruzamento.py.

Regras, na ordem:
  1. número do documento: o número do DARF/DAS (17 dígitos) vai dentro do
     código de barras da guia — se aparecer na linha digitável da guia, é ela;
  2. valor + vencimento: mesmo valor (centavos) e mesmo vencimento, e só UMA
     guia em aberto da empresa nessas condições.
Na dúvida (duas guias possíveis), não cruza: o pagamento fica "sem guia" na tela.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime

TOLERANCIA = 0.01


def digitos(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def codigo_barras(linha_digitavel: str) -> str:
    """Linha digitável de arrecadação (48 dígitos: 4 blocos de 11 + DV) →
    código de barras (44). Outros tamanhos voltam só com os dígitos."""
    d = digitos(linha_digitavel)
    if len(d) == 48:
        return "".join(d[i:i + 11] for i in range(0, 48, 12))
    return d


def numero_na_guia(numero_documento: str, linha_digitavel: str) -> bool:
    num = digitos(numero_documento)
    if len(num) < 10 or not linha_digitavel:
        return False
    return num in codigo_barras(linha_digitavel) or num in digitos(linha_digitavel)


def _sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def valor_br(s) -> float | None:
    """'1.234,56' / 'R$ 1.234,56' / 1234.56 → 1234.56"""
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = re.sub(r"[^\d,.\-]", "", str(s))
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def data_br(s) -> str | None:
    """'31/01/2026' → '2026-01-31'; já ISO passa direto."""
    if not s:
        return None
    s = str(s).strip()
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else None


# Cabeçalhos da tabela de pagamentos do e-CAC → campo. Ordem importa: o
# primeiro padrão que bater ganha a coluna.
COLUNAS = [
    ("numero_documento", r"numero|^no?\.?\s*(do\s*)?doc"),
    ("tipo_documento", r"^tipo"),
    ("periodo_apuracao", r"periodo|apura"),
    ("data_arrecadacao", r"arrecada|pagamento"),
    ("data_vencimento", r"vencimento"),
    ("codigo_receita", r"codigo"),
    ("descricao_receita", r"denomina|descri"),
    ("valor_total", r"valor\s*total|^valor"),
]


def normalizar_linha(linha: dict) -> dict | None:
    """Linha da tabela do e-CAC ({cabeçalho: texto}) → registro de ecac_pagamentos
    (sem cliente_id). None se não tiver número do documento."""
    saida: dict = {}
    usados = set()
    for campo, padrao in COLUNAS:
        for cab, valor in linha.items():
            if cab in usados:
                continue
            if re.search(padrao, _sem_acento(cab).strip()):
                saida[campo] = (valor or "").strip()
                usados.add(cab)
                break
    num = digitos(saida.get("numero_documento"))
    if len(num) < 10:
        return None
    cod = saida.get("codigo_receita") or ""
    # "1099 - CP SEGURADOS" numa coluna só
    m = re.match(r"^\s*(\d{4}(?:-\d{2})?)\s*[-–]\s*(.+)$", cod)
    if m and not saida.get("descricao_receita"):
        cod, saida["descricao_receita"] = m.group(1), m.group(2).strip()
    return {
        "numero_documento": num,
        "tipo_documento": saida.get("tipo_documento") or None,
        "codigo_receita": cod or None,
        "descricao_receita": saida.get("descricao_receita") or None,
        "periodo_apuracao": saida.get("periodo_apuracao") or None,
        "data_arrecadacao": data_br(saida.get("data_arrecadacao")),
        "data_vencimento": data_br(saida.get("data_vencimento")),
        "valor_total": valor_br(saida.get("valor_total")),
        "dados": linha,
    }


def achar_guia(pagamento: dict, guias: list[dict], ja_usadas: set[str] | None = None) -> tuple[dict | None, str | None]:
    """Guia (de `documentos`) que corresponde ao pagamento, e por qual regra.
    `guias`: [{id, linha_digitavel, valor_guia, vencimento_guia, pago_em}].
    Guias já pagas só valem pela regra 1 (só pra ligar, sem nova baixa)."""
    ja_usadas = ja_usadas or set()
    livres = [g for g in guias if g["id"] not in ja_usadas]

    por_numero = [g for g in livres if numero_na_guia(pagamento["numero_documento"], g.get("linha_digitavel"))]
    if len(por_numero) == 1:
        return por_numero[0], "numero_documento"

    valor, venc = pagamento.get("valor_total"), pagamento.get("data_vencimento")
    if valor is None or not venc:
        return None, None
    candidatas = [
        g for g in livres
        if not g.get("pago_em")
        and g.get("valor_guia") is not None
        and abs(float(g["valor_guia"]) - valor) <= TOLERANCIA
        and (g.get("vencimento_guia") or "")[:10] == venc
    ]
    if len(candidatas) == 1:
        return candidatas[0], "valor_vencimento"
    return None, None


def periodo_consulta(hoje: date, dias: int) -> tuple[str, str]:
    """(início, fim) em dd/mm/aaaa pra consulta de pagamentos."""
    inicio = date.fromordinal(hoje.toordinal() - dias)
    return inicio.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y")


def competencia_atual(agora: datetime) -> str:
    return agora.strftime("%m/%Y")
