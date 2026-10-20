// netlify/functions/painel-push.js
//
// Notificações push do painel do cliente (Web Push).
//   GET  → { chavePublica } pro navegador do cliente criar a assinatura
//          ("Ativar notificações" em PainelCompartilhadoPage.jsx).
//   POST { clienteId, titulo, mensagem, url } → manda a notificação pra todos
//          os aparelhos que aquele cliente ativou (painel_push_assinaturas —
//          supabase-schema-painel-push.sql) e apaga as assinaturas que o
//          navegador já invalidou (cliente desinstalou/bloqueou).
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (par gerado uma
// vez com "npx web-push generate-vapid-keys") e, opcional, VAPID_SUBJECT
// ("mailto:..." de contato exigido pelo protocolo).

const { createClient } = require('@supabase/supabase-js')
const webpush = require('web-push')
const { exigirEscritorio } = require('./lib/autenticacao')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@gestor-escritorio.app'

exports.handler = async (event) => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return resposta(503, { error: 'Notificações ainda não configuradas: faltam VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY nas variáveis de ambiente do Netlify.' })
  }
  if (event.httpMethod === 'GET') {
    return resposta(200, { chavePublica: VAPID_PUBLIC })
  }
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido.' })
  }

  // GET (chave pública) fica aberto pro cliente; mandar notificação é só do escritório
  const negado = await exigirEscritorio(event, 'painel-push')
  if (negado) return negado

  let clienteId, titulo, mensagem, url
  try {
    const body = JSON.parse(event.body)
    clienteId = body.clienteId
    titulo = String(body.titulo || '').slice(0, 80)
    mensagem = String(body.mensagem || '').slice(0, 300)
    url = body.url ? String(body.url).slice(0, 500) : null
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { clienteId, titulo, mensagem }.' })
  }
  if (!clienteId || !mensagem.trim()) {
    return resposta(400, { error: 'clienteId e mensagem são obrigatórios.' })
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
    const { data: assinaturas, error } = await supabase
      .from('painel_push_assinaturas').select('id, endpoint, p256dh, auth').eq('cliente_id', clienteId)
    if (error) throw error
    if (!assinaturas || assinaturas.length === 0) {
      return resposta(200, { enviadas: 0, total: 0 })
    }

    const payload = JSON.stringify({ titulo: titulo || 'Recado do escritório', mensagem, url })
    const resultados = await Promise.all(assinaturas.map(async (a) => {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, { TTL: 60 * 60 * 24 })
        return { id: a.id, ok: true }
      } catch (e) {
        // 404/410 = o navegador descartou essa assinatura — não adianta tentar de novo
        return { id: a.id, ok: false, expirada: e.statusCode === 404 || e.statusCode === 410, erro: e.message }
      }
    }))

    const expiradas = resultados.filter((r) => r.expirada).map((r) => r.id)
    if (expiradas.length > 0) await supabase.from('painel_push_assinaturas').delete().in('id', expiradas)
    const falhas = resultados.filter((r) => !r.ok && !r.expirada)
    if (falhas.length > 0) console.error('painel-push falhas:', falhas.map((f) => f.erro).join(' | '))

    return resposta(200, { enviadas: resultados.filter((r) => r.ok).length, total: assinaturas.length, expiradas: expiradas.length })
  } catch (e) {
    console.error('painel-push:', e.message)
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
