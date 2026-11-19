import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparEmLinhas } from '../extratoNubankRegras.js'
import { pareceExtratoVendasMercadoPago, interpretarExtratoVendasMercadoPago } from '../extratoMercadoPagoRegras.js'

// itens no formato do pdf.js (x, y), na mesma disposição do "Extrato de
// Vendas" do Mercado Pago: data/tipo/bruto em cima, ferramenta/líquido no
// meio, hora/ID/taxa embaixo
const it = (x, y, str) => ({ str, transform: [1, 0, 0, 1, x, y] })
function movimentacao(y, data, tipo, id, meio, bruto, taxa, liquido, grudado = false) {
  return [
    it(20, y, data), it(20, y - 8, '10:00:00'),
    it(99, y, tipo), it(99, y - 8, `ID:${id}`),
    it(199, y - 4, 'Checkouts'),
    it(252, y, meio),
    ...(grudado ? [it(330, y - 4, `${bruto}${taxa}`)] : [it(336, y, bruto), it(344, y - 8, taxa)]),
    it(400, y - 4, liquido),
  ]
}

const pagina1 = agruparEmLinhas([
  it(336, 586, 'EXTRATO DE VENDAS'),
  it(37, 470, 'Vendas totais brutas:'), it(110, 470, 'R$1.394,22'),
  it(37, 462, 'Taxas:'), it(112, 462, 'R$-131,65'),
  it(37, 448, 'Devoluções:'), it(110, 448, 'R$-174,21'),
  ...movimentacao(319, '01-10-2026', 'Mediação', '100', 'Cartão de crédito', 'R$-224,07', 'R$0,00', 'R$-224,07'),
  ...movimentacao(289, '02-10-2026', 'Pagamento', '101', 'Cartão de crédito', 'R$194,22', 'R$-20,01', 'R$174,21'),
  ...movimentacao(259, '02-10-2026', 'Reembolso', '102', 'Cartão de crédito', 'R$-194,22', 'R$20,01', 'R$-174,21'),
  ...movimentacao(229, '07-10-2026', 'Pagamento', '103', 'Saldo em conta', 'R$1.200,00', 'R$-111,64', 'R$1.088,36', true),
  it(10, 20, 'Mercado Pago Instituição de Pagamento Ltda.'),
])

test('reconhece o Extrato de Vendas do Mercado Pago', () => {
  assert.equal(pareceExtratoVendasMercadoPago([pagina1]), true)
  assert.equal(pareceExtratoVendasMercadoPago([agruparEmLinhas([it(10, 10, 'Nubank')])]), false)
})

test('venda é entrada pelo bruto, taxa é saída; devolução é saída e devolve a taxa', () => {
  const r = interpretarExtratoVendasMercadoPago([pagina1])
  assert.equal(r.movimentacoes.length, 4)
  assert.deepEqual(r.avisos, [])
  assert.equal(r.lido.brutas, 1394.22)
  assert.equal(r.totais.brutas, 1394.22)
  assert.equal(r.lido.taxas, -131.65)

  const resumo = r.transacoes.map((t) => [t.data, t.tipo, t.valor, t.descricao.split(' - ')[0], t.identificador])
  assert.deepEqual(resumo, [
    ['2026-10-01', 'saida', 224.07, 'Mediação de venda', '100'],
    ['2026-10-02', 'entrada', 194.22, 'Venda', '101'],
    ['2026-10-02', 'saida', 20.01, 'Tarifa de venda', '101-taxa'],
    ['2026-10-02', 'saida', 194.22, 'Reembolso de venda', '102'],
    ['2026-10-02', 'entrada', 20.01, 'Tarifa devolvida (Reembolso)', '102-taxa'],
    ['2026-10-07', 'entrada', 1200, 'Venda', '103'],
    ['2026-10-07', 'saida', 111.64, 'Tarifa de venda', '103-taxa'],
  ])

  // só a venda tem "Checkouts" (regra comum: CHECKOUTS -> Vendas)
  assert.deepEqual(r.transacoes.filter((t) => /checkouts/i.test(t.descricao)).map((t) => t.identificador), ['101', '103'])

  // entradas − saídas = soma dos valores líquidos
  const liq = r.transacoes.reduce((s, t) => s + (t.tipo === 'entrada' ? t.valor : -t.valor), 0)
  assert.equal(Math.round(liq * 100) / 100, r.lido.liquido)
})

test('avisa quando as vendas brutas não batem com o cabeçalho', () => {
  const pag = agruparEmLinhas([
    it(336, 586, 'EXTRATO DE VENDAS'),
    it(37, 470, 'Vendas totais brutas:'), it(110, 470, 'R$999,00'),
    ...movimentacao(289, '02-10-2026', 'Pagamento', '101', 'Pix', 'R$194,22', 'R$0,00', 'R$194,22'),
  ])
  const r = interpretarExtratoVendasMercadoPago([pag])
  assert.match(r.avisos[0], /não batem/)
})
