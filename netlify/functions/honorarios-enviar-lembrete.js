// netlify/functions/honorarios-enviar-lembrete.js
//
// Handler HTTP usado pelo botão "Enviar lembrete agora" na tela de
// Honorários (honorariosApi.js) — dispara o mesmo envio do cron
// (lib/honorariosLembrete.js), mas sob demanda, pra uma cobrança
// específica, sem esperar a execução diária.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY,
// EVOLUTION_INSTANCE.

const { createClient } = require('@supabase/supabase-js')
const { enviarLembreteHonorario } = require('./lib/honorariosLembrete')

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
    const resultado = await enviarLembreteHonorario(supabase, honorarioId)
    if (!resultado.enviado) {
      return resposta(422, { error: resultado.motivo })
    }
    return resposta(200, resultado)
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
