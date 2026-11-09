// netlify/functions/link-curto.js
//
// Abre o link curto do painel do cliente: /p/<codigo> (netlify.toml) →
// redireciona pro painel (?painel=<token>) na competência anterior ao mês
// atual — o painel mostra tudo pela data de vencimento, então nessa
// competência aparece o que vence no mês corrente e o que ficou em aberto.
// Códigos em painel_links_curtos (lib/linkCurtoPainel.js).

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const CODIGO = /^[a-zA-Z0-9]{4,20}$/

// competência anterior ao mês atual, no fuso de Brasília ("MM/AAAA")
function competenciaPadrao() {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1))
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
}

exports.handler = async (event) => {
  const codigo = (event.queryStringParameters?.c || event.path.split('/').pop() || '').trim()
  if (!CODIGO.test(codigo)) return naoEncontrado()
  try {
    const { data, error } = await supabase.from('painel_links_curtos').select('url').eq('codigo', codigo).maybeSingle()
    if (error) throw error
    if (!data) return naoEncontrado()
    const url = new URL(data.url)
    if (!url.searchParams.has('competencia')) url.searchParams.set('competencia', competenciaPadrao())
    return { statusCode: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store' }, body: '' }
  } catch (e) {
    console.error('link-curto:', e.message)
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Não foi possível abrir o link agora. Tente de novo em instantes.' }
  }
}

function naoEncontrado() {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">Link inválido ou expirado. Peça um link novo ao escritório.</p>',
  }
}
