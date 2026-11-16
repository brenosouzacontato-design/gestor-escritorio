// netlify/functions/mensagens-cron.js
//
// Scheduled Function (netlify.toml, a cada 5 minutos): manda as mensagens da
// Central de Mensagens que já foram APROVADAS e cujo horário agendado chegou
// (lib/filaMensagens.js). Mensagem aguardando aprovação nunca sai daqui.

const { createClient } = require('@supabase/supabase-js')
const { enviarFila } = require('./lib/filaMensagens')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

exports.handler = async () => {
  try {
    const r = await enviarFila(supabase)
    return { statusCode: 200, body: JSON.stringify(r) }
  } catch (e) {
    console.error('Envio da fila de mensagens falhou:', e.message)
    return { statusCode: 500, body: e.message }
  }
}
