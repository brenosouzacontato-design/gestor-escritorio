import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarResumoFinanceiro, separarParaOneflow, classificarLancamento, rotuloMesCurto } from '../resumoFinanceiro.js'

const C = {
  nu: { codigo: '1.1.01.003.001', nome: 'Nubank' },
  itau: { codigo: '1.1.01.003.002', nome: 'Itaú' },
  pend: { codigo: '1.1.01.001.002', nome: 'Valores a Identificar' },
  rec: { codigo: '3.1.01.001.001.001', nome: 'Vendas de Produtos' },
  cmv: { codigo: '4.2.01.001.002.004', nome: 'Compras de Mercadorias' },
  forn: { codigo: '2.1.01.002', nome: 'Fornecedor X' },
}
const lanc = (id, data, valor, d, c, extra = {}) => ({
  id, data, historico: id,
  partidas_contabeis: [
    { tipo: 'debito', valor, contas_contabeis: C[d] },
    { tipo: 'credito', valor, contas_contabeis: C[c] },
  ],
  ...extra,
})
const lancs = [
  lanc('e1', '2026-08-03', 1000, 'nu', 'rec', { oneflow_envio_id: 'env1', oneflow_enviado_em: '2026-09-01T10:00:00Z' }),
  lanc('e2', '2026-09-03', 500, 'itau', 'rec'),
  lanc('s1', '2026-08-05', 300, 'cmv', 'nu'),
  lanc('s2', '2026-09-05', 50, 'pend', 'nu'),
  lanc('t1', '2026-09-06', 200, 'itau', 'nu'),
  lanc('nf', '2026-09-07', 80, 'cmv', 'forn'),
]

test('natureza pelo lado do banco', () => {
  assert.equal(classificarLancamento(lancs[0]).natureza, 'entrada')
  assert.equal(classificarLancamento(lancs[2]).natureza, 'saida')
  assert.equal(classificarLancamento(lancs[4]).natureza, 'transferencia')
  assert.equal(classificarLancamento(lancs[5]).natureza, 'outro')
  assert.equal(classificarLancamento(lancs[3]).pendente, true)
})

test('resumo: totais, banco, mês, contas, identificação e OneFlow', () => {
  const r = montarResumoFinanceiro(lancs, { idsDoFiscal: new Set(['nf']) })
  assert.equal(r.totais.entradas, 1500)
  assert.equal(r.totais.saidas, 350)
  assert.equal(r.totais.saldo, 1150)
  assert.equal(r.totais.transferencias, 200)
  assert.deepEqual(r.porMes.map((m) => [m.mes, m.entradas, m.saidas]), [['2026-08', 1000, 300], ['2026-09', 500, 50]])
  assert.equal(r.porBanco.find((b) => b.nome === 'Nubank').saidas, 350)
  assert.equal(r.saidasPorConta[0].nome, 'Compras de Mercadorias')
  assert.equal(r.saidasPorConta[1].nome, 'A identificar')
  assert.equal(r.identificacao.qtdPendentes, 1)
  assert.equal(r.identificacao.valorPendente, 50)
  assert.equal(r.oneflow.qtdEnviados, 1)
  assert.equal(r.oneflow.qtdBloqueados, 1)
  assert.equal(r.oneflow.qtdDoFiscal, 1)
  assert.equal(r.oneflow.qtdProntos, 3)
  assert.equal(r.oneflow.ultimoEnvio, '2026-09-01T10:00:00Z')
})

test('separar para o OneFlow', () => {
  const s = separarParaOneflow(lancs, new Set(['nf']))
  assert.deepEqual(s.prontos.map((l) => l.id), ['e2', 's1', 't1'])
  assert.deepEqual(s.bloqueados.map((l) => l.id), ['s2'])
  assert.deepEqual(s.enviados.map((l) => l.id), ['e1'])
  assert.deepEqual(s.doFiscal.map((l) => l.id), ['nf'])
  assert.equal(rotuloMesCurto('2026-09'), 'set/26')
})
