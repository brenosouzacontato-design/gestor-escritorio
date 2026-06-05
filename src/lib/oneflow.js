/**
 * OneFlow API Service
 * Gerencia autenticação em camadas: usuário → escritório → empresa
 * Token de usuário expira em 24h — renovação automática incluída
 */

const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const ONEFLOW_BASE = 'https://rest.oneflow.com.br/api/oneflow'

// ── Usuário ──────────────────────────────────────────────────────────────────

export async function getUserToken(login, senha) {
  const res = await fetch(`${OMIE_BASE}/users/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: senha }),
  })
  if (!res.ok) throw new Error(`Login falhou: ${res.status}`)
  return res.json() // { token, refresh_token }
}

export async function refreshUserToken(token, refresh_token) {
  const res = await fetch(`${OMIE_BASE}/users/refresh-token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, refresh_token }),
  })
  if (!res.ok) throw new Error(`Renovação falhou: ${res.status}`)
  return res.json() // { token, refresh_token }
}

// ── Aplicativos / Escritório ─────────────────────────────────────────────────

export async function listarApps(userToken) {
  const res = await fetch(`${OMIE_BASE}/apps/`, {
    headers: { Authorization: `Bearer ${userToken}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Erro ao listar apps: ${res.status}`)
  return res.json()
}

export async function getAppToken(appHash, userToken) {
  const res = await fetch(`${OMIE_BASE}/apps/${appHash}/token/`, {
    headers: { Authorization: `Bearer ${userToken}` },
  })
  if (!res.ok) throw new Error(`Erro ao obter token do app: ${res.status}`)
  return res.json() // { token, refresh_token }
}

export async function refreshAppToken(appHash, token, refresh_token) {
  const res = await fetch(`${OMIE_BASE}/apps/${appHash}/refresh-token`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token, refresh_token }),
  })
  if (!res.ok) throw new Error(`Renovação de app falhou: ${res.status}`)
  return res.json()
}

// ── Empresas ─────────────────────────────────────────────────────────────────

export async function listarEmpresas(escritorioToken, pagina = 1) {
  const res = await fetch(
    `${ONEFLOW_BASE}/escritorio/empresas/listar?pagina=${pagina}`,
    { headers: { Authorization: `Bearer ${escritorioToken}` } }
  )
  if (!res.ok) throw new Error(`Erro ao listar empresas: ${res.status}`)
  return res.json()
}

export async function getEmpresaToken(appHash, userToken) {
  return getAppToken(appHash, userToken)
}

// ── Fechamentos ───────────────────────────────────────────────────────────────

export async function getFechamentosEmpresa(empresaToken, competencia) {
  // Endpoint de competências/fechamentos — ajustar conforme Swagger do OneFlow
  const res = await fetch(
    `${ONEFLOW_BASE}/empresa/competencias?competencia=${competencia}`,
    { headers: { Authorization: `Bearer ${empresaToken}` } }
  )
  if (!res.ok) throw new Error(`Erro ao buscar fechamentos: ${res.status}`)
  return res.json()
}

export async function getFolhaStatus(empresaToken, competencia) {
  const res = await fetch(
    `${ONEFLOW_BASE}/folha/status?competencia=${competencia}`,
    { headers: { Authorization: `Bearer ${empresaToken}` } }
  )
  if (!res.ok) return { status: 'erro' }
  return res.json()
}

export async function getFiscalStatus(empresaToken, competencia) {
  const res = await fetch(
    `${ONEFLOW_BASE}/fiscal/status?competencia=${competencia}`,
    { headers: { Authorization: `Bearer ${empresaToken}` } }
  )
  if (!res.ok) return { status: 'erro' }
  return res.json()
}

// ── Orquestrador principal ────────────────────────────────────────────────────

/**
 * Executa o fluxo completo de autenticação e retorna tokens por empresa
 * Resultado: { escritorioToken, empresas: [{ hash, nome, cnpj, token }] }
 */
export async function autenticarEscritorioCompleto(userToken) {
  // 1. Listar apps e achar o OneFlow
  const apps = await listarApps(userToken)
  const escritorioApp = apps.find?.(a => a.app_type === 'ONEFLOW') || apps[0]
  if (!escritorioApp) throw new Error('Nenhum app OneFlow encontrado')

  // 2. Token do escritório
  const { token: escritorioToken } = await getAppToken(escritorioApp.app_hash, userToken)

  // 3. Listar empresas
  const dadosEmpresas = await listarEmpresas(escritorioToken)
  const lista = dadosEmpresas.empresas || dadosEmpresas || []

  // 4. Token por empresa
  const empresasComToken = await Promise.allSettled(
    lista.map(async empresa => {
      try {
        const { token, refresh_token } = await getEmpresaToken(empresa.app_hash, userToken)
        return { ...empresa, token, refresh_token }
      } catch {
        return { ...empresa, token: null, refresh_token: null }
      }
    })
  )

  return {
    escritorioToken,
    escritorioHash: escritorioApp.app_hash,
    empresas: empresasComToken.map(r => r.value || r.reason),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function tokenExpirado(expiresAt) {
  if (!expiresAt) return true
  return new Date(expiresAt) <= new Date(Date.now() + 5 * 60 * 1000) // 5min de margem
}

export function competenciaAtual() {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function competenciaAnterior() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
