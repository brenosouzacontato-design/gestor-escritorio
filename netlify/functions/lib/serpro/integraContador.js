// netlify/functions/lib/serpro/integraContador.js
//
// Cliente da API Integra Contador (SERPRO). Documentação:
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
//
// Autenticação (pt/quick_start): POST https://autenticacao.sapi.serpro.gov.br/authenticate com
//   - TLS mútuo com o certificado e-CNPJ do CONTRATANTE (o mesmo usado na contratação);
//   - Authorization: Basic base64(consumerKey:consumerSecret), Role-Type: TERCEIROS,
//     corpo grant_type=client_credentials (x-www-form-urlencoded).
// Volta { access_token, jwt_token, expires_in }. Cada chamada leva "Authorization: Bearer
// access_token" e "jwt_token: ..."; 401 = token venceu → autentica de novo e repete uma vez.
//
// Pedido: POST {base}/{Apoiar|Consultar|Declarar|Emitir|Monitorar} com contratante, autor do
// pedido, contribuinte e pedidoDados { idSistema, idServico, versaoSistema, dados (JSON em texto) }.
// O escritório é contratante E autor do pedido, então não precisa do Termo de Autorização
// (AUTENTICAPROCURADOR serve quando o autor é outro procurador). Cada contribuinte precisa ter
// dado procuração no e-CAC ao CNPJ do escritório para o serviço.
//
// SERPRO_AMBIENTE=trial usa a demonstração pública (dados simulados, sem certificado nem chave).

const https = require('https')

const URL_AUTH = 'https://autenticacao.sapi.serpro.gov.br/authenticate'
const BASES = {
  producao: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1',
  trial: 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1',
}
// token público da demonstração (pt/cenarios_trial)
const TOKEN_TRIAL = '06aef429-a981-3ec5-a1f8-71d38d86481e'
const OPERACOES = ['Apoiar', 'Consultar', 'Declarar', 'Emitir', 'Monitorar']

class ErroIntegra extends Error {
  constructor(mensagem, { status = null, mensagens = [] } = {}) {
    super(mensagem)
    this.status = status
    this.mensagens = mensagens
  }
}

const digitos = (v) => String(v || '').replace(/\D/g, '')

function parte(doc) {
  const n = digitos(doc)
  if (n.length === 14) return { numero: n, tipo: 2 }
  if (n.length === 11) return { numero: n, tipo: 1 }
  throw new ErroIntegra(`CPF/CNPJ inválido: ${doc || '(vazio)'}`)
}

// Corpo do pedido. `dados`: objeto (vira JSON em texto) ou '' para serviços sem entrada.
function montarPedido({ contratante, autor, contribuinte, idSistema, idServico, versaoSistema, dados }) {
  return {
    contratante: parte(contratante),
    autorPedidoDados: parte(autor || contratante),
    contribuinte: parte(contribuinte),
    pedidoDados: {
      idSistema, idServico, versaoSistema,
      dados: dados === '' || dados == null ? '' : (typeof dados === 'string' ? dados : JSON.stringify(dados)),
    },
  }
}

const textoMensagens = (mensagens) =>
  (Array.isArray(mensagens) ? mensagens : []).map((m) => `${m.codigo ? m.codigo + ' ' : ''}${m.texto || ''}`.trim()).filter(Boolean).join(' | ')

// Resposta do gateway → { status, mensagens, dados (já interpretado) }. Lança ErroIntegra se não for 2xx.
// O "status" pode vir como número ou texto ("200"); "dados" vem como JSON em texto.
function interpretarResposta(httpStatus, corpo) {
  const status = Number((corpo && corpo.status) || httpStatus)
  const mensagens = (corpo && corpo.mensagens) || []
  if (!(status >= 200 && status < 300) || !(httpStatus >= 200 && httpStatus < 300)) {
    const texto = textoMensagens(mensagens) || (corpo && (corpo.message || corpo.error_description || corpo.error)) || ''
    throw new ErroIntegra(`SERPRO respondeu ${status || httpStatus}${texto ? ': ' + texto : ''}`, { status: status || httpStatus, mensagens })
  }
  let dados = corpo.dados
  if (typeof dados === 'string' && dados.trim()) {
    try { dados = JSON.parse(dados) } catch { /* texto puro: devolve como veio */ }
  }
  return { status, mensagens, dados: dados === '' ? null : dados }
}

// Transporte HTTPS padrão: (url, { method, headers, body, tls }) → { status, corpo }
function transporteHttps(timeoutMs) {
  const agentes = new Map()
  return (url, { method = 'POST', headers = {}, body = '', tls = null }) => new Promise((resolve, reject) => {
    let agent
    if (tls) {
      const chave = tls.cert.slice(0, 120)
      if (!agentes.has(chave)) agentes.set(chave, new https.Agent({ key: tls.key, cert: tls.cert, keepAlive: true }))
      agent = agentes.get(chave)
    }
    const req = https.request(url, { method, agent, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const partes = []
      res.on('data', (p) => partes.push(p))
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8')
        let corpo
        try { corpo = texto ? JSON.parse(texto) : {} } catch { corpo = { message: texto.slice(0, 300) } }
        resolve({ status: res.statusCode, corpo })
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })))
    req.on('error', (e) => reject(new ErroIntegra(`Falha ao falar com o SERPRO (${e.code || e.message})`)))
    req.end(body)
  })
}

// ambiente: 'producao' | 'trial'. tls: { key, cert } em PEM (lib/nfse/certificado.lerPfx), só produção.
function criarCliente({ ambiente = 'producao', consumerKey, consumerSecret, tls, contratante, timeoutMs = 25000, transporte = null }) {
  const trial = ambiente === 'trial'
  const enviar = transporte || transporteHttps(timeoutMs)
  if (!trial) {
    if (!consumerKey || !consumerSecret) throw new ErroIntegra('SERPRO_CONSUMER_KEY/SERPRO_CONSUMER_SECRET não configuradas no Netlify')
    if (!tls) throw new ErroIntegra('Certificado do escritório não cadastrado (tela Integra Contador → Configuração)')
  }
  let token = null // { access, jwt, validoAte }

  async function autenticar() {
    if (trial) return { access: TOKEN_TRIAL, jwt: null }
    if (token && token.validoAte > Date.now()) return token
    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
    const r = await enviar(URL_AUTH, {
      method: 'POST', tls, body: 'grant_type=client_credentials',
      headers: { Authorization: `Basic ${basic}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    })
    if (r.status !== 200 || !r.corpo || !r.corpo.access_token) {
      const det = (r.corpo && (r.corpo.error_description || r.corpo.message || r.corpo.error)) || ''
      throw new ErroIntegra(`Autenticação no SERPRO recusada (${r.status})${det ? ': ' + det : ''}. Confira as chaves e o certificado do contratante.`, { status: r.status })
    }
    const vida = Number(r.corpo.expires_in) || 1800
    token = { access: r.corpo.access_token, jwt: r.corpo.jwt_token, validoAte: Date.now() + Math.max(60, vida - 60) * 1000 }
    return token
  }

  // `partes` só na demonstração: cada cenário do trial exige os documentos fictícios dele
  async function chamar(operacao, { contribuinte, idSistema, idServico, versaoSistema, dados, partes = null }) {
    if (!OPERACOES.includes(operacao)) throw new ErroIntegra(`Operação desconhecida: ${operacao}`)
    const p = (trial && partes) || { contratante, contribuinte }
    const corpo = JSON.stringify(montarPedido({ ...p, idSistema, idServico, versaoSistema, dados }))
    for (let tentativa = 1; ; tentativa++) {
      const t = await autenticar()
      const headers = { Authorization: `Bearer ${t.access}`, 'Content-Type': 'application/json', Accept: 'application/json' }
      if (t.jwt) headers.jwt_token = t.jwt
      const r = await enviar(`${BASES[trial ? 'trial' : 'producao']}/${operacao}`, { method: 'POST', tls: trial ? null : tls, headers, body: corpo })
      if (r.status === 401 && !trial && tentativa === 1) { token = null; continue }
      return interpretarResposta(r.status, r.corpo)
    }
  }

  return { autenticar, chamar }
}

// Documentos fictícios que cada cenário da demonstração aceita (pt/cenarios_trial)
const PARTES_TRIAL = {
  SICALC: { contratante: '99999999999999', autor: '99999999999', contribuinte: '99999999999' },
  PGDASD: { contratante: '00000000000100', contribuinte: '00000000000100' },
  padrao: { contratante: '00000000000000', contribuinte: '00000000000000' },
}

module.exports = { PARTES_TRIAL, ErroIntegra, criarCliente, montarPedido, interpretarResposta, textoMensagens, BASES, URL_AUTH }
