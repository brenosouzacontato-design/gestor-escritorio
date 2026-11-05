// Conversão do telefone do cadastro pro número da Evolution (Central de Entregas)
const test = require('node:test')
const assert = require('node:assert')
const { numeroWhatsapp } = require('../whatsapp')

test('telefone com DDD vira número com 55', () => {
  assert.strictEqual(numeroWhatsapp('(11) 98888-7777'), '5511988887777')
  assert.strictEqual(numeroWhatsapp('11 3333-4444'), '551133334444')
  assert.strictEqual(numeroWhatsapp('011988887777'), '5511988887777')
})

test('número já com 55 e grupo ficam como estão', () => {
  assert.strictEqual(numeroWhatsapp('+55 11 98888-7777'), '5511988887777')
  assert.strictEqual(numeroWhatsapp('120363413869003624@g.us'), '120363413869003624@g.us')
})

test('vazio ou curto demais não serve', () => {
  assert.strictEqual(numeroWhatsapp(''), null)
  assert.strictEqual(numeroWhatsapp(null), null)
  assert.strictEqual(numeroWhatsapp('9888-7777'), null)
})
