"""python -m pytest test_emissor.py  (ou: python test_emissor.py) — só as funções puras do emissor.py."""
import os

os.environ.setdefault("SUPABASE_URL", "http://teste.invalid")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "chave-de-teste")

from emissor import casas_do_campo, dados_xml, fmt_cnpj, numero_whatsapp, sem_acento, teclas_dinheiro  # noqa: E402

CHAVE = "3" * 44  # chave fictícia


def test_cnpj_e_cpf_formatados():
    assert fmt_cnpj("11222333000181") == "11.222.333/0001-81"
    assert fmt_cnpj("123.456.789-01") == "123.456.789-01"


def test_numero_whatsapp_igual_ao_gestor():
    assert numero_whatsapp("(31) 98888-7777") == "5531988887777"
    assert numero_whatsapp("120000000000000000@g.us") == "120000000000000000@g.us"
    assert numero_whatsapp("123") is None
    assert numero_whatsapp("") is None


def test_teclas_dos_campos_de_dinheiro():
    assert teclas_dinheiro(12.5) == "1250"
    assert teclas_dinheiro(3, casas_do_campo("0,0000")) == "30000"
    assert teclas_dinheiro(0.1 + 0.2) == "30"  # arredonda o erro do float
    assert casas_do_campo("R$ 1.234,56") == 2
    assert casas_do_campo("") == 2


def test_numero_e_chave_do_xml():
    xml = f'<nfeProc><NFe><infNFe Id="NFe{CHAVE}"><ide><nNF>123</nNF></ide></infNFe></NFe><protNFe><infProt><chNFe>{CHAVE}</chNFe></infProt></protNFe></nfeProc>'
    assert dados_xml(xml) == {"numero": "123", "chave": CHAVE}
    assert dados_xml(f'<infNFe Id="NFe{CHAVE}"><nNF>9</nNF>') == {"numero": "9", "chave": CHAVE}
    assert dados_xml("<x/>") == {"numero": None, "chave": None}


def test_sem_acento():
    assert sem_acento(" São Paulo ") == "sao paulo"


if __name__ == "__main__":
    for nome, f in list(globals().items()):
        if nome.startswith("test_"):
            f()
            print("ok", nome)
