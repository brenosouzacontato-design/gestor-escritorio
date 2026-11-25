// "opções" nos grupos do WhatsApp: cada grupo responde com os próprios comandos (lib/menuWhatsapp.js).
const test = require('node:test')
const assert = require('node:assert/strict')
const m = require('../menuWhatsapp')

test('pedeOpcoes: só a mensagem inteira pedindo a lista', () => {
  for (const t of ['opções', 'Opções?', 'OPCOES', 'opção', 'opcao', '*menu*', 'comandos', 'comando', 'ajuda', ' help! ']) assert.ok(m.pedeOpcoes(t), t)
  for (const t of ['opções de pagamento', 'qual o menu de hoje', 'tarefa: ajuda no DAS', 'preciso de ajuda', '', null]) assert.ok(!m.pedeOpcoes(t), String(t))
})

test('textoOpcoes: cada grupo com os seus comandos', () => {
  const esc = m.textoOpcoes('escritorio')
  for (const c of ['tarefa:', 'obrigação:', 'reunião:', 'lembrete:']) assert.match(esc, new RegExp(c))
  assert.doesNotMatch(esc, /nfse/)
  const docs = m.textoOpcoes('documentos')
  for (const c of [/\*nfse\*/, /agendar nfse/, /Mande um arquivo/, /Extrato bancário/]) assert.match(docs, c)
  assert.match(m.textoOpcoes('pagamentos'), /comprovante/)
  // a resposta não pode ser lida como pedido de novo (o robô não responde a si mesmo em laço)
  for (const g of m.GRUPOS) assert.ok(!m.pedeOpcoes(m.textoOpcoes(g)))
})
