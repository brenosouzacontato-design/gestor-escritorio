// netlify/functions/mensagens-enviar.js
//
// Central de Mensagens: logo depois de aprovar na tela Mensagens, manda as
// mensagens aprovadas sem horário marcado (ou com horário já passado).
// Corpo: { ids: [...] }. As agendadas para depois ficam para mensagens-cron.js.
// Só manda o que já está 'aprovada' no banco — a aprovação é feita pela tela.

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio } = require('./lib/autenticacao')
const { enviarFila } = require('./lib/filaMensagens')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' })
  const negado = await exigirEscritorio(event, 'mensagens-enviar')
  if (negado) return negado

  let ids
  try { ids = JSON.parse(event.body || '{}').ids } catch { return resposta(400, { error: 'Body inválido: esperado { ids }.' }) }
  if (!Array.isArray(ids) || !ids.length) return resposta(400, { error: 'Nenhuma mensagem informada.' })

  try {
    return resposta(200, await enviarFila(supabase, { ids: ids.slice(0, 200) }))
  } catch (e) {
    return resposta(500, { error: e.message })
  }
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
