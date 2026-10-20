import { supabase, tokenPainelAtivo, rpcAusente } from './supabase'

// Chave que vai nos links públicos (?painel=, ?share=, ?identificar=):
// o token do painel do cliente (clientes.painel_token — ver
// docs/seguranca-rls.md). Enquanto o script supabase-rls-01-preparacao.sql não
// rodou a coluna não existe e o link continua saindo com o id, como antes.
export function chavePainel(cliente) {
  return cliente?.painel_token || cliente?.id
}

// Mesmo que chavePainel, a partir só do id. Dentro de uma página pública o
// token já é o da própria página.
export async function chavePainelPorId(clienteId) {
  const doPainel = tokenPainelAtivo()
  if (doPainel) return doPainel
  // select('*') e não 'painel_token': antes do script a coluna não existe e o
  // select dela daria erro
  const { data } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
  return chavePainel(data) || clienteId
}

export function urlPublica(params) {
  const busca = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  return `${window.location.origin}${window.location.pathname}?${busca.toString()}`
}

// Troca o token do cliente: todos os links públicos já enviados param de
// funcionar. Devolve o token novo.
export async function girarTokenPainel(clienteId) {
  const { data, error } = await supabase.rpc('girar_painel_token', { p_cliente_id: clienteId })
  if (rpcAusente(error)) throw new Error('O banco ainda não tem o token do painel (falta rodar supabase-rls-01-preparacao.sql).')
  if (error) throw error
  return data
}
