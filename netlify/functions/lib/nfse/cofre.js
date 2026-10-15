// netlify/functions/lib/nfse/cofre.js
//
// Cifra o .pfx e a senha do certificado A1 antes de gravar no Supabase (AES-256-GCM).
// A chave fica só no Netlify: NFSE_CERT_KEY = 32 bytes em base64. Gerar uma vez com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Perder a chave = recadastrar os certificados. Trocar a chave = idem.

const crypto = require('crypto')

function chave(chaveB64 = process.env.NFSE_CERT_KEY) {
  const k = Buffer.from(chaveB64 || '', 'base64')
  if (k.length !== 32) throw new Error('NFSE_CERT_KEY ausente ou inválida (precisa ter 32 bytes em base64)')
  return k
}

// Formato: base64( iv[12] | tag[16] | dados )
function cifrar(dados, chaveB64) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', chave(chaveB64), iv)
  const cifrado = Buffer.concat([c.update(Buffer.isBuffer(dados) ? dados : Buffer.from(dados, 'utf8')), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), cifrado]).toString('base64')
}

function decifrar(b64, chaveB64) {
  const buf = Buffer.from(b64, 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', chave(chaveB64), buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()])
}

module.exports = { cifrar, decifrar }
