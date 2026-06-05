const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const PROXY_URL = window.location.origin + '/.netlify/functions/oneflow-proxy'
async function proxyFetch(url, options) {
  options = options || {}
  const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined }) })
  if (!res.ok) throw new Error('Proxy error ' + res.status)
  return res.json()
}
export async function getUserToken(l, s) { return proxyFetch(OMIE_BASE + '/users/login/', { method: 'POST', body: JSON.stringify({ login: l, password: s }) }) }
export async function listarApps(t) { return proxyFetch(OMIE_BASE + '/apps/', { headers: { Authorization: 'Bearer ' + t } }) }
export async function getAppToken(h, t) { return proxyFetch(OMIE_BASE + '/apps/' + h + '/token/', { headers: { Authorization: 'Bearer ' + t } }) }
export async function autenticarEscritorioCompleto(userToken) {
  const apps = await listarApps(userToken)
  const lista = Array.isArray(apps) ? apps : (apps.apps || apps.results || [])
  const escritorioApp = lista[0]
  if (!escritorioApp) throw new Error('Nenhum app encontrado')
  const r1 = await getAppToken(escritorioApp.app_hash, userToken)
  const escritorioToken = r1.token
  let empresas = []
  let pagina = 1
  while (true) {
    const r = await proxyFetch(OMIE_BASE + '/apps/' + escritorioApp.app_hash + '/companies/?page=' + pagina + '&page_size=50', { headers: { Authorization: 'Bearer ' + userToken } })
    const lista2 = Array.isArray(r) ? r : (r.results || r.companies || r.empresas || [])
    if (!lista2.length) break
    empresas = empresas.concat(lista2)
    if (empresas.length >= (r.count || lista2.length) || lista2.length < 50) break
    pagina++
  }
  const result = await Promise.allSettled(empresas.map(async function(emp) {
    try {
      const h = emp.app_hash || emp.hash || emp.id
      const tk = await getAppToken(h, userToken)
      return Object.assign({}, emp, { app_hash: h, nome: emp.razao_social || emp.company_name || emp.nome || emp.name || h, cnpj: emp.cnpj || emp.document || '', token: tk.token, refresh_token: tk.refresh_token })
    } catch(e) { return Object.assign({}, emp, { nome: emp.razao_social || emp.company_name || emp.nome || '', cnpj: emp.cnpj || '', token: null }) }
  }))
  return { escritorioToken: escritorioToken, escritorioHash: escritorioApp.app_hash, empresas: result.map(function(x) { return x.value || {} }) }
}
export async function getFolhaStatus(t, c) { try { return await proxyFetch('https://rest.oneflow.com.br/api/oneflow/folha/status?competencia=' + c, { headers: { Authorization: 'Bearer ' + t } }) } catch(e) { return { status: 'aberto' } } }
export async function getFiscalStatus(t, c) { try { return await proxyFetch('https://rest.oneflow.com.br/api/oneflow/fiscal/status?competencia=' + c, { headers: { Authorization: 'Bearer ' + t } }) } catch(e) { return { status: 'aberto' } } }
export function tokenExpirado(e) { return !e || new Date(e) <= new Date(Date.now() + 300000) }
export function competenciaAtual() { const d = new Date(); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }
export function competenciaAnterior() { const d = new Date(); d.setMonth(d.getMonth()-1); return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear() }