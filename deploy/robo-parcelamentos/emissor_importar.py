"""Importa os cadastros do Emissor para o app de pedido de NF-e do gestor.

O escritório toca "Importar do Emissor" (Fiscal → Pedidos de NF-e):
clientes.emissor_importacao_status = 'na_fila' (supabase-schema-nfe-importacao.sql).
O robô entra na empresa no Emissor (mesmo login e perfil do emissor.py) e lê,
pela API interna que a própria tela usa (emissor.app/api/empresas/<uuid>/...),
os clientes (/pessoas, só os marcados como cliente) e os produtos (/produtos,
o detalhe traz NCM e unidade). Grava em nfe_destinatarios e nfe_produtos:
o que não existe é criado; o que já existe só tem os campos vazios completados
(nada que o cliente digitou no app é sobrescrito).

Só lê do Emissor: não cria nem muda nada lá.
"""
from __future__ import annotations

import logging
import re

from playwright.sync_api import Page, sync_playwright

import emissor
import emissor_db as db
import notificador as aviso

log = logging.getLogger("emissor_importar")

API = "https://emissor.app/api"
MAX_PAGINAS = 100  # 15 por página: até 1.500 de cada


# ---------------------------------------------------------------- funções puras
def _texto(v, maximo: int = 200) -> str | None:
    s = re.sub(r"\s+", " ", str(v or "")).strip()
    return s[:maximo] or None


def produto_do_emissor(d: dict) -> dict | None:
    """Detalhe de /produtos/<id> → linha de nfe_produtos (sem cliente_id)."""
    descricao = _texto(d.get("descricao"), 120)
    if not descricao:
        return None
    ncm = emissor.digitos(d.get("ncm"))
    try:
        valor = float(d.get("valorUnitario")) if d.get("valorUnitario") not in (None, "") else None
    except (TypeError, ValueError):
        valor = None
    return {
        "descricao": descricao,
        "codigo": _texto(d.get("codigo"), 60),
        "ncm": ncm if len(ncm) == 8 else None,
        "unidade": (_texto(d.get("unidadeMedida"), 6) or "UN").upper(),
        "valor_unitario": valor if valor and valor > 0 else None,
    }


def destinatario_do_emissor(d: dict) -> dict | None:
    """Detalhe de /pessoas/<id> → linha de nfe_destinatarios (sem cliente_id).
    Só quem tem CPF/CNPJ (a NF-e de venda precisa)."""
    doc = emissor.digitos(d.get("cpfCnpj"))
    nome = _texto(d.get("razaoSocial") or d.get("nomeFantasia"), 120)
    if len(doc) not in (11, 14) or not nome:
        return None
    cidade = d.get("cidade") or {}
    estado = cidade.get("estado") or {}
    cep = emissor.digitos(d.get("cep"))
    return {
        "documento": doc,
        "nome": nome,
        "ie": _texto(d.get("inscricaoEstadual"), 20),
        "email": _texto(d.get("email"), 120),
        "telefone": _texto(d.get("telefone"), 30),
        "cep": cep if len(cep) == 8 else None,
        "logradouro": _texto(d.get("logradouro"), 120),
        "numero": _texto(d.get("numero"), 20),
        "complemento": _texto(d.get("complemento"), 60),
        "bairro": _texto(d.get("bairro"), 60),
        "municipio": _texto(cidade.get("nome"), 60),
        "uf": (_texto(estado.get("uf"), 2) or "").upper() or None,
    }


def completar(existente: dict, novo: dict) -> dict:
    """Campos do Emissor que estão vazios no app (não sobrescreve o que já tem)."""
    return {k: v for k, v in novo.items() if v not in (None, "") and existente.get(k) in (None, "")}


# ---------------------------------------------------------------- Emissor
_JS_GET = """async (caminho) => {
  const emp = JSON.parse(localStorage.getItem('empresa') || '{}');
  const tok = (localStorage.getItem('token') || '').replace(/^"|"$/g, '');
  if (!emp.uuid || !tok) return { erro: 'sem empresa aberta no Emissor' };
  const r = await fetch(`%s/empresas/${emp.uuid}/${caminho}`, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' } });
  if (!r.ok) return { erro: `Emissor respondeu ${r.status} em ${caminho}` };
  return { dados: await r.json() };
}""" % API


def _get(page: Page, caminho: str):
    r = page.evaluate(_JS_GET, caminho)
    if r.get("erro"):
        raise emissor.ErroEmissor(r["erro"])
    return r["dados"]


def _detalhes(page: Page, recurso: str, filtro=lambda x: True) -> list[dict]:
    """Todos os itens de /recurso (paginado), com o detalhe de cada um."""
    itens = []
    for n in range(1, MAX_PAGINAS + 1):
        pag = _get(page, f"{recurso}?page={n}")
        lista = pag.get("data") if isinstance(pag, dict) else pag
        for x in lista or []:
            if x.get("ativo") is False or not filtro(x):
                continue
            d = _get(page, f"{recurso}/{x['id']}")
            itens.append(d.get("data", d) if isinstance(d, dict) else d)
        if not isinstance(pag, dict) or n >= int(pag.get("last_page") or 1):
            break
    return itens


def importar_empresa(page: Page, cli: dict) -> str:
    """Copia clientes e produtos da empresa. Devolve o resumo."""
    t = emissor.Tela(page, emissor.PASTA / f"importar-{emissor.digitos(cli['cnpj'])}")
    emissor.garantir_login(page)
    emissor.entrar_empresa(t, cli["cnpj"])

    pessoas = _detalhes(page, "pessoas", filtro=lambda x: x.get("cliente") is not False)
    produtos = _detalhes(page, "produtos")

    destinos = {d["documento"]: d for d in db.destinatarios_do_cliente(cli["id"]) if d.get("documento")}
    novos_d = atualizados_d = 0
    for p in pessoas:
        dest = destinatario_do_emissor(p)
        if not dest:
            continue
        ja = destinos.get(dest["documento"])
        if ja:
            patch = completar(ja, dest)
            if patch:
                db.atualizar_cadastro("nfe_destinatarios", ja["id"], patch)
                atualizados_d += 1
        else:
            destinos[dest["documento"]] = db.criar_cadastro("nfe_destinatarios", {**dest, "cliente_id": cli["id"]})
            novos_d += 1

    chave = lambda s: re.sub(r"\s+", " ", str(s or "")).strip().lower()  # noqa: E731
    prods = {chave(p["descricao"]): p for p in db.produtos_do_cliente(cli["id"])}
    novos_p = atualizados_p = 0
    for p in produtos:
        prod = produto_do_emissor(p)
        if not prod:
            continue
        ja = prods.get(chave(prod["descricao"]))
        if ja:
            patch = completar(ja, prod)
            if str(ja.get("unidade") or "").isdigit():
                patch["unidade"] = prod["unidade"]  # unidade digitada errada (só número, ex.: "13")
            if patch:
                db.atualizar_cadastro("nfe_produtos", ja["id"], patch)
                atualizados_p += 1
        else:
            prods[chave(prod["descricao"])] = db.criar_cadastro("nfe_produtos", {**prod, "cliente_id": cli["id"]})
            novos_p += 1

    return (f"Do Emissor: {len(pessoas)} cliente(s) e {len(produtos)} produto(s). "
            f"No app: {novos_d} cliente(s) e {novos_p} produto(s) novos, "
            f"{atualizados_d + atualizados_p} cadastro(s) completados.")


def rodar() -> int:
    """Processa as empresas na fila de importação. Devolve quantas pegou."""
    fila = db.importacoes_na_fila()
    if not fila:
        return 0
    with sync_playwright() as pw:
        contexto, page = emissor._abrir_navegador(pw)
        for cli in fila:
            db.marcar_importacao(cli["id"], "processando", "Lendo o Emissor")
            try:
                if not emissor.digitos(cli.get("cnpj")):
                    raise emissor.ErroEmissor("Empresa sem CNPJ no cadastro do gestor.")
                resumo = importar_empresa(page, cli)
                db.marcar_importacao(cli["id"], "ok", resumo)
                log.info("Importação %s: %s", cli["nome"], resumo)
            except Exception as e:  # noqa: BLE001 — só leitura: pode tentar de novo
                log.exception("Importação %s", cli["nome"])
                db.marcar_importacao(cli["id"], "erro", str(e)[:400])
                aviso.texto(f"❌ Importação do Emissor ({cli['nome']}): {str(e)[:200]}")
        contexto.close()
    return len(fila)
