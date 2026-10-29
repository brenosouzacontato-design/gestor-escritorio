import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estaArquivada, situacaoPrazo, diasDesdeConclusao } from '../tarefasPrazo.js'

const agora = new Date(2026, 9, 29, 15, 0) // 29/10/2026 15h

test('concluída há 7 dias ou mais vai para arquivadas', () => {
  assert.equal(estaArquivada({ kanban_status: 'concluido', concluida: true, concluida_em: '2026-10-22T10:00:00' }, agora), true)
  assert.equal(estaArquivada({ kanban_status: 'concluido', concluida: true, concluida_em: '2026-10-23T23:00:00' }, agora), false)
})

test('tarefa aberta nunca é arquivada', () => {
  assert.equal(estaArquivada({ kanban_status: 'andamento', concluida_em: '2026-01-01T00:00:00' }, agora), false)
  assert.equal(estaArquivada({ concluida: false }, agora), false)
})

test('sem concluida_em usa updated_at', () => {
  assert.equal(diasDesdeConclusao({ concluida: true, updated_at: '2026-10-19T08:00:00' }, agora), 10)
  assert.equal(estaArquivada({ concluida: true, updated_at: '2026-10-19T08:00:00' }, agora), true)
})

test('situação do prazo', () => {
  assert.equal(situacaoPrazo('2026-10-27', agora).tipo, 'atrasada')
  assert.equal(situacaoPrazo('2026-10-27', agora).texto, 'Atrasada há 2 dias')
  assert.equal(situacaoPrazo('2026-10-29', agora).texto, 'Vence hoje')
  assert.equal(situacaoPrazo('2026-10-30', agora).texto, 'Vence amanhã')
  assert.equal(situacaoPrazo('2026-11-01', agora).tipo, 'breve')
  assert.equal(situacaoPrazo('2026-11-10', agora).texto, '10/11')
  assert.equal(situacaoPrazo(null, agora).tipo, null)
})
