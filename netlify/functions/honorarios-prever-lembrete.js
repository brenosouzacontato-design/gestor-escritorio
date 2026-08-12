// netlify/functions/honorarios-prever-lembrete.js
//
// Handler HTTP usado pela tela de Honorários pra mostrar a prévia editável
// do lembrete ANTES de mandar — só monta o texto (lib/honorariosLembrete.js
// montarLembreteHonorario), não envia nada nem grava nada.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { montarLembreteHonorario } = require('./lib/honorariosLembrete')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' })
  }

  let honorarioId
  try {
    const body = JSON.parse(event.body)
    honorarioId = body.honorarioId
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { honorarioId }.' })
  }
  if (!honorarioId) {
    return resposta(400, { error: 'honorarioId não informado.' })
  }

  try {
    const { numero, texto, motivoBloqueio } = await montarLembreteHonorario(supabase, honorarioId)
    return resposta(200, { texto, numero, motivoBloqueio: motivoBloqueio || null })
  } catch (e) {
    return resposta(500, { error: e.message })
  }
}

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
