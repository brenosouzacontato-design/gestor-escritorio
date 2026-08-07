// netlify/functions/lembretes-cron.js
//
// Scheduled Function (ver netlify.toml, roda a cada 15 minutos). Varre a
// tabela "lembretes" por lembretes pendentes (enviado=false) cuja data_hora
// já passou, manda um WhatsApp pro grupo do escritório
// (netlify/functions/lib/whatsapp.js) e marca como enviado.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, WHATSAPP_GROUP_ID, EVOLUTION_API_URL,
// EVOLUTION_API_KEY, EVOLUTION_INSTANCE — todas já configuradas (mesmas
// usadas por whatsapp-webhook.js).

const { createClient } = require('@supabase/supabase-js')
const { enviarMensagem } = require('./lib/whatsapp')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID

exports.handler = async () => {
  if (!GRUPO_ID) {
    console.error('WHATSAPP_GROUP_ID não configurada — não dá pra enviar lembretes.')
    return { statusCode: 200, body: 'no group id' }
  }

  const { data: lembretes, error } = await supabase
    .from('lembretes')
    .select(`
      id, mensagem,
      obrigacoes(titulo, tipo, clientes(nome)),
      tarefas(titulo, clientes(nome))
    `)
    .eq('enviado', false)
    .lte('data_hora', new Date().toISOString())

  if (error) {
    console.error('Erro ao buscar lembretes:', error.message)
    return { statusCode: 500, body: error.message }
  }

  for (const l of lembretes || []) {
    const item = l.obrigacoes || l.tarefas
    const titulo = item?.titulo || item?.tipo || 'Item'
    const cliente = item?.clientes?.nome
    const texto = `🔔 *Lembrete*\n${titulo}${cliente ? `\n👤 ${cliente}` : ''}${l.mensagem ? `\n${l.mensagem}` : ''}`

    await enviarMensagem(GRUPO_ID, texto)
    await supabase.from('lembretes').update({ enviado: true, enviado_em: new Date().toISOString() }).eq('id', l.id)
  }

  return { statusCode: 200, body: JSON.stringify({ enviados: (lembretes || []).length }) }
}
