// netlify/functions/lib/nfse/assinatura.js
//
// Assinatura XMLDSIG da DPS: envelopada em <infDPS> (Reference URI="#Id"), C14N 1.0 inclusiva,
// RSA-SHA256, digest SHA-256 e o certificado em <X509Certificate>. A <Signature> fica dentro
// de <DPS>, logo depois de <infDPS> (como no XSD). Usa só o crypto nativo do Node.

const crypto = require('crypto')
const { canonico, filho, novo } = require('./xml')

const DS = 'http://www.w3.org/2000/09/xmldsig#'
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'

function alvo(raiz) {
  const el = raiz.children[0]
  const id = el && (el.attrs.find(([k]) => k === 'Id') || [])[1]
  if (!id) throw new Error('O primeiro filho da raiz precisa ter atributo Id (ex.: infDPS)')
  return { el, id }
}

const digest = (texto) => crypto.createHash('sha256').update(Buffer.from(texto, 'utf8')).digest('base64')

// certificado: { chavePem, certDer (Buffer) }. Altera e devolve `raiz`.
function assinar(raiz, certificado) {
  if (raiz.children.some((c) => c.tag === 'Signature')) throw new Error('Documento já está assinado')
  const { el, id } = alvo(raiz)
  const valorDigest = digest(canonico(el, raiz.ns))

  const signedInfo = novo('SignedInfo')
  signedInfo.children = [
    novo('CanonicalizationMethod', '', [['Algorithm', C14N]]),
    novo('SignatureMethod', '', [['Algorithm', RSA_SHA256]]),
    {
      ...novo('Reference', '', [['URI', `#${id}`]]),
      children: [
        { ...novo('Transforms'), children: [novo('Transform', '', [['Algorithm', ENVELOPED]]), novo('Transform', '', [['Algorithm', C14N]])] },
        novo('DigestMethod', '', [['Algorithm', SHA256]]),
        novo('DigestValue', valorDigest),
      ],
    },
  ]
  const assinatura = crypto.createSign('RSA-SHA256').update(Buffer.from(canonico(signedInfo, DS), 'utf8')).sign(certificado.chavePem)
  const sig = { ...novo('Signature'), ns: DS }
  sig.children = [
    signedInfo,
    novo('SignatureValue', assinatura.toString('base64')),
    { ...novo('KeyInfo'), children: [{ ...novo('X509Data'), children: [novo('X509Certificate', certificado.certDer.toString('base64'))] }] },
  ]
  raiz.children.push(sig)
  return raiz
}

// Confere digest e assinatura com o certificado embutido. Lança erro se não bater.
function verificar(raiz) {
  const sig = raiz.children.find((c) => c.tag === 'Signature')
  if (!sig) throw new Error('Documento sem assinatura')
  const { el, id } = alvo(raiz)
  const signedInfo = filho(sig, 'SignedInfo')
  const ref = filho(signedInfo, 'Reference')
  if ((ref.attrs.find(([k]) => k === 'URI') || [])[1] !== `#${id}`) throw new Error('Reference URI não aponta para o elemento assinado')
  if (digest(canonico(el, raiz.ns)) !== filho(ref, 'DigestValue').text) {
    throw new Error('DigestValue não confere: o conteúdo foi alterado depois de assinado')
  }
  const cert = new crypto.X509Certificate(Buffer.from(filho(sig, 'KeyInfo/X509Data/X509Certificate').text, 'base64'))
  const ok = crypto.createVerify('RSA-SHA256').update(Buffer.from(canonico(signedInfo, sig.ns), 'utf8'))
    .verify(cert.publicKey, Buffer.from(filho(sig, 'SignatureValue').text, 'base64'))
  if (!ok) throw new Error('SignatureValue inválido')
}

module.exports = { assinar, verificar, DS }
