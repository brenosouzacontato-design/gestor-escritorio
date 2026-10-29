const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  sanitizarPedido, montarPedido, fontesDaResposta, lerObrigacoes, urlOficial,
} = require('../assessorChat')

test('chat: limpa CPF/CNPJ e exige pergunta no fim', () => {
  const p = sanitizarPedido({ modo: 'chat', hoje: '2026-10-29', mensagens: [
    { role: 'assistant', content: 'oi' },
    { role: 'user', content: 'Prazo da DCTFWeb da empresa 12.345.678/0001-90?' },
  ] })
  assert.equal(p.mensagens.length, 1)
  assert.equal(p.mensagens[0].role, 'user')
  assert.ok(!p.mensagens[0].content.includes('12.345'))
  assert.throws(() => sanitizarPedido({ modo: 'chat', mensagens: [{ role: 'assistant', content: 'x' }] }))
})

test('obrigacoes: valida competência e regimes', () => {
  const p = sanitizarPedido({ modo: 'obrigacoes', competencia: '10/2026', regimes: { SN: 12, LP: 3, XX: 9, LR: 0 }, existentes: ['DAS', 'DCTFWeb'] })
  assert.deepEqual(p.regimes, { SN: 12, LP: 3 })
  assert.throws(() => sanitizarPedido({ modo: 'obrigacoes', competencia: '13/2026' }))
})

test('pedido usa busca só em domínios oficiais', () => {
  const r = montarPedido(sanitizarPedido({ modo: 'chat', mensagens: [{ role: 'user', content: 'oi' }] }), 'claude-opus-5-5')
  const busca = r.tools.find((t) => t.name === 'web_search')
  assert.equal(busca.type, 'web_search_20260209')
  assert.deepEqual(busca.allowed_domains, ['gov.br', 'leg.br', 'jus.br'])
  assert.equal(r.model, 'claude-opus-5-5')
})

test('fontes: só URLs oficiais e sem repetir', () => {
  const r = { content: [
    { type: 'text', text: 'a', citations: [
      { type: 'web_search_result_location', url: 'https://www.gov.br/receitafederal/agenda', title: 'Agenda' },
      { type: 'web_search_result_location', url: 'https://www.gov.br/receitafederal/agenda', title: 'Agenda' },
      { type: 'web_search_result_location', url: 'https://blog.exemplo.com/x', title: 'Blog' },
    ] },
  ] }
  assert.deepEqual(fontesDaResposta(r).map((f) => f.url), ['https://www.gov.br/receitafederal/agenda'])
  assert.equal(urlOficial('https://falsogov.br.exemplo.com'), false)
  assert.equal(urlOficial('https://www.planalto.gov.br/x'), true)
})

test('lê lista de obrigações do bloco json', () => {
  const texto = 'Segue:\n```json\n{"obrigacoes":[' +
    '{"nome":"DCTFWeb","regimes":["LP","LR","XX"],"vencimento":"2026-11-13","periodicidade":"mensal","fonte":"https://www.gov.br/receitafederal","ja_cadastrada":true},' +
    '{"nome":"DAS","regimes":["SN"],"vencimento":"2026-11-20","fonte":"https://site.com","observacao":"PGDAS-D"}' +
    '],"aviso":"confira"}\n```'
  const { obrigacoes, aviso } = lerObrigacoes(texto)
  assert.equal(obrigacoes.length, 2)
  assert.deepEqual(obrigacoes[0].regimes, ['LP', 'LR'])
  assert.equal(obrigacoes[1].fonte, null)
  assert.equal(aviso, 'confira')
  assert.throws(() => lerObrigacoes('sem json'))
})
