import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarRelatorioFinanceiro, categoriaDaConta } from '../relatorioFinanceiro.js'

const C = {
  nu: { codigo: '1.1.01.002', nome: 'Nubank' },
  itau: { codigo: '1.1.01.003', nome: 'Itaú' },
  pend: { codigo: '1.1.01.099', nome: 'Valores a Identificar (Transitoria)' },
  rec: { codigo: '3.1.01.001', nome: 'Receita de Prestacao de Servicos', tipo: 'receita' },
  cli: { codigo: '1.1.02.001', nome: 'Clientes Diversos', tipo: 'ativo' },
  adForn: { codigo: '1.1.03.001', nome: 'Adiantamentos a Fornecedores', tipo: 'ativo' },
  adCli: { codigo: '2.1.05.002', nome: 'Adiantamentos de Clientes', tipo: 'passivo' },
  fornA: { codigo: '2.1.01.002', nome: 'ACME LTDA', tipo: 'passivo', cnpj: '12.345.678/0001-90' },
  fornDiv: { codigo: '2.1.01.001', nome: 'Fornecedores Diversos', tipo: 'passivo' },
  aluguel: { codigo: '4.2.02.001', nome: 'Aluguel e Condominio', tipo: 'despesa' },
  simples: { codigo: '2.1.03.001', nome: 'Simples Nacional a Recolher', tipo: 'passivo' },
  lucro: { codigo: '2.3.02.003', nome: '(-) Lucros Distribuidos / Antecipados', tipo: 'patrimonio_liquido' },
  emp: { codigo: '2.1.04.002', nome: 'Cartao de Credito Empresarial a Pagar', tipo: 'passivo' },
}
const lanc = (id, data, valor, d, c, historico = id) => ({
  id, data, historico,
  partidas_contabeis: [
    { tipo: 'debito', valor, contas_contabeis: C[d] },
    { tipo: 'credito', valor, contas_contabeis: C[c] },
  ],
})

const lancs = [
  lanc('r1', '2026-08-02', 1000, 'nu', 'rec', 'Pix recebido - João Silva'),
  lanc('r2', '2026-09-02', 500, 'nu', 'cli', 'Pix recebido - JOAO SILVA'),
  lanc('a1', '2026-09-03', 300, 'nu', 'adCli', 'Pix recebido - Maria'),
  lanc('f1', '2026-08-10', 200, 'fornA', 'nu', 'Boleto - ACME'),
  lanc('f2', '2026-09-10', 250, 'fornA', 'itau', 'Boleto - ACME'),
  lanc('f3', '2026-09-11', 90, 'fornDiv', 'nu', 'Pix enviado - Padaria Bom Pão'),
  lanc('a2', '2026-09-12', 120, 'adForn', 'nu', 'Pix enviado - Marcenaria X'),
  lanc('d1', '2026-09-05', 1500, 'aluguel', 'nu', 'Pix enviado - Imobiliária'),
  lanc('i1', '2026-09-20', 180, 'simples', 'nu', 'DAS'),
  lanc('s1', '2026-09-25', 400, 'lucro', 'nu', 'Pix enviado - Sócio'),
  lanc('e1', '2026-09-26', 60, 'emp', 'nu', 'Fatura cartão'),
  lanc('p1', '2026-09-27', 35, 'pend', 'nu', 'Pix enviado - Fulano'),
  lanc('t1', '2026-09-28', 999, 'itau', 'nu', 'Transferência'),
]

test('categoria pela contrapartida', () => {
  assert.equal(categoriaDaConta(C.rec, 'entrada'), 'receitas')
  assert.equal(categoriaDaConta(C.cli, 'entrada'), 'receitas')
  assert.equal(categoriaDaConta(C.adForn, 'saida'), 'adiantamentos')
  assert.equal(categoriaDaConta(C.adCli, 'entrada'), 'adiantamentos')
  assert.equal(categoriaDaConta(C.fornA, 'saida'), 'fornecedores')
  assert.equal(categoriaDaConta(C.fornDiv, 'saida'), 'fornecedores')
  assert.equal(categoriaDaConta(C.aluguel, 'saida'), 'despesas')
  assert.equal(categoriaDaConta(C.simples, 'saida'), 'impostos')
  assert.equal(categoriaDaConta(C.lucro, 'saida'), 'socios')
  assert.equal(categoriaDaConta(C.emp, 'saida'), 'emprestimos')
})

test('relatório: totais, destaques e fornecedores', () => {
  const r = montarRelatorioFinanceiro(lancs)
  assert.equal(r.totais.entradas, 1800)
  assert.equal(r.totais.saidas, 2835)
  assert.equal(r.totais.transferencias, 999)
  assert.equal(r.destaques.receitas, 1500)
  assert.equal(r.destaques.adiantamentosRecebidos, 300)
  assert.equal(r.destaques.adiantamentosConcedidos, 120)
  assert.equal(r.destaques.fornecedores, 540)
  assert.equal(r.destaques.qtdFornecedores, 2)
  assert.equal(r.destaques.identificar, 35)

  // receitas agrupadas pelo cliente do histórico (maiúsculas/acentos iguais)
  const rec = r.entradas.find((g) => g.id === 'receitas')
  assert.equal(rec.itens.length, 1)
  assert.equal(rec.itens[0].total, 1500)

  // fornecedor individual pela conta (com CNPJ); diversos pelo histórico
  const forn = r.saidas.find((g) => g.id === 'fornecedores')
  assert.equal(forn.itens[0].nome, 'ACME LTDA')
  assert.equal(forn.itens[0].cnpj, '12.345.678/0001-90')
  assert.equal(forn.itens[0].total, 450)
  assert.equal(forn.itens[0].qtd, 2)
  assert.equal(forn.itens[0].ultimaData, '2026-09-10')
  assert.equal(forn.itens[1].nome, 'Padaria Bom Pão')

  // ordem das categorias de saída
  assert.deepEqual(r.saidas.map((g) => g.id), ['fornecedores', 'adiantamentos', 'despesas', 'impostos', 'socios', 'emprestimos', 'identificar'])
  assert.deepEqual(r.porMes.map((m) => m.mes), ['2026-08', '2026-09'])
  assert.equal(r.porMes[0].saidas.fornecedores, 200)
})
