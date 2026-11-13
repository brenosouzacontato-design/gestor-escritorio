import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  montarItensExtrato, encontrarRegraAplicavel, extrairPadraoClassificacao, identificarBanco,
  acharContaBanco, proximoCodigoBanco, periodoDoExtrato, transacaoValida, corrigirTipoPelaDescricao,
} from '../contabilExtrato.js'

const contas = [
  { id: 'grupo', codigo: '1.1.01.003', nome: 'Bancos Conta Movimento', aceita_lancamento: false },
  { id: 'nu', codigo: '1.1.01.003.001', nome: 'Nubank', aceita_lancamento: true },
  { id: 'ifood', codigo: '1.1.01.003.002', nome: 'Ifood', aceita_lancamento: true },
  { id: 'pend', codigo: '1.1.01.001.002', nome: 'Valores a Identificar', aceita_lancamento: true },
]

test('lançamento: entrada debita o banco, saída credita; sem conta vai pra pendente', () => {
  const itens = montarItensExtrato([
    { data: '2026-09-01', descricao: 'Pix recebido - 99 FOOD', valor: 10, tipo: 'entrada', conta_id: 'rec' },
    { data: '2026-09-01', descricao: 'Pix enviado - Fulano', valor: 5, tipo: 'saida', conta_id: '' },
  ], { contaBancoId: 'nu', contaPendenteId: 'pend' })
  assert.deepEqual(itens[0].partidas, [{ conta_id: 'nu', tipo: 'debito', valor: 10 }, { conta_id: 'rec', tipo: 'credito', valor: 10 }])
  assert.equal(itens[0].conciliado, true)
  assert.deepEqual(itens[1].partidas, [{ conta_id: 'pend', tipo: 'debito', valor: 5 }, { conta_id: 'nu', tipo: 'credito', valor: 5 }])
  assert.equal(itens[1].conciliado, false)
  assert.equal(itens[1].origem, 'importacao_extrato')
})

test('referência do extrato igual à da tela, com #2 pra transação repetida', () => {
  const t = { data: '2026-09-02', descricao: 'Pix enviado - X ', valor: 160, tipo: 'saida' }
  const [a, b] = montarItensExtrato([t, t], { contaBancoId: 'nu', contaPendenteId: 'pend' })
  assert.equal(a.extratoReferencia, 'nu|2026-09-02|saida|160.00|Pix enviado - X')
  assert.equal(b.extratoReferencia, 'nu|2026-09-02|saida|160.00|Pix enviado - X#2')
  assert.throws(() => montarItensExtrato([t], { contaBancoId: 'nu' }), /Valores a Identificar/)
})

test('regra mais específica vence', () => {
  const regras = [{ padrao: '99 FOOD', conta_id: 'a' }, { padrao: '99 FOOD LTDA', conta_id: 'b' }]
  assert.equal(encontrarRegraAplicavel('Depósito recebido - 99 FOOD LTDA * Débito', regras).conta_id, 'b')
  assert.equal(encontrarRegraAplicavel('Pix - outro', regras), null)
  assert.equal(extrairPadraoClassificacao('Pix enviado - Fulano - Banco'), 'FULANO - BANCO')
})

test('conta do banco: acha pelo nome, cria no próximo código', () => {
  assert.equal(acharContaBanco(contas, identificarBanco('NU PAGAMENTOS S.A.'))?.id, 'nu')
  assert.equal(acharContaBanco(contas, identificarBanco('Itaú Unibanco')), null)
  assert.deepEqual(identificarBanco('Banco Itaú'), { chave: 'itau', nome: 'Itaú' })
  assert.equal(acharContaBanco([contas[0], contas[1], contas[3]], null)?.id, 'nu') // uma conta só no grupo
  assert.equal(acharContaBanco(contas, null), null)
  assert.equal(proximoCodigoBanco(contas), '1.1.01.003.003')
  assert.equal(proximoCodigoBanco([]), '1.1.01.003.001')
})

test('período cheio dos meses do extrato', () => {
  assert.deepEqual(periodoDoExtrato([{ data: '2026-09-15' }, { data: '2026-09-02' }]), { dataInicio: '2026-09-01', dataFim: '2026-09-30' })
  assert.deepEqual(periodoDoExtrato([{ data: '2026-01-31' }, { data: '2026-02-03' }]), { dataInicio: '2026-01-01', dataFim: '2026-02-28' })
  assert.equal(periodoDoExtrato([]), null)
})

test('transação válida e direção pela descrição', () => {
  assert.equal(transacaoValida({ data: '2026-09-01', valor: 1, tipo: 'entrada' }), true)
  assert.equal(transacaoValida({ data: '01/09/2026', valor: 1, tipo: 'entrada' }), false)
  assert.equal(transacaoValida({ data: '2026-09-01', valor: 0, tipo: 'entrada' }), false)
  assert.equal(corrigirTipoPelaDescricao({ descricao: 'Pix recebido - X', tipo: 'saida' }).tipo, 'entrada')
})
