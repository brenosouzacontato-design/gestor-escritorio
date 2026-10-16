import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

const clienteEscritorio = createClient(supabaseUrl, supabaseKey)

// `let` de propósito: as páginas públicas (painel do cliente e links
// compartilhados) chamam ativarModoPainel() e passam a usar um cliente que
// manda o token do painel no cabeçalho x-painel-token — é isso que as
// policies de RLS conferem (ver docs/seguranca-rls.md). Como import de ES
// module é uma ligação viva, quem fez `import { supabase }` passa a enxergar o
// cliente novo sem mudar nada nas consultas.
export let supabase = clienteEscritorio

let tokenPainel = null

export function ativarModoPainel(token) {
  if (!token || token === tokenPainel) return
  tokenPainel = token
  supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { 'x-painel-token': token } },
    // o cliente do painel nunca loga — e não pode pisar na sessão do escritório
    // se alguém do escritório abrir o link no mesmo navegador
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-painel' },
  })
}

// Token do painel em uso nesta página (null dentro do app do escritório).
export function tokenPainelAtivo() {
  return tokenPainel
}

// Cabeçalhos pras chamadas às Netlify Functions: no painel vai o token do
// cliente; dentro do app vai o login do escritório (JWT do Supabase Auth).
export async function cabecalhosFunctions(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra }
  if (tokenPainel) {
    headers['x-painel-token'] = tokenPainel
    return headers
  }
  const { data } = await clienteEscritorio.auth.getSession()
  const jwt = data?.session?.access_token
  if (jwt) headers.Authorization = `Bearer ${jwt}`
  return headers
}

// RPC que ainda não existe no banco (script supabase-rls-01-preparacao.sql
// não rodado): o chamador cai no caminho antigo.
export function rpcAusente(error) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || ''))
}
