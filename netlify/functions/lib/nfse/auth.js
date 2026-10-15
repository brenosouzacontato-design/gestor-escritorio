// netlify/functions/lib/nfse/auth.js
//
// Toda function de NFS-e exige o usuário logado no gestor. O navegador manda o token da sessão
// do Supabase (Authorization: Bearer ...) e aqui ele é conferido no próprio Supabase Auth.
// Opcional: NFSE_EMAILS_PERMITIDOS="voce@escritorio.com,outro@..." restringe a quem pode emitir.
//
// Uso:
//   const usuario = await exigirUsuario(event)   // lança ErroHttp(401/403)

const { createClient } = require('@supabase/supabase-js')

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem)
    this.status = status
  }
}

let _supabase = null
function supabaseServico() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new ErroHttp(500, 'SUPABASE_URL/SUPABASE_SERVICE_KEY não configuradas no Netlify')
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _supabase
}

function emailsPermitidos() {
  return (process.env.NFSE_EMAILS_PERMITIDOS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

async function exigirUsuario(event, { supabase = null } = {}) {
  const cab = (event.headers && (event.headers.authorization || event.headers.Authorization)) || ''
  const token = cab.startsWith('Bearer ') ? cab.slice(7).trim() : ''
  if (!token) throw new ErroHttp(401, 'Faça login no gestor para usar a emissão de NFS-e')
  const { data, error } = await (supabase || supabaseServico()).auth.getUser(token)
  if (error || !data || !data.user) throw new ErroHttp(401, 'Sessão expirada. Entre de novo no gestor.')
  const permitidos = emailsPermitidos()
  if (permitidos.length && !permitidos.includes((data.user.email || '').toLowerCase())) {
    throw new ErroHttp(403, 'Seu usuário não tem permissão para emitir NFS-e')
  }
  return data.user
}

// Resposta padronizada das functions de NFS-e (JSON, erro em português).
function responder(fn) {
  return async (event, context) => {
    try {
      const corpo = await fn(event, context)
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
    } catch (e) {
      const status = e instanceof ErroHttp ? e.status : 500
      if (status === 500) console.error('[nfse]', e)
      return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ erro: e.message }) }
    }
  }
}

module.exports = { ErroHttp, exigirUsuario, responder, supabaseServico }
