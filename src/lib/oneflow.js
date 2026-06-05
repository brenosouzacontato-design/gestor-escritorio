const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const PROXY_URL = window.location.origin + '/.netlify/functions/oneflow-proxy'
async function proxyFetch(url, opts) {
  opts = opts || {}
  const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url, method: opts.method || 'GET', headers: opts.headers || {} }) })
  if (!res.ok) throw new Error('Proxy error ' + res.status)
  return res.json()
}
export async function getUserToken(l, s) { return proxyFetch(OMIE_BASE + '/users/login/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Body': JSON.stringify({ login: l, password: s }) } }) }
export async function listarApps(t) { return proxyFetch(OMIE_BASE + '/apps/', { headers: { Authorization: 'Bearer ' + t } }) }
export async function getAppToken(h, t) { return proxyFetch(OMIE_BASE + '/apps/' + h + '/token/', { headers: { Authorization: 'Bearer ' + t } }) }
export async function autenticarEscritorioCompleto(userToken) {
  const apps = await listarApps(userToken)
  const lista = Array.isArray(apps) ? apps : (apps.apps || apps.results || [])
  const escritorioApp = lista[0]
  if (!escritorioApp) throw new Error('Nenhum app encontrado')
  const r1 = await getAppToken(escritorioApp.app_hash, userToken)
  const escritorioToken = r1.token
  const appsEmpresas = await proxyFetch(OMIE_BASE + '/apps/', { headers: { Authorization: 'Bearer ' + escritorioToken } })
  const empresas = Array.isArray(appsEmpresas) ? appsEmpresas : (appsEmpresas.apps || appsEmpresas.results || [])
  const result = await Promise.allSettled(empresas.filter(function(e) { return e.app_hash !== escritorioApp.app_hash }).map(async function(emp) {
    try {
      const tk = await getAppToken(emp.app_hash, userToken)
      return Object.assign({}, emp, { nome: emp.razao_social || emp.company_name || emp.nome || emp.name || emp.app_hash, cnpj: emp.cnpj || emp.document || '', token: tk.token, refresh_token: tk.refresh_token })
    } catch(e) { return Object.assign({}, emp, { nome: emp.razao_social || emp.company_name || emp.nome || emp.app_hash, cnpj: emp.cnpj || '', token: null }) }
  }))
  return { escritorioToken: escritorioToken, escritorioHash: escritorioApp.app_hash, empresas: result.map(function(x) { return x.value || {} }) }
}
export async function getFolhaStatus(t, c) { try { return await proxyFetch('https://rest.oneflow.com.br/api/oneflow/folha/status?competencia=' + c, { headers: { Authorization: 'Bearer ' + t } }) } catch(e) { return { status: 'aberto' } } }
export async function getFiscalStatus(t, c) { try { return await proxyFetch('https://rest.oneflow.com.br/api/oneflow/fiscal/status?competencia=' + c, { headers: { Authorization: 'Bearer ' + t } }) } catch(e) { return { status: 'aberto' } } }
export function tokenExpirado(e) { return !e || new Date(e) <= new Date(Date.now() + 300000) }
export function competenciaAtual() { const d = new Date(); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }
export function competenciaAnterior() { const d = new Date(); d.setMonth(d.getMonth()-1); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }