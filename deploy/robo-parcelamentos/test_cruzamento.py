"""python -m pytest test_cruzamento.py  (ou: python test_cruzamento.py)"""
from cruzamento import achar_guia, codigo_barras, normalizar_linha, numero_na_guia, valor_br

NUM = "07202612345678901"  # número de documento fictício (17 dígitos)


def linha_de(barras: str) -> str:
    """código de barras (44) → linha digitável (48) com DVs fictícios."""
    assert len(barras) == 44
    return " ".join(barras[i:i + 11] + "0" for i in range(0, 44, 11))


BARRAS = "8560" + "00000012345" + "0328" + "0000" + NUM + "0000"
LINHA = linha_de(BARRAS)


def test_codigo_barras():
    assert codigo_barras(LINHA) == BARRAS


def test_numero_na_guia():
    assert numero_na_guia("07.20.26123.4567890-1", LINHA)
    assert not numero_na_guia("07202699999999999", LINHA)
    assert not numero_na_guia("123", LINHA)  # curto demais
    assert not numero_na_guia(NUM, None)


def test_valor_br():
    assert valor_br("R$ 1.234,56") == 1234.56
    assert valor_br("1234.56") == 1234.56
    assert valor_br("") is None


def test_normalizar_linha():
    r = normalizar_linha({
        "Tipo do Documento": "DAS",
        "Número do Documento": "07.20.26123.4567890-1",
        "Período de Apuração": "01/2026",
        "Data de Arrecadação": "19/02/2026",
        "Data de Vencimento": "20/02/2026",
        "Código de Receita": "3333 - DAS SIMPLES",
        "Valor Total": "1.234,56",
    })
    assert r["numero_documento"] == NUM
    assert r["tipo_documento"] == "DAS"
    assert r["data_arrecadacao"] == "2026-02-19"
    assert r["data_vencimento"] == "2026-02-20"
    assert r["codigo_receita"] == "3333" and r["descricao_receita"] == "DAS SIMPLES"
    assert r["valor_total"] == 1234.56
    assert normalizar_linha({"Tipo do Documento": "DAS"}) is None


def test_achar_guia_por_numero():
    guias = [
        {"id": "a", "linha_digitavel": LINHA, "valor_guia": 999, "vencimento_guia": None, "pago_em": None},
        {"id": "b", "linha_digitavel": None, "valor_guia": 1234.56, "vencimento_guia": "2026-02-20", "pago_em": None},
    ]
    pg = {"numero_documento": NUM, "valor_total": 1234.56, "data_vencimento": "2026-02-20"}
    g, como = achar_guia(pg, guias)
    assert g["id"] == "a" and como == "numero_documento"


def test_achar_guia_por_valor_e_vencimento():
    guias = [{"id": "b", "linha_digitavel": None, "valor_guia": "1234.56", "vencimento_guia": "2026-02-20", "pago_em": None}]
    pg = {"numero_documento": NUM, "valor_total": 1234.56, "data_vencimento": "2026-02-20"}
    assert achar_guia(pg, guias) == (guias[0], "valor_vencimento")
    # já usada por outro pagamento → não cruza
    assert achar_guia(pg, guias, {"b"}) == (None, None)


def test_ambiguo_nao_cruza():
    guias = [
        {"id": "b", "linha_digitavel": None, "valor_guia": 100, "vencimento_guia": "2026-02-20", "pago_em": None},
        {"id": "c", "linha_digitavel": None, "valor_guia": 100, "vencimento_guia": "2026-02-20", "pago_em": None},
    ]
    pg = {"numero_documento": NUM, "valor_total": 100, "data_vencimento": "2026-02-20"}
    assert achar_guia(pg, guias) == (None, None)


def test_guia_ja_paga_so_por_numero():
    guias = [{"id": "b", "linha_digitavel": None, "valor_guia": 100, "vencimento_guia": "2026-02-20", "pago_em": "2026-02-19"}]
    pg = {"numero_documento": NUM, "valor_total": 100, "data_vencimento": "2026-02-20"}
    assert achar_guia(pg, guias) == (None, None)


if __name__ == "__main__":
    for nome, f in list(globals().items()):
        if nome.startswith("test_"):
            f()
            print("ok", nome)
