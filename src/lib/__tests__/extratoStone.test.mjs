import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparEmLinhas } from '../extratoNubankRegras.js'
import { pareceExtratoStone, interpretarExtratoStone } from '../extratoStoneRegras.js'

// itens no formato do pdf.js (x, y), na disposição do "Extrato de conta
// corrente" da Stone: data/tipo/valor/saldo na âncora, nome em cima e
// categoria embaixo (dados fictícios)
const it = (x, y, str) => ({ str, transform: [1, 0, 0, 1, x, y] })
const cabecalho = (y) => [
  it(20, y, 'Extrato de conta corrente'),
  it(26, y - 30, 'DATA'), it(80, y - 30, 'TIPO'), it(125, y - 30, 'DESCRIÇÃO'),
  it(294, y - 30, 'VALOR'), it(361, y - 30, 'SALDO'), it(428, y - 30, 'CONTRAPARTE'),
]
function mov(y, data, tipo, valor, saldo, { acima = [], naAncora = null, abaixo = null, contraparte = false, dx = 0 } = {}) {
  return [
    ...acima.map((s, i) => it(125 + dx, y + 6 + 12 * (acima.length - 1 - i) + (naAncora ? 6 : 0), s)),
    it(26, y, data), it(80 + dx, y, tipo), ...(naAncora ? [it(125 + dx, y, naAncora)] : []),
    it(294, y, valor), it(361, y, saldo),
    ...(abaixo ? [it(125 + dx, y - (naAncora ? 12 : 6), abaixo)] : []),
    ...(contraparte ? [it(428, y + 12, 'STONE INSTITUIÇÃO DE'), it(428, y, 'PAGAMENTO S.A.'), it(428, y - 12, 'Ag:')] : []),
  ]
}

// do mais novo pro mais antigo; saldo inicial 100,00 e final 211,20
const pagina1 = agruparEmLinhas([
  ...cabecalho(800),
  it(36, 650, 'Stone Instituição de Pagamento S.A.'),
  ...mov(560, '30/04/26', 'Entrada', 'R$ 40,84', 'R$ 211,20', { acima: ['Recebimento vendas'], abaixo: 'Antecipação', contraparte: true }),
  ...mov(512, '30/04/26', 'Saída', '- R$ 210,00', 'R$ 170,36', { acima: ['INDUSTRIA ALFA LTDA'], abaixo: 'Transferência | Pix' }),
  ...mov(464, '29/04/26', 'Saída', '- R$ 0,64', 'R$ 380,36', { naAncora: 'Tarifa' }),
  ...mov(440, '29/04/26', 'Entrada', 'R$ 81,00', 'R$ 381,00', { acima: ['Fulana de Tal'], abaixo: 'Pix | Maquininha' }),
])
const pagina2 = agruparEmLinhas([
  ...cabecalho(800),
  ...mov(680, '01/04/26', 'Saída', '- R$ 200,00', 'R$ 300,00', { acima: ['60.509.712 BELTRANO DE'], naAncora: 'SOUZA', abaixo: 'Transferência | Pix', dx: -2 }),
  ...mov(632, '01/04/26', 'Entrada', 'R$ 400,00', 'R$ 500,00', { acima: ['Desbloqueio de saldo'], abaixo: 'Desbloqueio de saldo', dx: -2 }),
])

test('reconhece o extrato de conta corrente da Stone', () => {
  assert.equal(pareceExtratoStone([pagina1, pagina2]), true)
  assert.equal(pareceExtratoStone([agruparEmLinhas([it(10, 10, 'Extrato de conta corrente'), it(10, 20, 'Nubank')])]), false)
})

test('lê cada movimentação com sinal, data e histórico "Categoria - Nome"', () => {
  const r = interpretarExtratoStone([pagina1, pagina2])
  assert.deepEqual(r.transacoes.map((t) => [t.data, t.tipo, t.valor, t.descricao]), [
    ['2026-04-30', 'entrada', 40.84, 'Antecipação - Recebimento vendas'],
    ['2026-04-30', 'saida', 210, 'Transferência | Pix - INDUSTRIA ALFA LTDA'],
    ['2026-04-29', 'saida', 0.64, 'Tarifa'],
    ['2026-04-29', 'entrada', 81, 'Pix | Maquininha - Fulana de Tal'],
    ['2026-04-01', 'saida', 200, 'Transferência | Pix - 60.509.712 BELTRANO DE SOUZA'],
    ['2026-04-01', 'entrada', 400, 'Desbloqueio de saldo'],
  ])
  assert.deepEqual(r.avisos, [])
})

test('confere a soma pela variação do saldo', () => {
  const r = interpretarExtratoStone([pagina1, pagina2])
  assert.equal(r.lido.qtd, 6)
  assert.equal(r.lido.entradas, 521.84)
  assert.equal(r.lido.saidas, 410.64)
  assert.deepEqual(r.saldos, { final: 211.2, inicial: 100, confere: true })
})

test('avisa quando falta movimentação (saldo não fecha)', () => {
  const semUma = agruparEmLinhas([
    ...cabecalho(800),
    it(36, 650, 'Stone Instituição de Pagamento S.A.'),
    ...mov(560, '30/04/26', 'Entrada', 'R$ 40,84', 'R$ 211,20', { acima: ['Recebimento vendas'], abaixo: 'Antecipação' }),
    ...mov(512, '30/04/26', 'Saída', '- R$ 210,00', 'R$ 170,36', { acima: ['INDUSTRIA ALFA LTDA'], abaixo: 'Transferência | Pix' }),
  ])
  const r = interpretarExtratoStone([semUma, pagina2])
  assert.equal(r.saldos.confere, false)
  assert.match(r.avisos[0], /não bate com a variação do saldo/)
})
