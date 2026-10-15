// netlify/functions/lib/nfse/certificado.js
//
// Certificado A1 (e-CNPJ, .pfx): extrai chave e certificado, CNPJ do titular, validade, e faz as
// checagens que bloqueiam a emissão.
//
// A node-forge só é usada para ABRIR o PKCS#12 (o crypto do Node não extrai a chave de um .pfx).
// Assinar e verificar ficam com o crypto nativo: o alerta GHSA-86w9-cpqp-85rv da node-forge é
// sobre a verificação de assinaturas RSA dela, que não usamos.

const crypto = require('crypto')
const forge = require('node-forge')

const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3' // otherName do SAN com o CNPJ da empresa
const DIAS_ALERTA = 30

function lerOtherNames(certForge) {
  const san = certForge.getExtension('subjectAltName')
  if (!san || !san.altNames) return []
  return san.altNames.filter((a) => a.type === 0 && Array.isArray(a.value)).map((a) => {
    // otherName: SEQUENCE { type-id OID, [0] EXPLICIT value }
    const [oid, valor] = a.value
    const oidStr = forge.asn1.derToOid(oid.value)
    let texto = ''
    try {
      const interno = valor.value[0]
      texto = typeof interno.value === 'string' ? interno.value : ''
    } catch { /* formato inesperado: ignora */ }
    return { oid: oidStr, valor: texto }
  })
}

function lerPfx(pfxBuffer, senha) {
  let p12
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')), { strict: false })
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha)
  } catch (e) {
    throw new Error('Não foi possível abrir o certificado: senha errada ou arquivo inválido')
  }
  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ]
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []
  if (!chaves.length || !certs.length) throw new Error('O arquivo .pfx não contém chave privada e certificado')
  const chave = chaves[0].key
  if (!chave || !chave.n) throw new Error('Só certificados com chave RSA são suportados')

  // Certificado do titular = o que tem a mesma chave pública da chave privada; os outros são a cadeia.
  const doTitular = certs.find((b) => b.cert.publicKey.n.equals(chave.n))
  if (!doTitular) throw new Error('Nenhum certificado do .pfx corresponde à chave privada')
  const certForge = doTitular.cert
  const derDe = (c) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary')

  const cn = (certForge.subject.getField('CN') || {}).value || ''
  let cnpj = (lerOtherNames(certForge).find((o) => o.oid === OID_CNPJ_ICP_BRASIL) || {}).valor || ''
  cnpj = cnpj.replace(/\D/g, '')
  if (cnpj.length !== 14) cnpj = ((cn.match(/:(\d{14})$/) || [])[1]) || '' // padrão ICP-Brasil: CN = "RAZAO:CNPJ"
  const certDer = derDe(certForge)
  const certPem = forge.pki.certificateToPem(certForge)
  const cadeiaPem = certs.filter((b) => b !== doTitular).map((b) => forge.pki.certificateToPem(b.cert))
  const chavePem = forge.pki.privateKeyToPem(chave)

  return {
    chavePem,
    certPem,
    certDer,
    cadeiaPem,
    titular: cn.split(':')[0],
    cnpj,
    emissor: (certForge.issuer.getField('CN') || {}).value || '',
    validoDe: certForge.validity.notBefore,
    validoAte: certForge.validity.notAfter,
    // Para o TLS mútuo com a Sefin: chave + certificado + cadeia em PEM (o https do Node aceita direto)
    tls: { key: chavePem, cert: [certPem, ...cadeiaPem].join('') },
  }
}

function diasRestantes(cert, agora = new Date()) {
  return Math.floor((cert.validoAte.getTime() - agora.getTime()) / 86400000)
}

function checar(cert, cnpjEmpresa, agora = new Date()) {
  const bloqueios = []
  const alertas = []
  if (cert.cnpj !== cnpjEmpresa) {
    bloqueios.push(`CNPJ do certificado (${cert.cnpj || 'não encontrado'}) é diferente da empresa (${cnpjEmpresa})`)
  }
  const br = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  if (agora < cert.validoDe) bloqueios.push(`Certificado só vale a partir de ${br(cert.validoDe)}`)
  const dias = diasRestantes(cert, agora)
  if (dias < 0) bloqueios.push(`Certificado vencido em ${br(cert.validoAte)}`)
  else if (dias < DIAS_ALERTA) alertas.push(`Certificado vence em ${dias} dia(s) (${br(cert.validoAte)}). Providencie a renovação.`)
  return { bloqueios, alertas }
}

// Confere que a chave privada extraída assina e o certificado verifica (sanidade do .pfx).
function testarPar(cert) {
  const amostra = Buffer.from('teste')
  const sig = crypto.createSign('RSA-SHA256').update(amostra).sign(cert.chavePem)
  return crypto.createVerify('RSA-SHA256').update(amostra).verify(new crypto.X509Certificate(cert.certDer).publicKey, sig)
}

module.exports = { lerPfx, checar, diasRestantes, testarPar, DIAS_ALERTA }
