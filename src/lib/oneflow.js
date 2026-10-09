const PROXY_URL = window.location.origin + '/.netlify/functions/oneflow-proxy'
const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const ONEFLOW_BASE = 'https://rest.oneflow.com.br/api/oneflow'

async function proxyFetch(url, token, bodyData) {
  const payload = { url: url, method: 'GET' }
  if (token) payload.authorization = token
  if (bodyData) { payload.method = 'POST'; payload.bodyData = bodyData }
  const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (!res.ok) {
    let detalhe = ''
    try {
      const j = await res.json()
      detalhe = j?.details?.message?.message || j?.message || j?.error || j?.raw || ''
    } catch (e) { /* corpo vazio — a Omie devolve 403 sem corpo nenhum */ }
    const err = new Error(mensagemErroOmie(res.status, url, detalhe))
    err.status = res.status
    throw err
  }
  return res.json()
}

// A Omie responde 403 SEM corpo pra qualquer chamada não autenticada (token
// vencido/errado) — e também pro login por senha, que passou a exigir
// reCAPTCHA no portal e não aceita mais login direto pela API. Traduz o
// "Proxy error 403" genérico de antes em algo que diga o que fazer.
function mensagemErroOmie(status, url, detalhe) {
  if (status === 403 || status === 401) {
    if (url.includes('/users/login/')) return 'A Omie recusou o login (403). O portal passou a exigir reCAPTCHA e não aceita mais login pela API — use a aba "Token".'
    return `A Omie recusou o token (${status}) — ele venceu ou é inválido. Gere um novo na aba "Token".`
  }
  return `Omie/OneFlow respondeu ${status}${detalhe ? ': ' + String(detalhe).slice(0, 160) : ''}`
}

// Aceita o token "cru" (eyJ...) ou o JSON inteiro que a página
// app.omie.com.br/api/portal/users/me/token/ mostra ({"token": "...", ...}).
export function extrairTokenColado(texto) {
  const t = (texto || '').trim().replace(/^Bearer\s+/i, '')
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      return { token: j.token || j.access_token || null, refresh_token: j.refresh_token || null }
    } catch (e) { /* cai no regex abaixo */ }
  }
  const m = t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)
  return { token: m ? m[0] : null, refresh_token: null }
}

// Lê o "exp" do próprio JWT (em vez de chutar 23h) — null se não der.
export function expiracaoDoToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.exp ? new Date(payload.exp * 1000).toISOString() : null
  } catch (e) { return null }
}

export async function getUserToken(l, s) { return proxyFetch(OMIE_BASE + '/users/login/', null, { login: l, password: s }) }
export async function listarApps(t) { return proxyFetch(OMIE_BASE + '/apps/', t) }
export async function getAppToken(h, t) { return proxyFetch(OMIE_BASE + '/apps/' + h + '/token/', t) }

export async function refreshUserToken(userToken, appHash) {
  try {
    const r = await getAppToken(appHash, userToken)
    return { token: r.token, refresh_token: r.refresh_token }
  } catch(e) { throw new Error('Falha ao renovar token: ' + e.message) }
}

export async function autenticarEscritorioCompleto(userToken) {
  const apps = await listarApps(userToken)
  const lista = Array.isArray(apps) ? apps : (apps.value || apps.apps || apps.results || [])
  const escritorioApp = lista.find(function(a) { return a.app_type === 'ONEFLOW' }) || lista[0]
  if (!escritorioApp) throw new Error('Nenhum app OneFlow encontrado')
  const r1 = await getAppToken(escritorioApp.app_hash, userToken)
  const escritorioToken = r1.token
  let todas = []
  let pagina = 1
  while (true) {
    const r = await proxyFetch(ONEFLOW_BASE + '/escritorio/empresas/listar?pagina=' + pagina, escritorioToken)
    const empresas = r.result ? r.result.empresas : (r.empresas || [])
    if (!empresas || !empresas.length) break
    todas = todas.concat(empresas)
    const totalPaginas = r.result ? r.result.totalPaginas : 1
    if (pagina >= totalPaginas) break
    pagina++
  }
  const result = await Promise.allSettled(todas.map(async function(emp) {
    try {
      const tk = await getAppToken(emp.apphash, userToken)
      return { app_hash: emp.apphash, nome: emp.razao, cnpj: emp.cnpj, token: tk.token, refresh_token: tk.refresh_token }
    } catch(e) { return { app_hash: emp.apphash, nome: emp.razao, cnpj: emp.cnpj, token: null } }
  }))
  return { escritorioToken: escritorioToken, escritorioHash: escritorioApp.app_hash, empresas: result.map(function(x) { return x.value || {} }) }
}

export async function getFolhaStatus(t, c) { try { return await proxyFetch(ONEFLOW_BASE + '/folha/status?competencia=' + c, t) } catch(e) { return { status: 'aberto' } } }
export async function getFiscalStatus(t, c) { try { return await proxyFetch(ONEFLOW_BASE + '/fiscal/status?competencia=' + c, t) } catch(e) { return { status: 'aberto' } } }
export function tokenExpirado(e) { return !e || new Date(e) <= new Date(Date.now() + 300000) }
export function competenciaAtual() { const d = new Date(); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }
export function competenciaAnterior() { const d = new Date(); d.setMonth(d.getMonth()-1); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }
