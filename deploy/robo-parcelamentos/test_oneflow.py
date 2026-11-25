"""python -m pytest test_oneflow.py  (ou: python test_oneflow.py) — só as funções puras do oneflow.py."""
import json
import os
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "http://teste.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "chave-de-teste")

import pytest  # noqa: E402

from oneflow import (  # noqa: E402
    ErroOneflow, nome_arquivo, passos_da_gravacao, preencher_variaveis, tipo_arquivo, validar_roteiro, variaveis,
)

CNPJ = "11222333000181"  # fictício
V = variaveis("03/2026", CNPJ, "Padaria Exemplo LTDA")


def test_variaveis_da_competencia_e_empresa():
    assert V["mes"] == "03" and V["ano"] == "2026"
    assert V["competencia_iso"] == "2026-03" and V["competencia_traco"] == "03-2026"
    assert V["cnpj_fmt"] == "11.222.333/0001-81"
    with pytest.raises(ErroOneflow):
        variaveis("13/2026")
    with pytest.raises(ErroOneflow):
        variaveis("2026-03")


def test_preencher_variaveis_recursivo_e_chave_errada_para():
    passo = {"acao": "preencher", "campo": "Competência", "valor": "{mes}/{ano}", "extra": ["{cnpj_fmt}"]}
    assert preencher_variaveis(passo, V) == {"acao": "preencher", "campo": "Competência", "valor": "03/2026",
                                             "extra": ["11.222.333/0001-81"]}
    with pytest.raises(ErroOneflow, match="compentencia"):
        preencher_variaveis("{compentencia}", V)
    assert preencher_variaveis(5, V) == 5


def test_validar_roteiro():
    bom = {"inicio": "https://x", "passos": [{"acao": "clicar", "texto": "Folha"}, {"acao": "baixar", "seletor": "#pdf"}]}
    assert validar_roteiro(bom) == []
    erros = validar_roteiro({"passos": [{"acao": "voar"}, {"acao": "preencher", "campo": "x"}]})
    assert any("inicio" in e for e in erros)
    assert any("voar" in e for e in erros)
    assert any("sem valor" in e for e in erros)
    assert any("baixar" in e for e in erros)


def test_exemplo_que_vem_com_o_robo_e_valido_mas_nao_calibrado():
    r = json.loads((Path(__file__).parent / "roteiros" / "relatorio_folha.exemplo.json").read_text(encoding="utf-8"))
    assert validar_roteiro(r) == []
    assert r["calibrado"] is False
    preencher_variaveis(r["passos"], V)  # só usa variáveis que existem


def test_tipo_do_arquivo_baixado():
    assert tipo_arquivo(b"%PDF-1.7 ...") == ("pdf", "application/pdf")
    assert tipo_arquivo(b"PK\x03\x04...")[0] == "xlsx"
    assert tipo_arquivo(b"<!DOCTYPE html><html>Sessao expirada") is None


def test_nome_do_arquivo_sem_caracteres_proibidos():
    assert nome_arquivo("relatorio_folha", "A/B: Comércio", "03/2026", "pdf") == "Relatório da folha A-B- Comércio 03-2026.pdf"


def test_gravacao_vira_roteiro_generalizado():
    eventos = [
        {"t": "click", "texto": "Trocar empresa", "sel": "#trocar"},
        {"t": "campo", "tag": "INPUT", "valor": "11.222", "sel": "input[name=\"busca\"]", "rotulo": "Pesquisar"},
        {"t": "campo", "tag": "INPUT", "valor": "11.222.333/0001-81", "sel": "input[name=\"busca\"]", "rotulo": "Pesquisar"},
        {"t": "click", "texto": "Padaria Exemplo LTDA", "sel": "li:nth-of-type(2)"},
        {"t": "click", "texto": "Folha", "sel": "a"},
        {"t": "click", "texto": "Folha", "sel": "a"},  # clique repetido some
        {"t": "click", "texto": "Linha 1\nLinha 2 muito longa", "sel": "#menu > div"},  # texto ruim: usa seletor
        {"t": "campo", "tag": "SELECT", "valor": "03/2026", "sel": "select[name=\"comp\"]", "rotulo": ""},
        {"t": "click", "texto": "Gerar PDF", "sel": "#gerar"},
        {"t": "download", "nome": "folha.pdf"},
    ]
    assert passos_da_gravacao(eventos, V) == [
        {"acao": "clicar", "texto": "Trocar empresa"},
        {"acao": "preencher", "seletor": "input[name=\"busca\"]", "valor": "{cnpj_fmt}", "campo": "Pesquisar"},
        {"acao": "clicar", "texto": "{empresa}"},
        {"acao": "clicar", "texto": "Folha"},
        {"acao": "clicar", "seletor": "#menu > div"},
        {"acao": "escolher", "seletor": "select[name=\"comp\"]", "valor": "{competencia}"},
        {"acao": "baixar", "texto": "Gerar PDF"},
    ]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
