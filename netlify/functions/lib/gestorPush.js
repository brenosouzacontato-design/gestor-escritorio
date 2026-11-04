// netlify/functions/lib/gestorPush.js
//
// Manda notificação push pros aparelhos da equipe do escritório que ativaram
// os avisos (tabela gestor_push_assinaturas — supabase-schema-gestor-push.sql).
// Usado pelo lembretes-cron.js. Sem as chaves VAPID ou sem a tabela criada,
// só registra e segue (o WhatsApp continua indo).

const webpush = require('web-push')

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@gestor-escritorio.app'

function pushConfigurado() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

// Texto da notificação de um lembrete (obrigação ou tarefa)
function notificacaoLembrete(l) {
  const item = l.obrigacoes || l.tarefas
  const titulo = item?.titulo || item?.tipo || 'Item'
  const cliente = item?.clientes?.nome
  const partes = [titulo, cliente, l.mensagem].filter(Boolean)
  const url = l.tarefa_id ? `/?tela=tarefas&tarefa=${l.tarefa_id}` : '/?tela=hoje'
  return { titulo: '🔔 Lembrete', mensagem: partes.join(' · ').slice(0, 300), url, tag: `lembrete-${l.id}` }
}

// Envia { titulo, mensagem, url, tag } pra todas as assinaturas do escritório.
// Devolve quantas foram entregues. Apaga as que o navegador já invalidou.
// `endpoint` limita a um aparelho só (teste).
async function enviarPushEscritorio(supabase, notificacao, { endpoint } = {}) {
  if (!pushConfigurado()) return 0
  let q = supabase.from('gestor_push_assinaturas').select('id, endpoint, p256dh, auth')
  if (endpoint) q = q.eq('endpoint', endpoint)
  const { data: assinaturas, error } = await q
  if (error) {
    console.error('Avisos no aparelho indisponíveis:', error.message)
    return 0
  }
  if (!assinaturas?.length) return 0

  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
  const payload = JSON.stringify(notificacao)
  const resultados = await Promise.all(assinaturas.map(async (a) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, { TTL: 60 * 60 * 12 })
      return { id: a.id, ok: true }
    } catch (e) {
      return { id: a.id, ok: false, expirada: e.statusCode === 404 || e.statusCode === 410, erro: e.message }
    }
  }))
  const expiradas = resultados.filter((r) => r.expirada).map((r) => r.id)
  if (expiradas.length) await supabase.from('gestor_push_assinaturas').delete().in('id', expiradas)
  const falhas = resultados.filter((r) => !r.ok && !r.expirada)
  if (falhas.length) console.error('gestor push falhas:', falhas.map((f) => f.erro).join(' | '))
  return resultados.filter((r) => r.ok).length
}

module.exports = { pushConfigurado, notificacaoLembrete, enviarPushEscritorio }
