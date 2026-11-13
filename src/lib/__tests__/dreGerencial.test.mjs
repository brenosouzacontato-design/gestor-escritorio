import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarDreGerencial, mesesDoPeriodo, mesDaCompetencia, contraparteDoHistorico, ehDisponivel, fraseResumo } from '../dreGerencial.js'
import { cruzarComNotas, similaridadeNomes, pendentesDosLancamentos, agruparPorContraparte, contaParaCompraDeNota } from '../identificarLancamentos.js'

const contas = [
  { id: 'nu', codigo: '1.1.01.003.001', nome: 'Nubank', tipo: 'ativo', aceita_lancamento: true },
  { id: 'pend', codigo: '1.1.01.001.002', nome: 'Valores a Identificar', tipo: 'ativo', aceita_lancamento: true },
  { id: 'apl', codigo: '1.1.01.005.006', nome: 'Aplicações', tipo: 'ativo', aceita_lancamento: true },
  { id: 'g-apl', codigo: '1.1.01.005', nome: 'Aplicações Financeiras', tipo: 'ativo', aceita_lancamento: false },
  { id: 'rec', codigo: '3.1.01.001.001.001', nome: 'Vendas de Produtos', tipo: 'receita', aceita_lancamento: true },
  { id: 'g-cmv', codigo: '4.2.01.001', nome: 'Compras de Mercadorias para Revenda', tipo: 'custo', aceita_lancamento: false },
  { id: 'estini', codigo: '4.2.01.001.002.001', nome: 'Estoque Inicial', tipo: 'custo', aceita_lancamento: true },
  { id: 'cmv', codigo: '4.2.01.001.002.004', nome: 'Compras de Mercadorias', tipo: 'custo', aceita_lancamento: true },
  { id: 'g-util', codigo: '5.1.01.003', nome: 'Utilidades e Locações', tipo: 'despesa', aceita_lancamento: false },
  { id: 'luz', codigo: '5.1.01.003.002.003', nome: 'Energia Elétrica', tipo: 'despesa', aceita_lancamento: true },
  { id: 'g-pl', codigo: '2.3.01', nome: 'Capital Social e Reservas', tipo: 'patrimonio_liquido', aceita_lancamento: false },
  { id: 'ret', codigo: '2.3.01.001.001', nome: 'Lucros distribuídos', tipo: 'patrimonio_liquido', aceita_lancamento: true },
]
const lanc = (id, data, historico, valor, debito, credito) => ({
  id, data, historico,
  partidas_contabeis: [{ id: `${id}d`, conta_id: debito, tipo: 'debito', valor }, { id: `${id}c`, conta_id: credito, tipo: 'credito', valor }],
})
const lancamentos = [
  lanc('1', '2026-08-03', 'Depósito recebido - 99 FOOD', 1000, 'nu', 'rec'),
  lanc('2', '2026-08-05', 'Pix enviado - CEMA ATACADISTA', 300, 'cmv', 'nu'),
  lanc('3', '2026-08-10', 'Pagamento de boleto - CEMIG', 100, 'luz', 'nu'),
  lanc('4', '2026-08-15', 'Pix enviado - Amanda', 200, 'ret', 'nu'),
  lanc('5', '2026-08-20', 'Pix enviado - Fulano', 50, 'pend', 'nu'),
  lanc('6', '2026-09-02', 'Depósito recebido - 99 FOOD', 2000, 'nu', 'rec'),
  lanc('7', '2026-09-03', 'Aplicação RDB', 500, 'apl', 'nu'),
  lanc('8', '2026-07-30', 'fora do período', 999, 'nu', 'rec'),
]
const pgdas = [{ competencia: '08/2026', faturamento_periodo: 1200, valor_das: 60 }, { competencia: '09/2026', faturamento_periodo: 0, valor_das: null }]

test('período, competência, contraparte e disponível', () => {
  assert.deepEqual(mesesDoPeriodo('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02'])
  assert.equal(mesDaCompetencia('9/2026'), '2026-09')
  assert.equal(contraparteDoHistorico('Pix enviado - CEMA - ITAÚ'), 'CEMA - ITAÚ')
  assert.equal(ehDisponivel('1.1.01.003.001'), true)
  assert.equal(ehDisponivel('1.1.01.001.002'), false)
  assert.equal(ehDisponivel('1.1.01.005.006'), false)
})

test('DRE gerencial: receita pelo PGDAS, DAS, CMV, despesas, fora do resultado e a identificar', () => {
  const dre = montarDreGerencial({ contas, lancamentos, pgdas, dataInicio: '2026-08-01', dataFim: '2026-09-30', saldoAnterior: 100 })
  const linha = (id) => dre.linhas.find((l) => l.id === id)
  assert.deepEqual(dre.meses, ['2026-08', '2026-09'])
  assert.equal(linha('receita_bruta').valores['2026-08'], 1200) // PGDAS
  assert.equal(linha('receita_bruta').valores['2026-09'], 2000) // PGDAS zerado -> lançamentos
  assert.equal(dre.fonteReceita['2026-09'], 'lancamentos')
  assert.equal(linha('das').valores['2026-08'], 60)
  assert.equal(linha('custos').total, 300)
  assert.equal(linha('desp:5.1.01.003').total, 100)
  assert.equal(linha('resultado_operacional').valores['2026-08'], 1200 - 60 - 300 - 100)
  assert.equal(linha('fora:2.3.01').total, 200)
  assert.equal(linha('fora:1.1.01.005').total, 500)
  assert.equal(linha('identificar_saidas').total, 50)
  assert.equal(linha('entradas').total, 3000)
  assert.equal(linha('saidas').total, 300 + 100 + 200 + 50 + 500)
  assert.equal(linha('saldo').valores['2026-09'], 100 + 3000 - 1150)
  assert.equal(linha('receita_bruta').pctReceita, 100)
  // detalhamento por contraparte
  assert.equal(linha('custos').detalhe[0].contraparte, 'CEMA ATACADISTA')
  assert.equal(dre.qtdLancamentos, 7)
  assert.equal(dre.qtdAIdentificar, 1)
})

test('indicadores e pontos de atenção', () => {
  const dre = montarDreGerencial({ contas, lancamentos, pgdas, dataInicio: '2026-08-01', dataFim: '2026-09-30' })
  const i = dre.indicadores
  assert.equal(i.mesReferencia, '2026-09')
  assert.equal(i.receitaBruta.ultimo, 2000)
  assert.ok(Math.abs(i.receitaBruta.variacao - 66.67) < 0.01)
  assert.ok(Math.abs(i.cmvSobreReceita.periodo - (300 / 3200) * 100) < 1e-9)
  assert.ok(i.identificacao.pctSaidasIdentificadas > 95)
  assert.ok(dre.pontos.some((p) => p.id === 'pgdas'))
  assert.ok(!dre.pontos.some((p) => p.id === 'identificar'))
  assert.match(fraseResumo(dre), /^Em set\/26 a receita bruta foi/)
})

test('cruzamento com NF: valor + data + nome, uma NF por lançamento', () => {
  const lancs = [
    lanc('a', '2026-08-14', 'Pix enviado - Cema Central Mineira Atacadista Ltda', 976.7, 'pend', 'nu'),
    lanc('b', '2026-08-14', 'Pix enviado - Outra Pessoa', 976.7, 'pend', 'nu'),
    lanc('c', '2026-08-20', 'Pix recebido - Cliente', 50, 'nu', 'pend'),
  ]
  const pend = pendentesDosLancamentos(lancs, contas)
  assert.equal(pend.length, 3)
  assert.equal(pend.find((p) => p.id === 'c').natureza, 'entrada')
  const notas = [
    { id: 'n1', tipo_movimento: 'entrada', razao_social_terceiro: '(12)CEMA-CENTRAL MINEIRA ATACADISTA LTDA', valor_total: 976.7, data_emissao: '2026-08-14', situacao_documento: 'Emitido' },
    { id: 'n2', tipo_movimento: 'entrada', razao_social_terceiro: 'CANCELADA SA', valor_total: 976.7, data_emissao: '2026-08-14', situacao_documento: 'Cancelado' },
  ]
  const casados = cruzarComNotas(pend, notas)
  assert.equal(casados.length, 1)
  assert.equal(casados[0].lancamentoId, 'a')
  assert.ok(similaridadeNomes('Cema Central Mineira', 'CEMA-CENTRAL MINEIRA ATACADISTA LTDA') === 1)
  assert.equal(similaridadeNomes('Fulano', 'CEMA'), 0)
  const grupos = agruparPorContraparte(pend, { excluirIds: new Set(['a']), notas })
  assert.deepEqual(grupos.map((g) => g.contraparte), ['Outra Pessoa', 'Cliente'])
  assert.equal(contaParaCompraDeNota(contas, notas[0])?.id, 'cmv')
})
