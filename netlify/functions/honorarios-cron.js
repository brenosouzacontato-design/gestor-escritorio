// netlify/functions/honorarios-cron.js
//
// Scheduled Function (ver netlify.toml, roda uma vez por dia). Varre a
// tabela "honorarios" por cobranças pendentes já vencidas (vencimento <=
// hoje) que ainda não tiveram lembrete enviado, e manda um WhatsApp DIRETO
// pro celular do cliente (lib/honorariosLembrete.js) — diferente de
// lembretes-cron.js, que só manda pro grupo interno do escritório.
//
// lembrete_enviado_em garante que cada cobrança só dispara o lembrete uma
// vez, mesmo que o cron rode todo dia e a cobrança continue pendente.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, EVOLUTION_API_URL, EVOLUTION_API_KEY,
// EVOLUTION_INSTANCE — todas já configuradas (mesmas usadas por
// lembretes-cron.js/whatsapp-webhook.js). Não precisa de WHATSAPP_GROUP_ID
// (o destino aqui é o telefone do próprio cliente, não o grupo).

const { createClient } = require('@supabase/supabase-js')
const { enviarLembreteHonorario } = require('./lib/honorariosLembrete')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async () => {
  const hoje = new Date().toISOString().slice(0, 10)

  const { data: honorarios, error } = await supabase
    .from('honorarios')
    .select('id')
    .eq('status', 'pendente')
    .is('lembrete_enviado_em', null)
    .lte('vencimento', hoje)

  if (error) {
    console.error('Erro ao buscar honorários pendentes:', error.message)
    return { statusCode: 500, body: error.message }
  }

  let enviados = 0
  const pulados = []
  for (const h of honorarios || []) {
    try {
      const resultado = await enviarLembreteHonorario(supabase, h.id)
      if (resultado.enviado) enviados++
      else pulados.push({ id: h.id, motivo: resultado.motivo })
    } catch (e) {
      console.error(`Erro ao enviar lembrete do honorário ${h.id}:`, e.message)
      pulados.push({ id: h.id, motivo: e.message })
    }
  }

  return { statusCode: 200, body: JSON.stringify({ enviados, pulados }) }
}
