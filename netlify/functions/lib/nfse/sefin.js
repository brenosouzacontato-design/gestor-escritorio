// netlify/functions/lib/nfse/sefin.js
//
// Cliente da API Sefin Nacional com TLS mútuo (certificado A1 da empresa).
//   POST /nfse         envia a DPS assinada (gzip + base64) e recebe a NFS-e
//   GET  /dps/{id}     descobre se uma DPS já gerou NFS-e (devolve a chave de acesso)
//   GET  /nfse/{chave} baixa o XML da NFS-e
//
// Respostas observadas na prática (produção restrita e produção, out/2026):
//   201 { chaveAcesso, idDps, nfseXmlGZipB64, alertas? }
//   200 { chaveAcesso }                                  (GET /dps)
//   404 { erro: { codigo: "E2404", descricao } }         (DPS sem NFS-e)
//   4xx { erros: [{ Codigo, Descricao, Complemento }] }  (rejeição)

const https = require('https')
const zlib = require('zlib')

const URLS = {
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
}

class ErroRede extends Error {} // timeout ou falha de conexão: não dá para saber se a Sefin recebeu

const comprimir = (xml) => zlib.gzipSync(Buffer.isBuffer(xml) ? xml : Buffer.from(xml, 'utf8')).toString('base64')
const descomprimir = (b64) => zlib.gunzipSync(Buffer.from(b64, 'base64'))

// tls: { key, cert } em PEM (de certificado.lerPfx). `transporte` só nos testes.
function criarCliente({ tls, ambiente, timeoutMs = 20000, transporte = null }) {
  if (!URLS[ambiente]) throw new Error(`Ambiente desconhecido: ${ambiente}`)
  const base = URLS[ambiente]
  const agent = transporte ? null : new https.Agent({ key: tls.key, cert: tls.cert, keepAlive: true })

  function chamar(metodo, caminho, corpo) {
    if (transporte) return transporte(metodo, caminho, corpo)
    return new Promise((resolve, reject) => {
      const dados = corpo ? Buffer.from(JSON.stringify(corpo), 'utf8') : null
      const req = https.request(`${base}${caminho}`, {
        method: metodo,
        agent,
        headers: {
          Accept: 'application/json',
          ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
        },
      }, (res) => {
        const partes = []
        res.on('data', (p) => partes.push(p))
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8')
          let json = {}
          try { json = texto ? JSON.parse(texto) : {} } catch { json = {} }
          resolve({ status: res.statusCode, dados: json && typeof json === 'object' ? json : {}, texto })
        })
        res.on('error', (e) => reject(new ErroRede(`${e.code || e.name}: ${e.message}`)))
      })
      req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
      req.on('error', (e) => reject(new ErroRede(`${e.code || e.name}: ${e.message}`)))
      if (dados) req.write(dados)
      req.end()
    })
  }

  return {
    ambiente,
    emitir: (xmlAssinado) => chamar('POST', '/nfse', { dpsXmlGZipB64: comprimir(xmlAssinado) }),
    consultarDps: (id) => chamar('GET', `/dps/${id}`),
    consultarNfse: (chave) => chamar('GET', `/nfse/${chave}`),
  }
}

const ok = (r) => r.status >= 200 && r.status < 300

module.exports = { URLS, ErroRede, criarCliente, comprimir, descomprimir, ok }
