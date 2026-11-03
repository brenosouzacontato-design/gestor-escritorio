const test = require('node:test')
const assert = require('node:assert/strict')
const { diasAte, avisosPendentes, textoAviso, deveCriarTarefa, dadosTarefa, nomeLicenca, horaSaoPaulo } = require('../licencas')

const base = { tipo: 'sanitario', cliente_id: 'c1', avisos_dias: [60, 30], avisos_enviados: [], criar_tarefa: true, clientes: { nome: 'Padaria Exemplo' } }

test('diasAte conta dias corridos, negativo depois de vencer', () => {
  assert.equal(diasAte('2026-12-03', '2026-11-03'), 30)
  assert.equal(diasAte('2026-11-03', '2026-11-03'), 0)
  assert.equal(diasAte('2026-10-30', '2026-11-03'), -4)
  assert.equal(diasAte(null, '2026-11-03'), null)
})

test('nenhum aviso longe do vencimento', () => {
  const r = avisosPendentes({ ...base, data_validade: '2027-06-30' }, '2026-11-03')
  assert.equal(r.enviar, false)
})

test('aviso de 60 dias chega uma vez', () => {
  const l = { ...base, data_validade: '2027-01-02' } // 60 dias
  assert.deepEqual(avisosPendentes(l, '2026-11-03').marcar, [60])
  assert.equal(avisosPendentes({ ...l, avisos_enviados: [60] }, '2026-11-03').enviar, false)
})

test('licença cadastrada já vencida marca todos os avisos com uma mensagem', () => {
  const r = avisosPendentes({ ...base, data_validade: '2026-10-01' }, '2026-11-03')
  assert.equal(r.enviar, true)
  assert.deepEqual(r.marcar, [60, 30, 0])
})

test('sem validade ou arquivada não avisa', () => {
  assert.equal(avisosPendentes({ ...base, data_validade: null }, '2026-11-03').enviar, false)
  assert.equal(avisosPendentes({ ...base, data_validade: '2026-11-04', arquivada: true }, '2026-11-03').enviar, false)
})

test('valores estranhos em avisos_dias são ignorados', () => {
  const r = avisosPendentes({ ...base, avisos_dias: [-5, 15, null], data_validade: '2026-11-10' }, '2026-11-03')
  assert.deepEqual(r.marcar, [15])
})

test('texto do aviso traz cliente, prazo e etapa', () => {
  const t = textoAviso({ ...base, data_validade: '2026-11-20', orgao: 'Vigilância', etapa: 'protocolado', protocolo: '123' }, 17)
  assert.match(t, /Licença vencendo/)
  assert.match(t, /Alvará sanitário · Vigilância/)
  assert.match(t, /Padaria Exemplo/)
  assert.match(t, /vence em 17 dias \(20\/11\/2026\)/)
  assert.match(t, /protocolado no órgão · prot\. 123/)
  assert.match(textoAviso({ ...base, data_validade: '2026-11-01' }, -2), /venceu há 2 dias/)
})

test('tarefa só no primeiro aviso, sem tarefa e sem renovação em andamento', () => {
  const p = { enviar: true }
  assert.equal(deveCriarTarefa(base, p), true)
  assert.equal(deveCriarTarefa({ ...base, tarefa_id: 't1' }, p), false)
  assert.equal(deveCriarTarefa({ ...base, etapa: 'protocolado' }, p), false)
  assert.equal(deveCriarTarefa({ ...base, criar_tarefa: false }, p), false)
  assert.equal(deveCriarTarefa(base, { enviar: false }), false)
  const t = dadosTarefa({ ...base, data_validade: '2026-11-20' }, 17)
  assert.equal(t.titulo, 'Renovar Alvará sanitário')
  assert.equal(t.prioridade, 'alta')
  assert.equal(t.vencimento, '2026-11-20')
})

test('nome usa a descrição quando o tipo é outro', () => {
  assert.equal(nomeLicenca({ tipo: 'outro', descricao: 'Licença da polícia civil' }), 'Licença da polícia civil')
  assert.equal(nomeLicenca({ tipo: 'outro' }), 'Licença')
})

test('hora de São Paulo', () => {
  assert.equal(horaSaoPaulo(new Date('2026-11-03T11:30:00Z')), 8)
})
