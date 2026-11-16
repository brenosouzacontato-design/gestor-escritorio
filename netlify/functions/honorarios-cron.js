// netlify/functions/honorarios-cron.js
//
// Scheduled Function (ver netlify.toml, roda uma vez por dia). Varre a
// tabela "honorarios" por cobranças pendentes já vencidas (vencimento <=
// hoje) que ainda não tiveram lembrete enviado e coloca a cobrança na
// Central de Mensagens (mensagens_fila), AGUARDANDO APROVAÇÃO — não manda
// mais direto pro cliente. Depois de aprovada na tela Mensagens, sai pelo
// WhatsApp (lib/filaMensagens.js) e só então lembrete_enviado_em é marcado.
//
// Cada honorário entra na fila uma vez (mesmo que o cron rode todo dia e a
// cobrança continue pendente); descartada na tela, não volta.
//
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { enfileirarCobrancasHonorario } = require('./lib/filaMensagens')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async () => {
  try {
    const r = await enfileirarCobrancasHonorario(supabase)
    return { statusCode: 200, body: JSON.stringify(r) }
  } catch (e) {
    console.error('Cobranças de honorário não entraram na Central de Mensagens:', e.message)
    return { statusCode: 500, body: e.message }
  }
}
