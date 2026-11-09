// lib/linkCurtoPainel.js
//
// Link curto do painel do cliente: <site>/p/<codigo> (netlify.toml manda pra
// link-curto.js, que redireciona pro ?painel=<token>). Um código por
// empresa, guardado em painel_links_curtos (supabase-schema-aviso-guia-painel.sql).

const crypto = require('crypto')

// sem 0/O/1/l/I pra quem precisar digitar o link
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function gerarCodigo(tamanho = 7) {
  const bytes = crypto.randomBytes(tamanho)
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}

// Endereço público do gestor: PAINEL_URL_BASE (se configurada) ou a URL
// principal do site que o próprio Netlify injeta (URL).
function urlBase() {
  return (process.env.PAINEL_URL_BASE || process.env.URL || '').replace(/\/+$/, '')
}

// Devolve o link curto da empresa, criando na primeira vez. `cliente` precisa
// de { id, painel_token }.
async function linkCurtoPainel(supabase, cliente) {
  const base = urlBase()
  if (!base) throw new Error('Endereço do site desconhecido (configure PAINEL_URL_BASE no Netlify).')
  const destino = `${base}/?painel=${encodeURIComponent(cliente.painel_token || cliente.id)}`

  const { data: atual, error } = await supabase.from('painel_links_curtos')
    .select('codigo, url').eq('cliente_id', cliente.id).maybeSingle()
  if (error) throw error
  if (atual) {
    if (atual.url !== destino) {
      const { error: errUpd } = await supabase.from('painel_links_curtos').update({ url: destino }).eq('codigo', atual.codigo)
      if (errUpd) throw errUpd
    }
    return `${base}/p/${atual.codigo}`
  }

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const codigo = gerarCodigo()
    const { error: errIns } = await supabase.from('painel_links_curtos').insert({ codigo, cliente_id: cliente.id, url: destino })
    if (!errIns) return `${base}/p/${codigo}`
    if (errIns.code !== '23505') throw errIns
    // 23505 no cliente_id = outra execução criou ao mesmo tempo: usa o dela
    const { data: outro } = await supabase.from('painel_links_curtos').select('codigo').eq('cliente_id', cliente.id).maybeSingle()
    if (outro) return `${base}/p/${outro.codigo}`
  }
  throw new Error('Não foi possível gerar o link curto do painel.')
}

module.exports = { linkCurtoPainel, gerarCodigo }
