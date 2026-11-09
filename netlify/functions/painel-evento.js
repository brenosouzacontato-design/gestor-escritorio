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
const { descreverAparelho } = require('./lib/aparelho')
const { enviarPushEscritorio } = require('./lib/gestorPush')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const TIPOS = ['visualizacao', 'download']
// Mesmo evento repetido dentro dessa janela (clique duplo no botão, página
// recarregada em seguida) não gera um segundo aviso.
const JANELA_REPETICAO_MS = 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' })
  }

  let clienteId, tipo, descricao, competencia, aparelhoId, doEscritorio, documentoId
  try {
    const body = JSON.parse(event.body)
    clienteId = body.clienteId
    tipo = body.tipo
    descricao = body.descricao ? String(body.descricao).slice(0, 200) : null
    competencia = body.competencia ? String(body.competencia).slice(0, 7) : null
    // id anônimo do navegador (src/pages/painel/aparelho.js) — só aceita o formato que ele gera
    aparelhoId = /^[a-z0-9]{8,40}$/i.test(body.aparelhoId || '') ? body.aparelhoId : null
    // aberto num navegador com o login do gestor: é o escritório testando o link
    doEscritorio = body.escritorio === true
    // guia/anexo aberto (Central de Entregas marca "aberta pelo cliente")
    documentoId = UUID.test(body.documentoId || '') ? body.documentoId : null
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

    const userAgent = String(cabecalho(event, 'user-agent') || '').slice(0, 300) || null
    const linha = { cliente_id: clienteId, tipo, descricao, competencia }
    let { error: errInsert } = await supabase.from('painel_eventos')
      .insert({ ...linha, aparelho_id: aparelhoId, user_agent: userAgent, origem: doEscritorio ? 'escritorio' : 'cliente' })
    // colunas novas (supabase-schema-painel-eventos-aparelho.sql) ainda não
    // existem no banco: grava como antes, sem o aparelho — menos o acesso do
    // escritório, que sem a coluna "origem" ia parecer visita do cliente
    if (errInsert && ['42703', 'PGRST204'].includes(errInsert.code)) {
      if (doEscritorio) return resposta(200, { ok: true, escritorio: true })
      ;({ error: errInsert } = await supabase.from('painel_eventos').insert(linha))
    }
    if (errInsert) throw errInsert

    // teste do próprio escritório não vira aviso de "cliente abriu"
    if (doEscritorio) return resposta(200, { ok: true, escritorio: true })

    // cliente abriu o painel: as guias já entregues a ele passam a "viu no
    // painel" na Central de Entregas (documentos.visto_em,
    // supabase-schema-entrega-visto.sql) — sem a coluna, segue como antes
    if (tipo === 'visualizacao') await marcarGuiasVistas(clienteId)

    const guia = tipo === 'download' && documentoId ? await marcarGuiaAberta(documentoId, clienteId) : null
    if (guia) {
      const titulo = descricao || guia.nome_arquivo
      await enviarPushEscritorio(supabase, {
        titulo: '📄 Cliente abriu a guia',
        mensagem: `${cliente.nome} · ${titulo}`.slice(0, 300),
        url: '/?tela=entregas',
        tag: `guia-aberta-${documentoId}`,
      }).catch((e) => console.error('painel-evento push:', e.message))
    }

    let whatsapp = { sucesso: false, erro: 'WHATSAPP_GROUP_ID não configurada.' }
    if (GRUPO_ID) {
      const aparelho = descreverAparelho(userAgent)
      const linhaAparelho = aparelho ? `\n📱 ${aparelho}` : ''
      const texto = guia
        ? `📄 *Cliente abriu a guia pelo painel*
👤 ${cliente.nome}${descricao ? `
📄 ${descricao}` : ''}${guia.aberto_vezes > 1 ? `
🔁 ${guia.aberto_vezes}ª vez` : ''}${linhaAparelho}`
        : tipo === 'download'
        ? `⬇️ *Cliente baixou um arquivo do painel*\n👤 ${cliente.nome}${descricao ? `\n📄 ${descricao}` : ''}${linhaAparelho}`
        : `👀 *Cliente abriu o painel*\n👤 ${cliente.nome}${competencia ? `\n📅 Competência ${competencia}` : ''}${linhaAparelho}`
      whatsapp = await enviarMensagem(GRUPO_ID, texto)
    }
    return resposta(200, { ok: true, whatsapp: whatsapp.sucesso })
  } catch (e) {
    console.error('painel-evento:', e.message)
    return resposta(500, { error: e.message })
  }
}

async function marcarGuiasVistas(clienteId) {
  const { error } = await supabase.from('documentos')
    .update({ visto_em: new Date().toISOString() })
    .eq('cliente_id', clienteId).not('entregue_em', 'is', null).is('visto_em', null)
  if (error) console.error('painel-evento visto_em:', error.message)
}

// Marca a guia como aberta pelo cliente (colunas de
// supabase-schema-central-entregas.sql) e liga o evento a ela. Só vale pra
// guia do próprio cliente do token. Sem as colunas ainda: devolve null e o
// aviso sai como "baixou um arquivo", igual antes.
async function marcarGuiaAberta(documentoId, clienteId) {
  const { data: doc, error } = await supabase.from('documentos')
    .select('id, cliente_id, nome_arquivo, aberto_em, aberto_vezes')
    .eq('id', documentoId).maybeSingle()
  if (error || !doc || doc.cliente_id !== clienteId) return null
  const agora = new Date().toISOString()
  const vezes = (doc.aberto_vezes || 0) + 1
  const { error: errMarca } = await supabase.from('documentos')
    .update({ aberto_em: doc.aberto_em || agora, aberto_ultimo_em: agora, aberto_vezes: vezes })
    .eq('id', documentoId)
  if (errMarca) return null
  // evento mais recente desse cliente (o que acabou de ser gravado)
  const { data: ev } = await supabase.from('painel_eventos').select('id')
    .eq('cliente_id', clienteId).eq('tipo', 'download').order('criado_em', { ascending: false }).limit(1).maybeSingle()
  if (ev) await supabase.from('painel_eventos').update({ documento_id: documentoId }).eq('id', ev.id)
  return { ...doc, aberto_vezes: vezes }
}

function cabecalho(event, nome) {
  const headers = event.headers || {}
  const chave = Object.keys(headers).find((k) => k.toLowerCase() === nome)
  return chave ? headers[chave] : undefined
}

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
