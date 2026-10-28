const test = require('node:test')
const assert = require('node:assert/strict')
const c = require('../comandosWhatsapp')

// Dados fictícios
const clientes = [
  { id: 'c1', nome: 'Clínica Exemplo' },
  { id: 'c2', nome: 'Loja Teste' },
]
const tipos = [{ id: 't1', nome: 'DCTFWeb' }]
const HOJE = '2026-10-28' // quarta-feira

test('detecta as quatro categorias, com e sem acento, negrito e maiúsculas', () => {
  assert.deepEqual(c.detectarComando('tarefa: conferir DAS'), { categoria: 'tarefa', texto: 'conferir DAS' })
  assert.deepEqual(c.detectarComando('Obrigação: DCTFWeb da Loja'), { categoria: 'obrigacao', texto: 'DCTFWeb da Loja' })
  assert.equal(c.detectarComando('obrigacao - DCTFWeb').categoria, 'obrigacao')
  assert.deepEqual(c.detectarComando('*Reunião:* com a Clínica sexta 14h'), { categoria: 'reuniao', texto: 'com a Clínica sexta 14h' })
  assert.equal(c.detectarComando('REUNIAO: alinhamento').categoria, 'reuniao')
  assert.equal(c.detectarComando('  lembrete: ligar amanhã 9h').categoria, 'lembrete')
})

test('ignora mensagem sem prefixo, prefixo desconhecido ou sem texto', () => {
  assert.equal(c.detectarComando('bom dia pessoal'), null)
  assert.equal(c.detectarComando('obs: nada'), null)
  assert.equal(c.detectarComando('tarefa:   '), null)
  assert.equal(c.detectarComando(''), null)
  assert.equal(c.detectarComando('a tarefa: x'), null)
})

test('lê datas e horas do texto sem IA', () => {
  assert.deepEqual(c.extrairDataHora('amanhã 9h', HOJE), { data: '2026-10-29', hora: '09:00' })
  assert.deepEqual(c.extrairDataHora('depois de amanhã às 14:30', HOJE), { data: '2026-10-30', hora: '14:30' })
  assert.deepEqual(c.extrairDataHora('sexta 14h30', HOJE), { data: '2026-10-30', hora: '14:30' })
  assert.deepEqual(c.extrairDataHora('quarta', HOJE), { data: '2026-11-04', hora: null }) // próxima, não hoje
  assert.deepEqual(c.extrairDataHora('dia 25/11 as 10', HOJE), { data: '2026-11-25', hora: '10:00' })
  assert.equal(c.extrairDataHora('05/01', '2026-12-20').data, '2027-01-05')
  assert.deepEqual(c.extrairDataHora('competência 10/2026', HOJE), { data: null, hora: null })
})

test('lembrete sem data cai hoje ou amanhã conforme a hora', () => {
  const manha = new Date('2026-10-28T11:00:00Z') // 08:00 em SP
  const noite = new Date('2026-10-28T23:00:00Z') // 20:00 em SP
  const a = c.normalizarExtracao('lembrete', null, { texto: 'ligar para o contador 15h', clientes, hoje: HOJE, agora: manha })
  assert.equal(a.data, HOJE)
  assert.equal(a.dataHora, '2026-10-28T15:00:00-03:00')
  const b = c.normalizarExtracao('lembrete', null, { texto: 'ligar para o contador 15h', clientes, hoje: HOJE, agora: noite })
  assert.equal(b.data, '2026-10-29')
  const semHora = c.normalizarExtracao('lembrete', { titulo: 'Enviar guia' }, { texto: 'enviar guia amanhã', clientes, hoje: HOJE })
  assert.equal(semHora.hora, '09:00')
})

test('valida o que a IA devolve: ids inventados e datas ruins viram null', () => {
  const r = c.normalizarExtracao('obrigacao',
    { titulo: 'DCTFWeb', cliente_id: 'inventado', tipo_obrigacao_id: 'x', competencia: '13/2026', vencimento: '2026-02-30' },
    { texto: 'DCTFWeb', clientes, tipos, hoje: HOJE })
  assert.equal(r.cliente_id, null)
  assert.equal(r.tipo_obrigacao_id, null)
  assert.equal(r.competencia, '10/2026')
  assert.equal(r.vencimento, null)
  assert.deepEqual(c.pendencias(r).length, 2)

  const ok = c.normalizarExtracao('obrigacao',
    { titulo: 'DCTFWeb', cliente_id: 'c2', tipo_obrigacao_id: 't1', competencia: '9/2026' },
    { texto: 'DCTFWeb da Loja', clientes, tipos, hoje: HOJE })
  assert.equal(ok.competencia, '09/2026')
  assert.deepEqual(c.pendencias(ok), [])
})

test('reunião: precisa de dia; lembrete 1 hora antes ou às 8h', () => {
  const sem = c.normalizarExtracao('reuniao', null, { texto: 'alinhamento com a Loja', clientes, hoje: HOJE })
  assert.deepEqual(c.pendencias(sem), ['o dia da reunião'])
  const r = c.normalizarExtracao('reuniao', { titulo: 'Alinhamento', cliente_id: 'c1', duracao_min: 45, local: 'Meet' },
    { texto: 'alinhamento sexta 14h', clientes, hoje: HOJE })
  assert.equal(r.data, '2026-10-30')
  assert.equal(r.hora, '14:00')
  assert.equal(r.duracao_min, 45)
  assert.equal(c.lembreteReuniao(r.data, r.hora), '2026-10-30T16:00:00.000Z') // 13h em SP
  assert.equal(c.lembreteReuniao('2026-10-30', null), '2026-10-30T08:00:00-03:00')
})

test('urgente vira prioridade alta mesmo sem a IA', () => {
  const t = c.normalizarExtracao('tarefa', null, { texto: 'URGENTE: refazer guia amanhã', clientes, hoje: HOJE })
  assert.equal(t.prioridade, 'alta')
  assert.equal(t.prazo, '2026-10-29')
  assert.equal(t.departamento, 'contabil')
})

test('vencimento pelo tipo e leitura da resposta da IA', () => {
  assert.equal(c.calcularVencimento('10/2026', 'seguinte', 31), '2026-11-30')
  assert.equal(c.calcularVencimento('12/2026', 'seguinte', 20), '2027-01-20')
  assert.deepEqual(c.parseJSONResposta('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(c.parseJSONResposta('Aqui: {"a":2} pronto'), { a: 2 })
})

test('confirmações no grupo', () => {
  const r = { categoria: 'reuniao', titulo: 'Alinhamento', data: '2026-10-30', hora: '14:00', local: 'Meet' }
  const msg = c.confirmacao(r, { nomeCliente: 'Clínica Exemplo' })
  assert.match(msg, /Reunião marcada/)
  assert.match(msg, /30\/10\/2026 às 14:00/)
  const falha = c.confirmacao({ categoria: 'obrigacao', titulo: 'DCTFWeb' }, { falta: ['o cliente'] })
  assert.match(falha, /Obrigação não criada: faltou o cliente/)
  assert.match(falha, /tarefa/)
  assert.match(falha, /mande de novo com o cliente/)
  const semAgenda = c.confirmacao({ categoria: 'reuniao', titulo: 'X', data: '2026-10-30' }, { falta: ['a Agenda ativada no banco de dados'] })
  assert.doesNotMatch(semAgenda, /mande de novo/)
})

test('prompt traz a lista de tipos só para obrigação', () => {
  const p1 = c.promptExtracao('obrigacao', 'x', { clientes, tipos, hoje: HOJE })
  assert.match(p1, /DCTFWeb \(id: t1\)/)
  assert.match(p1, /quarta-feira, 28\/10\/2026/)
  const p2 = c.promptExtracao('reuniao', 'x', { clientes, tipos, hoje: HOJE })
  assert.doesNotMatch(p2, /Tipos de obrigação/)
})
