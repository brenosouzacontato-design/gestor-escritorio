// Corpo do envio na Evolution API 1.x × 2.x (lib/whatsapp.js)
const test = require('node:test')
const assert = require('node:assert')
const { corpoTexto, corpoDocumento } = require('../whatsapp')

test('texto: 1.x aninhado em textMessage, 2.x solto em text', () => {
  assert.deepStrictEqual(corpoTexto(1, '5511988887777', 'oi'), { number: '5511988887777', textMessage: { text: 'oi' } })
  assert.deepStrictEqual(corpoTexto(2, '5511988887777', 'oi'), { number: '5511988887777', text: 'oi' })
})

test('documento: 1.x em mediaMessage, 2.x no nível de cima', () => {
  const doc = { media: 'https://x/guia.pdf', fileName: 'guia.pdf', caption: 'Guia' }
  assert.deepStrictEqual(corpoDocumento(1, '55119', doc), {
    number: '55119', mediaMessage: { mediatype: 'document', mimetype: 'application/pdf', fileName: 'guia.pdf', caption: 'Guia', media: 'https://x/guia.pdf' },
  })
  assert.deepStrictEqual(corpoDocumento(2, '55119', doc), {
    number: '55119', mediatype: 'document', mimetype: 'application/pdf', fileName: 'guia.pdf', caption: 'Guia', media: 'https://x/guia.pdf',
  })
})

test('documento: nome de arquivo sem barra nem caractere proibido (senão não abre no celular)', () => {
  const nome = (fileName) => corpoDocumento(2, '55119', { media: 'x', fileName }).fileName
  assert.strictEqual(nome('NFS-e 2 MMS ARMAZENAGEM E LOGISTICA S/A.pdf'), 'NFS-e 2 MMS ARMAZENAGEM E LOGISTICA S-A.pdf')
  assert.strictEqual(nome('NFS-e 2 MMS ARMAZENAGEM E LOGISTICA S/.pdf'), 'NFS-e 2 MMS ARMAZENAGEM E LOGISTICA S.pdf')
  assert.strictEqual(nome('NF-e 10 A\\B:C*D?.xml'), 'NF-e 10 A-B-C-D.xml')
  assert.strictEqual(nome('/.pdf'), 'documento.pdf')
  assert.strictEqual(nome('guia DAS.pdf'), 'guia DAS.pdf')
})
