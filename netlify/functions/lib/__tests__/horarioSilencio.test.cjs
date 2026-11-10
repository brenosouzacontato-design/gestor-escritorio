// Horário de silêncio dos envios automáticos (lib/whatsapp.js)
const test = require('node:test')
const assert = require('node:assert')
const { horarioDeSilencio } = require('../whatsapp')

// horários de Brasília (UTC-3)
const brt = (h, min = 0) => new Date(Date.UTC(2026, 10, 10, h + 3, min))

test('padrão 19-7: silêncio das 19h às 6h59', () => {
  assert.strictEqual(horarioDeSilencio(brt(18, 59), undefined), false)
  assert.strictEqual(horarioDeSilencio(brt(19), undefined), true)
  assert.strictEqual(horarioDeSilencio(brt(23, 30), undefined), true)
  assert.strictEqual(horarioDeSilencio(brt(0, 10), undefined), true)
  assert.strictEqual(horarioDeSilencio(brt(6, 59), undefined), true)
  assert.strictEqual(horarioDeSilencio(brt(7), undefined), false)
  assert.strictEqual(horarioDeSilencio(brt(12), undefined), false)
})

test('configurável e desligável', () => {
  assert.strictEqual(horarioDeSilencio(brt(20), '21-6'), false)
  assert.strictEqual(horarioDeSilencio(brt(22), '21-6'), true)
  assert.strictEqual(horarioDeSilencio(brt(13), '12-14'), true)
  assert.strictEqual(horarioDeSilencio(brt(23), '0'), false)
  assert.strictEqual(horarioDeSilencio(brt(23), 'desligado'), false)
})
