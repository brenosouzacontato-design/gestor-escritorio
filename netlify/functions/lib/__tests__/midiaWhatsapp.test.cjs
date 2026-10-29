const test = require('node:test')
const assert = require('node:assert/strict')
const m = require('../midiaWhatsapp')

// Conteúdos fictícios: só o começo de cada tipo de arquivo
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64')
const PDF = Buffer.from('%PDF-1.7\n%fake').toString('base64')
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic0000')]).toString('base64')

test('acha foto, print e documento, inclusive dentro dos envelopes do WhatsApp', () => {
  const foto = m.extrairMidia({ imageMessage: { mimetype: 'image/jpeg', caption: ' DAS da Loja pago ' } })
  assert.equal(foto.tipo, 'imagem')
  assert.equal(foto.legenda, 'DAS da Loja pago')

  const temporaria = m.extrairMidia({ ephemeralMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } } })
  assert.equal(temporaria.tipo, 'imagem')

  const unica = m.extrairMidia({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } })
  assert.equal(unica.tipo, 'imagem')

  const docLegenda = m.extrairMidia({
    ephemeralMessage: { message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: 'guia.pdf', caption: 'guia FGTS' } } } } },
  })
  assert.equal(docLegenda.tipo, 'documento')
  assert.equal(docLegenda.legenda, 'guia FGTS')

  assert.equal(m.extrairMidia({ conversation: 'oi' }), null)
  assert.equal(m.extrairMidia(undefined), null)
})

test('base64 que vem ao lado do bloco (Webhook Base64) é aproveitado', () => {
  const a = m.extrairMidia({ imageMessage: { mimetype: 'image/jpeg' }, base64: JPEG })
  assert.equal(a.midia.base64, JPEG)
  const b = m.extrairMidia({ imageMessage: { mimetype: 'image/jpeg', base64: PNG }, base64: JPEG })
  assert.equal(b.midia.base64, PNG)
})

test('texto também é lido em mensagem temporária', () => {
  assert.equal(m.extrairTexto({ conversation: 'tarefa: x' }), 'tarefa: x')
  assert.equal(m.extrairTexto({ ephemeralMessage: { message: { extendedTextMessage: { text: 'lembrete: y' } } } }), 'lembrete: y')
  assert.equal(m.extrairTexto({ imageMessage: { caption: 'legenda' } }), '')
})

test('tipo real pelo conteúdo, não pelo que o WhatsApp informa', () => {
  assert.equal(m.tipoReal(PNG, 'application/octet-stream'), 'image/png') // print mandado como documento
  assert.equal(m.tipoReal(JPEG, 'application/pdf'), 'image/jpeg')
  assert.equal(m.tipoReal(PDF, 'image/jpeg'), 'application/pdf')
  assert.equal(m.tipoReal(`data:image/jpeg;base64,${JPEG}`, null), 'image/jpeg')
  assert.equal(m.tipoReal(HEIC, 'application/octet-stream'), 'image/heic')
  assert.equal(m.tipoReal('AAAA', 'image/jpg'), 'image/jpeg')
  assert.equal(m.tipoReal('AAAA', ''), 'application/octet-stream')
})

test('leitura automática: imagem até 5 MB, PDF até 32 MB, HEIC não', () => {
  assert.equal(m.leituraPossivel(JPEG, 'image/jpeg').ok, true)
  assert.equal(m.leituraPossivel(PDF, 'application/pdf').ok, true)
  const grande = 'A'.repeat(7 * 1024 * 1024)
  const r = m.leituraPossivel(grande, 'image/png')
  assert.equal(r.ok, false)
  assert.match(r.motivo, /5 MB/)
  assert.equal(m.leituraPossivel(grande, 'application/pdf').ok, true)
  assert.match(m.leituraPossivel(HEIC, 'image/heic').motivo, /mande como foto/)
  assert.equal(m.leituraPossivel('x', 'application/zip').ok, false)
})

test('bloco para a API: imagem como image, PDF como document, sem prefixo data:', () => {
  const img = m.blocoArquivo(`data:image/png;base64,${PNG}`, 'image/png')
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } })
  assert.equal(m.blocoArquivo(PDF, 'application/pdf').type, 'document')
})

test('nome do arquivo: foto ganha nome com data; extensão segue o tipo real', () => {
  const agora = new Date('2026-10-29T17:32:00Z') // 14:32 em SP
  assert.equal(m.nomeDoArquivo({}, 'imagem', 'image/jpeg', agora), 'imagem-2026-10-29-1432.jpg')
  assert.equal(m.nomeDoArquivo({ fileName: 'comprovante.pdf' }, 'documento', 'image/png', agora), 'comprovante.png')
  assert.equal(m.nomeDoArquivo({ fileName: 'guia DAS.pdf' }, 'documento', 'application/pdf', agora), 'guia DAS.pdf')
  assert.equal(m.nomeDoArquivo({ fileName: 'sem extensao' }, 'documento', 'application/pdf', agora), 'sem extensao')
})

test('legenda vira pista no prompt', () => {
  assert.equal(m.textoLegenda(null), '')
  assert.match(m.textoLegenda('DAS pago'), /Mensagem enviada junto com o arquivo: "DAS pago"/)
})

test('comprovante em print: vai para a IA como imagem, com a legenda como pista', async () => {
  const { analisarComprovante } = require('../comprovantePagamento')
  const { identificarDocumento } = require('../identificarDocumento')
  const fila = { data: [], error: null }
  const q = new Proxy({}, { get: (_, k) => (k === 'then' ? (f) => Promise.resolve(fila).then(f) : () => q) })
  const supabase = { from: () => q }
  const enviados = []
  const fetchOriginal = global.fetch
  global.fetch = async (_url, opts) => {
    enviados.push(JSON.parse(opts.body))
    const json = enviados.length === 1
      ? { ehComprovante: true, valorPago: 10.5, dataPagamento: '2026-10-20', confianca: 'baixa' }
      : { tipoDocumento: 'Guia do FGTS', confianca: 'baixa' }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) }
  }
  try {
    const a = await analisarComprovante(supabase, { arquivoBase64: PNG, filename: 'print.pdf', mimeType: 'application/octet-stream', legenda: 'DAS da Loja Teste', apiKey: 'chave-de-teste' })
    assert.equal(a.ehComprovante, true)
    assert.equal(a.valorPago, 10.5)
    const [arquivo, texto] = enviados[0].messages[0].content
    assert.equal(arquivo.type, 'image')
    assert.equal(arquivo.source.media_type, 'image/png')
    assert.match(texto.text, /DAS da Loja Teste/)

    const d = await identificarDocumento({ arquivoBase64: `data:image/jpeg;base64,${JPEG}`, filename: 'foto.jpg', mimeType: 'image/jpeg', legenda: 'guia FGTS', candidatos: [], apiKey: 'chave-de-teste' })
    assert.equal(d.tipoDocumento, 'Guia do FGTS')
    assert.equal(enviados[1].messages[0].content[0].source.data, JPEG)

    await assert.rejects(
      analisarComprovante(supabase, { arquivoBase64: HEIC, filename: 'foto.heic', mimeType: 'application/octet-stream', apiKey: 'chave-de-teste' }),
      /mande como foto/)
    assert.equal(enviados.length, 2) // HEIC nem chega à API
  } finally {
    global.fetch = fetchOriginal
  }
})
