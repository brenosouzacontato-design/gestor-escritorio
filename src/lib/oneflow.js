const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oneflow-proxy`
async function proxyFetch(url, options = {}) {
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}` }, body: JSON.stringify({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined }) })
  if (!res.ok) throw new Error(`Proxy error ${res.status}`)
  return res.json()
}
export async function getUserToken(l, s) { return proxyFetch(`${OMIE_BASE}/users/login/`, { method: 'POST', body: JSON.stringify({ login: l, password: s }) }) }
export async function listarApps(t) { return proxyFetch(`${OMIE_BASE}/apps/`, { headers: { Authorization: `Bearer ${t}` } }) }
export async function getAppToken(h, t) { return proxyFetch(`${OMIE_BASE}/apps/${h}/token/`, { headers: { Authorization: `Bearer ${t}` } }) }
export async function listarEmpresas(t) { return proxyFetch(`${OMIE_BASE}/apps/`, { headers: { Authorization: `Bearer ${t}` } }) }
export async function getFolhaStatus(t, c) { try { return await proxyFetch(`https://rest.oneflow.com.br/api/oneflow/folha/status?competencia=${c}`, { headers: { Authorization: `Bearer ${t}` } }) } catch { return { status: 'aberto' } } }
export async function getFiscalStatus(t, c) { try { return await proxyFetch(`https://rest.oneflow.com.br/api/oneflow/fiscal/status?competencia=${c}`, { headers: { Authorization: `Bearer ${t}` } }) } catch { return { status: 'aberto' } } }
export async function autenticarEscritorioCompleto(userToken) {
  const apps = await listarApps(userToken)
  const lista = Array.isArray(apps) ? apps : (apps.apps || apps.results || [])
  const escritorioApp = lista.find(a => a.app_type === 'ONEFLOW') || lista[0]
  if (!escritorioApp) throw new Error('Nenhum app OneFlow encontrado')
  const { token: escritorioToken } = await getAppToken(escritorioApp.app_hash, userToken)
  const dadosEmpresas = await listarEmpresas(escritorioToken)
  const empresas = dadosEmpresas.empresas || dadosEmpresas.results || (Array.isArray(dadosEmpresas) ? dadosEmpresas : [])
  const r = await Promise.allSettled(empresas.map(async emp => { try { const { token, refresh_token } = await getAppToken(emp.app_hash, userToken); return { ...emp, token, refresh_token } } catch { return { ...emp, token: null } } }))
  return { escritorioToken, escritorioHash: escritorioApp.app_hash, empresas: r.map(x => x.value || {}) }
}
export function tokenExpirado(e) { return !e || new Date(e) <= new Date(Date.now() + 5*60*1000) }
export function competenciaAtual() { const d = new Date(); return `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` }
export function competenciaAnterior() { const d = new Date(); d.setMonth(d.getMonth()-1); return `${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` }
