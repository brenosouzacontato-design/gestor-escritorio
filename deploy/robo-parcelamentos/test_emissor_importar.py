"""python test_emissor_importar.py — funções puras do emissor_importar.py (dados fictícios)."""
import os

os.environ.setdefault("SUPABASE_URL", "http://teste.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "chave-de-teste")

from emissor_importar import completar, destinatario_do_emissor, produto_do_emissor  # noqa: E402

PESSOA = {
    "cpfCnpj": "11.222.333/0001-81", "razaoSocial": " Loja  Exemplo ", "inscricaoEstadual": None,
    "email": None, "telefone": "(11) 3333-4444", "cep": "01001-000", "logradouro": "Praça da Sé",
    "numero": "1", "complemento": "", "bairro": "Sé",
    "cidade": {"nome": "São Paulo", "estado": {"uf": "sp"}},
}


def test_destinatario():
    d = destinatario_do_emissor(PESSOA)
    assert d["documento"] == "11222333000181"
    assert d["nome"] == "Loja Exemplo"
    assert d["cep"] == "01001000"
    assert d["municipio"] == "São Paulo" and d["uf"] == "SP"
    assert d["complemento"] is None
    assert destinatario_do_emissor({**PESSOA, "cpfCnpj": ""}) is None  # consumidor sem documento


def test_produto():
    p = produto_do_emissor({"descricao": "Caixa", "codigo": "1", "ncm": "6702.90.00", "unidadeMedida": "un", "valorUnitario": "22.5"})
    assert p == {"descricao": "Caixa", "codigo": "1", "ncm": "67029000", "unidade": "UN", "valor_unitario": 22.5}
    assert produto_do_emissor({"descricao": "X", "ncm": "123", "valorUnitario": 0})["ncm"] is None
    assert produto_do_emissor({"descricao": ""}) is None


def test_completar_so_preenche_vazio():
    assert completar({"ncm": None, "unidade": "CX", "codigo": ""}, {"ncm": "67029000", "unidade": "UN", "codigo": "7"}) == {"ncm": "67029000", "codigo": "7"}


if __name__ == "__main__":
    for nome, f in list(globals().items()):
        if nome.startswith("test_"):
            f()
            print("ok", nome)
