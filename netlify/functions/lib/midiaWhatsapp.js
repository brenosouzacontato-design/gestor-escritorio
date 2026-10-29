// Arquivos (foto, print ou documento) que chegam pelo WhatsApp.
//
// Junta num lugar só o que o webhook precisa para tratar imagem e print do
// mesmo jeito que PDF: achar a mídia dentro dos "envelopes" do WhatsApp
// (mensagem temporária, visualização única, documento com legenda),
// descobrir o tipo real do arquivo e dizer se a leitura automática (IA)
// consegue ler. Lógica pura, testada em __tests__/midiaWhatsapp.test.cjs.

const MIME_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const EXTENSAO_POR_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
}

// A API da Anthropic recusa imagem acima de 5 MB e PDF acima de 32 MB.
// Margem pequena porque o limite vale para o arquivo, e aqui medimos o base64.
const LIMITE_IMAGEM_B64 = Math.floor(5 * 1024 * 1024 * 4 / 3) - 1024
const LIMITE_PDF_B64 = Math.floor(32 * 1024 * 1024 * 4 / 3) - 1024

const ENVELOPES = [
  'ephemeralMessage',            // grupo com mensagens temporárias
  'viewOnceMessage',             // foto de visualização única
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',  // documento enviado com legenda
  'editedMessage',
]

// Tira os envelopes até chegar na mensagem de verdade.
function desembrulhar(message) {
  let m = message || {}
  for (let i = 0; i < 5; i++) {
    const chave = ENVELOPES.find((k) => m?.[k]?.message)
    if (!chave) break
    m = m[chave].message
  }
  return m || {}
}

// { midia, tipo: 'imagem' | 'documento', legenda } ou null.
// O base64 que a Evolution manda ao lado do bloco (data.message.base64)
// vem junto em midia.base64 quando o bloco não traz o seu.
function extrairMidia(message) {
  const base64Externo = message?.base64 || null
  const m = desembrulhar(message)
  const imagem = m.imageMessage
  const documento = m.documentMessage
  const bloco = imagem || documento
  if (!bloco) return null
  return {
    midia: { ...bloco, base64: bloco.base64 || base64Externo || undefined },
    tipo: imagem ? 'imagem' : 'documento',
    legenda: String(bloco.caption || '').trim() || null,
  }
}

// Texto da mensagem (com ou sem envelope); legenda de foto não conta.
function extrairTexto(message) {
  const m = desembrulhar(message)
  return m.conversation || m.extendedTextMessage?.text || ''
}

// Evolution às vezes manda "data:image/jpeg;base64,...."
function limparBase64(base64) {
  return String(base64 || '').replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
}

function normalizarMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim()
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg'
  return m || 'application/octet-stream'
}

// Tipo real pelo começo do conteúdo: o mimetype do WhatsApp às vezes não
// bate (print mandado como documento "application/octet-stream", foto
// marcada como PDF), e a API recusa o arquivo inteiro nesse caso.
function tipoReal(base64, mimeInformado) {
  const inicio = limparBase64(base64).slice(0, 16)
  if (inicio.startsWith('JVBER')) return 'application/pdf'
  if (inicio.startsWith('/9j/')) return 'image/jpeg'
  if (inicio.startsWith('iVBOR')) return 'image/png'
  if (inicio.startsWith('UklGR')) return 'image/webp'
  if (inicio.startsWith('R0lGO')) return 'image/gif'
  // HEIC/HEIF (foto de iPhone mandada como documento): "....ftypheic"
  const cabecalho = Buffer.from(inicio, 'base64').toString('latin1')
  if (/ftyp(heic|heix|hevc|mif1|msf1)/.test(cabecalho)) return 'image/heic'
  return normalizarMime(mimeInformado)
}

// A IA consegue ler? { ok: true } ou { ok: false, motivo }
function leituraPossivel(base64, mime) {
  const b64 = limparBase64(base64)
  if (MIME_IMAGEM.includes(mime)) {
    return b64.length <= LIMITE_IMAGEM_B64
      ? { ok: true }
      : { ok: false, motivo: 'imagem grande demais para a leitura automática (mais de 5 MB)' }
  }
  if (mime === 'application/pdf') {
    return b64.length <= LIMITE_PDF_B64
      ? { ok: true }
      : { ok: false, motivo: 'PDF grande demais para a leitura automática (mais de 32 MB)' }
  }
  if (mime === 'image/heic') return { ok: false, motivo: 'foto em formato HEIC (iPhone) mandada como documento: mande como foto' }
  return { ok: false, motivo: `formato que a leitura automática não lê (${mime})` }
}

// Bloco de conteúdo da mensagem para a API (imagem ou PDF).
function blocoArquivo(base64, mime) {
  const data = limparBase64(base64)
  return MIME_IMAGEM.includes(mime)
    ? { type: 'image', source: { type: 'base64', media_type: mime, data } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
}

// Nome do arquivo: o do documento, ou "print-2026-10-29-1432.jpg" para foto.
function nomeDoArquivo(midia, tipo, mime, agora = new Date()) {
  const ext = EXTENSAO_POR_MIME[mime] || 'bin'
  const original = String(midia?.fileName || '').trim()
  if (original) {
    // corrige a extensão quando o tipo real é outro (print salvo como .pdf)
    return /\.[a-z0-9]{2,5}$/i.test(original) && EXTENSAO_POR_MIME[mime]
      ? original.replace(/\.[a-z0-9]{2,5}$/i, `.${ext}`)
      : original
  }
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(agora).reduce((o, x) => ({ ...o, [x.type]: x.value }), {})
  const prefixo = tipo === 'imagem' ? 'imagem' : 'whatsapp'
  return `${prefixo}-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.${ext}`
}

// Trecho para o prompt com a legenda que veio junto com o arquivo.
function textoLegenda(legenda) {
  return legenda ? `\n\nMensagem enviada junto com o arquivo: "${String(legenda).slice(0, 500)}"` : ''
}

module.exports = {
  MIME_IMAGEM,
  EXTENSAO_POR_MIME,
  desembrulhar,
  extrairMidia,
  extrairTexto,
  limparBase64,
  normalizarMime,
  tipoReal,
  leituraPossivel,
  blocoArquivo,
  nomeDoArquivo,
  textoLegenda,
}
