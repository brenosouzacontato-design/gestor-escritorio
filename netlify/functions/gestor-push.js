// netlify/functions/gestor-push.js
//
// Avisos no aparelho pra equipe do escritório (Web Push).
//   GET                                   → { chavePublica }
//   POST { acao: 'assinar', endpoint, p256dh, auth, userAgent }
//   POST { acao: 'remover', endpoint }
//   POST { acao: 'testar', endpoint }     → notificação de teste só pra esse aparelho
// Tudo exige login do escritório. A assinatura fica em
// gestor_push_assinaturas (supabase-schema-gestor-push.sql) e é usada pelo
// lembretes-cron.js pra avisar na hora marcada.

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio, usuarioEscritorio } = require('./lib/autenticacao')
const { pushConfigurado, enviarPushEscritorio } = require('./lib/gestorPush')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async (event) => {
  if (!pushConfigurado()) {
    return resposta(503, { error: 'Avisos no aparelho ainda não configurados: faltam VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no Netlify.' })
  }
  const negado = await exigirEscritorio(event, 'gestor-push')
  if (negado) return negado

  if (event.httpMethod === 'GET') return resposta(200, { chavePublica: process.env.VAPID_PUBLIC_KEY })
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido.' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return resposta(400, { error: 'Body inválido.' }) }

  try {
    if (body.acao === 'assinar') {
      const { endpoint, p256dh, auth } = body
      if (!/^https:\/\//.test(endpoint || '') || !p256dh || !auth) return resposta(400, { error: 'Assinatura inválida.' })
      const usuario = await usuarioEscritorio(event)
      const { error } = await supabase.from('gestor_push_assinaturas').upsert({
        user_id: usuario?.id || null,
        endpoint: String(endpoint).slice(0, 1000),
        p256dh: String(p256dh).slice(0, 200),
        auth: String(auth).slice(0, 100),
        user_agent: String(body.userAgent || '').slice(0, 300),
      }, { onConflict: 'endpoint' })
      if (error) throw error
      return resposta(200, { ok: true })
    }
    if (body.acao === 'remover') {
      const { error } = await supabase.from('gestor_push_assinaturas').delete().eq('endpoint', String(body.endpoint || ''))
      if (error) throw error
      return resposta(200, { ok: true })
    }
    if (body.acao === 'testar') {
      const enviadas = await enviarPushEscritorio(supabase, {
        titulo: '🔔 Avisos ativados', mensagem: 'Os lembretes das tarefas vão chegar assim, na hora marcada.', url: '/?tela=tarefas', tag: 'teste',
      }, { endpoint: String(body.endpoint || '') || '-' })
      return resposta(200, { enviadas })
    }
    return resposta(400, { error: 'Ação desconhecida.' })
  } catch (e) {
    console.error('gestor-push:', e.message)
    return resposta(500, { error: e.message })
  }
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
