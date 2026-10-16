const { exigirEscritorio } = require('./lib/autenticacao')

// Só repassa pra esses hosts — comparação exata do hostname (um startsWith na
// URL deixava passar "https://app.omie.com.br.qualquercoisa.com").
const HOSTS_PERMITIDOS = ['app.omie.com.br', 'rest.oneflow.com.br']

function urlPermitida(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && HOSTS_PERMITIDOS.includes(u.hostname)
  } catch (e) {
    return false
  }
}

exports.handler = async function(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" }
  // proxy pro OneFlow/Omie é só do escritório logado (ver lib/autenticacao.js)
  const negado = await exigirEscritorio(event, 'oneflow-proxy', { headersExtras: CORS })
  if (negado) return negado
  try {
    const { url, method, authorization, bodyData } = JSON.parse(event.body)
    if (!urlPermitida(url)) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "URL nao permitida" }) }
    const headers = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 (GestorEscritorio)" }
    if (authorization) headers["Authorization"] = "Bearer " + authorization
    const fetchOpts = { method: method || "GET", headers: headers }
    if (bodyData) fetchOpts.body = JSON.stringify(bodyData)
    const res = await fetch(url, fetchOpts)
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch(e) { data = { error: "Invalid JSON", raw: text.slice(0,200) } }
    return { statusCode: res.status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) }
  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) }
  }
}
