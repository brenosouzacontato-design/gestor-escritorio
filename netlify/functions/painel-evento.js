// netlify/functions/painel-evento.js
//
// Chamado pelo link público do painel do cliente (src/pages/painel) toda vez
// que o cliente abre o painel ou baixa um arquivo (guia, declaração,
// relatório): grava o evento em painel_eventos
// (supabase-schema-painel-eventos.sql) e avisa o grupo do escritório no
// WhatsApp (lib/whatsapp.js). As prévias de dentro do app não chamam isso.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, WHATSAPP_GROUP_ID, EVOLUTION_API_URL,
// EVOLUTION_API_KEY, EVOLUTION_INSTANCE — as mesmas de lembretes-cron.js.

const { createClient } = require('@supabase/supabase-js')
const { enviarMensagem } = require('./lib/whatsapp')
const { clienteDoPainel } = require('./lib/autenticacao')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const TIPOS = ['visualizacao', 'download']
// Mesmo evento repetido dentro dessa janela (clique duplo no botão, página
// recarregada em seguida) não gera um segundo aviso.
const JANELA_REPETICAO_MS = 60 * 1000

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' })
  }

  let clienteId, tipo, descricao, competencia
  try {
    const body = JSON.parse(event.body)
    clienteId = body.clienteId
    tipo = body.tipo
    descricao = body.descricao ? String(body.descricao).slice(0, 200) : null
    competencia = body.competencia ? String(body.competencia).slice(0, 7) : null
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { clienteId, tipo }.' })
  }
  if (!TIPOS.includes(tipo)) {
    return resposta(400, { error: 'Tipo inválido.' })
  }

  try {
    // o cliente sai do token do painel (cabeçalho x-painel-token), não do
    // navegador; o clienteId do corpo só vale pros links antigos enquanto
    // EXIGIR_AUTENTICACAO não estiver ligado (ver lib/autenticacao.js).
    // O nome vem do banco — e um token/id que não é de cliente nenhum não gera aviso.
    const cliente = await clienteDoPainel(event, clienteId)
    if (!cliente) return resposta(404, { error: 'Cliente não encontrado.' })
    clienteId = cliente.id

    const desde = new Date(Date.now() - JANELA_REPETICAO_MS).toISOString()
    let repetido = supabase.from('painel_eventos').select('id', { count: 'exact', head: true })
      .eq('cliente_id', clienteId).eq('tipo', tipo).gte('criado_em', desde)
    repetido = descricao ? repetido.eq('descricao', descricao) : repetido.is('descricao', null)
    const { count } = await repetido
    if (count > 0) return resposta(200, { repetido: true })

    const { error: errInsert } = await supabase.from('painel_eventos')
      .insert({ cliente_id: clienteId, tipo, descricao, competencia })
    if (errInsert) throw errInsert

    let whatsapp = { sucesso: false, erro: 'WHATSAPP_GROUP_ID não configurada.' }
    if (GRUPO_ID) {
      const texto = tipo === 'download'
        ? `⬇️ *Cliente baixou um arquivo do painel*\n👤 ${cliente.nome}${descricao ? `\n📄 ${descricao}` : ''}`
        : `👀 *Cliente abriu o painel*\n👤 ${cliente.nome}${competencia ? `\n📅 Competência ${competencia}` : ''}`
      whatsapp = await enviarMensagem(GRUPO_ID, texto)
    }
    return resposta(200, { ok: true, whatsapp: whatsapp.sucesso })
  } catch (e) {
    console.error('painel-evento:', e.message)
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
