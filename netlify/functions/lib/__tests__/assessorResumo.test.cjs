// Testes do "Resumo do assessor" (sem chamar a API). Rodar: npm run test:assessor
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sanitizarResumo, montarPedido, textoDaResposta } = require('../assessorResumo')

test('sanitiza: apaga CPF/CNPJ, descarta níveis desconhecidos e limita tamanho', () => {
  const r = sanitizarResumo({
    hoje: '2026-10-28',
    etapaReforma: '2026 — ano-teste',
    indicadores: { clientes: '12', porRegime: { SN: 8, 'x y': 3 }, empresasNfse: -4 },
    cards: [
      { id: 'a', tipo: 'uso', nivel: 'urgente', titulo: 'CPF 123.456.789-01 e CNPJ 12.345.678/0001-90', clientesAfetados: 2 },
      { id: 'b', tipo: 'uso', nivel: 'qualquer', titulo: 'fora' },
      { id: 'c', tipo: 'reforma', nivel: 'dica', titulo: 'x'.repeat(500) },
      { id: 'd', tipo: 'reforma', nivel: 'atencao', titulo: 'Prazo em 30/10/2026 (2 dias)' },
    ],
  })
  assert.equal(r.cards.length, 3)
  assert.equal(r.cards[0].titulo, 'CPF [removido] e CNPJ [removido]')
  assert.equal(r.cards[1].titulo.length, 200)
  assert.equal(r.cards[2].titulo, 'Prazo em 30/10/2026 (2 dias)')
  assert.deepEqual(r.indicadores.porRegime, { SN: 8 })
  assert.equal(r.indicadores.clientes, 12)
  assert.equal(r.indicadores.empresasNfse, 0)
})

test('sanitiza: data inválida e corpo vazio', () => {
  assert.throws(() => sanitizarResumo(null))
  assert.match(sanitizarResumo({ hoje: 'ontem' }).hoje, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(sanitizarResumo({ cards: Array(100).fill({ tipo: 'uso', nivel: 'dica', titulo: 't' }) }).cards.length <= 40)
})

test('pedido ao Claude: modelo, esforço baixo e JSON do resumo como mensagem', () => {
  const p = montarPedido({ hoje: '2026-10-28', cards: [] }, 'claude-opus-5-5')
  assert.equal(p.model, 'claude-opus-5-5')
  assert.equal(p.output_config.effort, 'low')
  assert.equal(p.messages[0].role, 'user')
  assert.deepEqual(JSON.parse(p.messages[0].content), { hoje: '2026-10-28', cards: [] })
  assert.ok(!('thinking' in p) && !('temperature' in p))
})

test('texto da resposta: junta blocos de texto e trata recusa', () => {
  assert.equal(textoDaResposta({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '1. Fazer X' }] }), '1. Fazer X')
  assert.equal(textoDaResposta({ stop_reason: 'refusal', content: [{ type: 'text', text: 'não' }] }), null)
  assert.equal(textoDaResposta({ content: [] }), null)
})
