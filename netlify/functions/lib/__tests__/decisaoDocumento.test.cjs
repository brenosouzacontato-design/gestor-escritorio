// Grupo Documentos: resposta "1 = tarefa / 2 = arquivar" (lib/decisaoDocumento.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const d = require('../decisaoDocumento')

test('1 ou "tarefa" cria tarefa, com ou sem descrição', () => {
  assert.deepEqual(d.lerDecisao('1'), { acao: 'tarefa', descricao: null })
  assert.deepEqual(d.lerDecisao(' 1 - pedir extrato  ao cliente '), { acao: 'tarefa', descricao: 'pedir extrato ao cliente' })
  assert.deepEqual(d.lerDecisao('Tarefa: conferir contrato'), { acao: 'tarefa', descricao: 'conferir contrato' })
  assert.deepEqual(d.lerDecisao('1) ligar pro João'), { acao: 'tarefa', descricao: 'ligar pro João' })
})

test('2 ou "arquivar" arquiva', () => {
  for (const t of ['2', ' 2 ', 'arquivar', 'Arquiva', 'arquivado!', 'arquive']) assert.deepEqual(d.lerDecisao(t), { acao: 'arquivar' }, t)
})

test('conversa comum não é decisão', () => {
  for (const t of ['', 'ok', '12', '10 reais', '2 guias anexas', 'tarefas de hoje', 'arquivos novos', 'bom dia']) assert.equal(d.lerDecisao(t), null, t)
})

test('id da mensagem citada, inclusive em mensagem temporária', () => {
  const citando = { extendedTextMessage: { text: '1', contextInfo: { stanzaId: 'ABC123' } } }
  assert.equal(d.idCitado(citando), 'ABC123')
  assert.equal(d.idCitado({ ephemeralMessage: { message: citando } }), 'ABC123')
  assert.equal(d.idCitado({ conversation: '1' }), null)
})

test('id da mensagem enviada vem do corpo da Evolution', () => {
  assert.equal(d.idMensagemEnviada('{"key":{"remoteJid":"x@g.us","fromMe":true,"id":"BAE5F"},"status":"PENDING"}'), 'BAE5F')
  assert.equal(d.idMensagemEnviada('não é json'), null)
  assert.equal(d.idMensagemEnviada(undefined), null)
})

test('título da tarefa: descrição escrita ou tipo + arquivo', () => {
  assert.equal(d.tituloTarefa({ nome_arquivo: 'a.pdf' }, 'cobrar extrato'), 'cobrar extrato')
  assert.equal(d.tituloTarefa({ nome_arquivo: 'a.pdf', tipo_documento_sugerido: 'Contrato social' }), 'Contrato social: a.pdf')
  assert.equal(d.tituloTarefa({ nome_arquivo: 'a.pdf', tipo_documento_sugerido: 'Documento não identificado' }), 'Documento recebido: a.pdf')
})
