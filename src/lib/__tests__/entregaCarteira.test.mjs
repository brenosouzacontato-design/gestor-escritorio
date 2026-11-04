import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusEntregaEmpresa, resumoEntregas } from '../entregaCarteira.js'

const C = '10/2026'
const obs = [
  { cliente_id: 'a', competencia: C, status: 'concluido' },
  { cliente_id: 'a', competencia: C, status: 'nao_aplica' },
  { cliente_id: 'b', competencia: C, status: 'concluido' },
  { cliente_id: 'b', competencia: C, status: 'pendente' },
  { cliente_id: 'c', competencia: C, status: 'pendente' },
  { cliente_id: 'c', competencia: '09/2026', status: 'concluido' }, // outra competência não conta
  { cliente_id: 'd', competencia: C, status: 'pendente' },
]

test('todas concluídas/não aplica = entregue', () => {
  assert.deepEqual(statusEntregaEmpresa('a', C, obs, []), { status: 'entregue', feitas: 2, total: 2, atualizadoEm: null })
})

test('alguma concluída = em andamento; nenhuma = a fazer; sem obrigação', () => {
  assert.equal(statusEntregaEmpresa('b', C, obs, []).status, 'andamento')
  assert.equal(statusEntregaEmpresa('c', C, obs, []).status, 'a_fazer')
  assert.equal(statusEntregaEmpresa('z', C, obs, []).status, 'sem_obrigacao')
})

test('marcação do escritório vale: entregue e aguardando cliente', () => {
  const entregas = [
    { cliente_id: 'c', entregue: true, atualizado_em: '2026-11-03T10:00:00Z' },
    { cliente_id: 'd', entregue: false, aguardando_cliente: true },
    { cliente_id: 'a', entregue: false, aguardando_cliente: true }, // completa ganha de aguardando
  ]
  assert.equal(statusEntregaEmpresa('c', C, obs, entregas).status, 'entregue')
  assert.equal(statusEntregaEmpresa('c', C, obs, entregas).atualizadoEm, '2026-11-03T10:00:00Z')
  assert.equal(statusEntregaEmpresa('d', C, obs, entregas).status, 'aguardando')
  assert.equal(statusEntregaEmpresa('a', C, obs, entregas).status, 'entregue')
})

test('resumo conta por status', () => {
  const r = resumoEntregas([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'z' }], C, obs, [])
  assert.deepEqual(r, { entregue: 1, aguardando: 0, andamento: 1, a_fazer: 1, sem_obrigacao: 1 })
})
