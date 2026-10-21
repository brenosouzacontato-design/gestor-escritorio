// netlify/functions/carteira-acao.js
//
// Tudo o que o link da carteira (?carteira=<token>, PainelCarteiraPage.jsx)
// faz com tarefas, obrigações e anexos das empresas da carteira. A página
// não tem login: a pessoa responsável pela carteira se identifica só pelo
// token (cabeçalho x-carteira-token, tabela carteira_links —
// supabase-schema-painel-carteira.sql). Por isso nada disso passa pelo
// navegador direto no banco: aqui, com a service key, toda ação confere
//   1) que o token é de uma carteira existente, e
//   2) que a empresa (ou a obrigação/tarefa/documento) é dessa carteira,
// antes de ler ou gravar. Cada ação que grava fica registrada em
// carteira_acoes (supabase-schema-carteira-acoes.sql), quando a tabela existe.
//
// POST { acao, ... }:
//   listar            { competencia }                 → empresas, obrigações, tarefas e anexos
//   status_obrigacao  { id, status }                  → muda o status (dar baixa = 'concluido')
//   concluir_tarefa   { id, concluida }               → marca/desmarca a tarefa
//   criar_tarefa      { clienteId, titulo, departamento, prioridade, vencimento, observacao }
//   url_upload        { alvo: { tipo, id }, nomeArquivo, tipoMime, tamanho } → URL assinada de upload
//   registrar_anexo   { alvo, storagePath, nomeArquivo, tipoMime, tamanho, darBaixa }
//   url_download      { documentoId }                 → URL assinada do anexo (5 min)
//   observacao        { alvo, texto }                 → grava a observação (vazio apaga)
// alvo.tipo é 'obrigacao' ou 'tarefa'. Não existe ação de excluir: apagar
// continua sendo só pelo gestor, com login.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL, SUPABASE_SERVICE_KEY.

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const BUCKET = 'documentos'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS_OBRIGACAO = ['pendente', 'concluido', 'nao_aplica', 'vencido']
const DEPARTAMENTOS = ['fiscal', 'folha', 'societario', 'contabil', 'escritorio', 'geral', 'pessoal']
const TAMANHO_MAXIMO = 25 * 1024 * 1024 // 25 MB por arquivo
// tarefas concluídas aparecem no quadro por esse tempo depois da baixa
const DIAS_CONCLUIDAS = 45

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return resposta(400, { error: 'Body inválido.' })
  }

  try {
    const sessao = await sessaoCarteira(cabecalho(event, 'x-carteira-token'))
    if (!sessao) return resposta(401, { error: 'Link da carteira inválido ou trocado. Peça o link novo ao escritório.' })

    const contexto = { ...sessao, userAgent: String(cabecalho(event, 'user-agent') || '').slice(0, 300) || null }
    switch (body.acao) {
      case 'listar': return await listar(contexto, body)
      case 'status_obrigacao': return await statusObrigacao(contexto, body)
      case 'concluir_tarefa': return await concluirTarefa(contexto, body)
      case 'criar_tarefa': return await criarTarefa(contexto, body)
      case 'url_upload': return await urlUpload(contexto, body)
      case 'registrar_anexo': return await registrarAnexo(contexto, body)
      case 'url_download': return await urlDownload(contexto, body)
      case 'observacao': return await salvarObservacao(contexto, body)
      default: return resposta(400, { error: 'Ação desconhecida.' })
    }
  } catch (e) {
    console.error('carteira-acao:', body?.acao, e.message)
    return resposta(500, { error: e.message })
  }
}

// ---------- sessão ----------

async function sessaoCarteira(token) {
  token = String(token || '')
  if (token.length < 24 || token.length > 64) return null
  const { data: link, error } = await supabase.from('carteira_links').select('carteira').eq('token', token).maybeSingle()
  if (error || !link) return null
  const { data: clientes, error: errClientes } = await supabase.from('clientes').select('*').eq('carteira', link.carteira)
  if (errClientes) throw errClientes
  const ativos = (clientes || []).filter((c) => c.ativo !== false)
  return { carteira: link.carteira, clientes: ativos, ids: new Set(ativos.map((c) => c.id)) }
}

// Obrigação/tarefa só pode ser mexida se for de empresa da carteira.
async function itemDaCarteira(ctx, tipo, id) {
  if (!UUID.test(String(id || ''))) return null
  const tabela = tipo === 'obrigacao' ? 'obrigacoes' : tipo === 'tarefa' ? 'tarefas' : null
  if (!tabela) return null
  const { data, error } = await supabase.from(tabela).select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data && ctx.ids.has(data.cliente_id) ? data : null
}

async function registrarAcao(ctx, acao, clienteId, alvoId, detalhe) {
  const { error } = await supabase.from('carteira_acoes').insert({
    carteira: ctx.carteira, acao, cliente_id: clienteId, alvo_id: alvoId || null,
    detalhe: detalhe ? String(detalhe).slice(0, 300) : null, user_agent: ctx.userAgent,
  })
  // tabela de registro ainda não criada: a ação vale do mesmo jeito
  if (error && !['42P01', 'PGRST205'].includes(error.code)) console.warn('carteira-acao: registro falhou:', error.message)
}

// ---------- ações ----------

async function listar(ctx, { competencia }) {
  const ids = [...ctx.ids]
  const empresas = ctx.clientes
    .map((c) => ({ id: c.id, nome: c.nome, cnpj: c.cnpj, regime: c.regime }))
    .sort((a, b) => a.nome.localeCompare(b.nome))
  if (ids.length === 0) return resposta(200, { carteira: ctx.carteira, empresas, obrigacoes: [], tarefas: [], anexos: [] })

  const comp = /^\d{2}\/\d{4}$/.test(competencia || '') ? competencia : null
  const desdeConcluidas = new Date(Date.now() - DIAS_CONCLUIDAS * 86400000).toISOString()

  // obrigações da competência + as que ficaram em aberto de meses anteriores
  let obrigacoes = []
  {
    let q = supabase.from('obrigacoes').select('*, departamentos(nome, icone)').in('cliente_id', ids)
    q = comp ? q.or(`competencia.eq."${comp}",status.in.(pendente,vencido)`) : q.in('status', ['pendente', 'vencido'])
    let { data, error } = await q
    // banco sem a tabela departamentos/relacionamento: lê sem o join
    if (error) {
      let q2 = supabase.from('obrigacoes').select('*').in('cliente_id', ids)
      q2 = comp ? q2.or(`competencia.eq."${comp}",status.in.(pendente,vencido)`) : q2.in('status', ['pendente', 'vencido'])
      ;({ data, error } = await q2)
    }
    if (error) throw error
    const ordinal = (c) => { const m = /^(\d{2})\/(\d{4})$/.exec(c || ''); return m ? Number(m[2]) * 100 + Number(m[1]) : 0 }
    // pendente de competência FUTURA (gerada antes) não entra
    obrigacoes = (data || []).filter((o) => !comp || o.competencia === comp || ordinal(o.competencia) < ordinal(comp))
  }

  const { data: tarefas, error: errTarefas } = await supabase.from('tarefas').select('*').in('cliente_id', ids)
    .or(`concluida.eq.false,concluida_em.gte.${desdeConcluidas}`)
  if (errTarefas) throw errTarefas

  const idsObrigacoes = obrigacoes.map((o) => o.id)
  const idsTarefas = (tarefas || []).map((t) => t.id)
  let anexos = []
  if (idsObrigacoes.length || idsTarefas.length) {
    const filtros = []
    if (idsObrigacoes.length) filtros.push(`obrigacao_id.in.(${idsObrigacoes.join(',')})`)
    if (idsTarefas.length) filtros.push(`tarefa_id.in.(${idsTarefas.join(',')})`)
    const { data, error } = await supabase.from('documentos')
      .select('id, cliente_id, obrigacao_id, tarefa_id, nome_arquivo, tipo_mime, tamanho_bytes, created_at')
      .in('cliente_id', ids).or(filtros.join(','))
      .order('created_at', { ascending: false })
    if (error) throw error
    anexos = data || []
  }

  return resposta(200, { carteira: ctx.carteira, empresas, obrigacoes, tarefas: tarefas || [], anexos })
}

async function statusObrigacao(ctx, { id, status }) {
  if (!STATUS_OBRIGACAO.includes(status)) return resposta(400, { error: 'Status inválido.' })
  const o = await itemDaCarteira(ctx, 'obrigacao', id)
  if (!o) return resposta(404, { error: 'Obrigação não encontrada nessa carteira.' })
  const { error } = await supabase.from('obrigacoes').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
  await registrarAcao(ctx, 'status_obrigacao', o.cliente_id, id, `${o.titulo || o.tipo}: ${o.status} → ${status}`)
  return resposta(200, { ok: true })
}

async function concluirTarefa(ctx, { id, concluida }) {
  const t = await itemDaCarteira(ctx, 'tarefa', id)
  if (!t) return resposta(404, { error: 'Tarefa não encontrada nessa carteira.' })
  const agora = new Date().toISOString()
  const { error } = await supabase.from('tarefas')
    .update({ concluida: !!concluida, concluida_em: concluida ? agora : null, updated_at: agora }).eq('id', id)
  if (error) throw error
  await registrarAcao(ctx, concluida ? 'concluir_tarefa' : 'reabrir_tarefa', t.cliente_id, id, t.titulo)
  return resposta(200, { ok: true })
}

async function criarTarefa(ctx, { clienteId, titulo, departamento, prioridade, vencimento, observacao }) {
  if (!ctx.ids.has(clienteId)) return resposta(404, { error: 'Empresa não encontrada nessa carteira.' })
  const tituloLimpo = String(titulo || '').trim().slice(0, 200)
  if (!tituloLimpo) return resposta(400, { error: 'Informe o título da tarefa.' })
  const linha = {
    cliente_id: clienteId,
    titulo: tituloLimpo,
    departamento: DEPARTAMENTOS.includes(departamento) ? departamento : 'geral',
    prioridade: prioridade === 'alta' ? 'alta' : 'normal',
    vencimento: /^\d{4}-\d{2}-\d{2}$/.test(vencimento || '') ? vencimento : null,
    concluida: false,
    updated_at: new Date().toISOString(),
  }
  const obs = String(observacao || '').trim().slice(0, 1000)
  let { data, error } = await supabase.from('tarefas').insert(obs ? { ...linha, observacao: obs } : linha).select().single()
  // coluna observacao ausente nesse banco: grava sem ela
  if (error && ['42703', 'PGRST204'].includes(error.code) && obs) ({ data, error } = await supabase.from('tarefas').insert(linha).select().single())
  if (error) throw error
  await registrarAcao(ctx, 'criar_tarefa', clienteId, data.id, tituloLimpo)
  return resposta(200, { tarefa: data })
}

async function urlUpload(ctx, { alvo, nomeArquivo, tamanho }) {
  const item = await itemDaCarteira(ctx, alvo?.tipo, alvo?.id)
  if (!item) return resposta(404, { error: 'Item não encontrado nessa carteira.' })
  if (Number(tamanho) > TAMANHO_MAXIMO) return resposta(400, { error: 'Arquivo grande demais (máximo 25 MB).' })
  const ext = (String(nomeArquivo || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || 'bin').toLowerCase()
  const path = `${crypto.randomUUID()}.${ext}`
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error) throw error
  return resposta(200, { path: data.path, token: data.token })
}

async function registrarAnexo(ctx, { alvo, storagePath, nomeArquivo, tipoMime, tamanho, darBaixa }) {
  const item = await itemDaCarteira(ctx, alvo?.tipo, alvo?.id)
  if (!item) return resposta(404, { error: 'Item não encontrado nessa carteira.' })
  // só aceita o formato de caminho que url_upload gera, e um caminho que
  // ainda não está registrado — senão daria pra "pegar" o arquivo de outra empresa
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(String(storagePath || ''))) return resposta(400, { error: 'Arquivo inválido.' })
  const { count, error: errDup } = await supabase.from('documentos').select('id', { count: 'exact', head: true }).eq('storage_path', storagePath)
  if (errDup) throw errDup
  if (count > 0) return resposta(400, { error: 'Esse arquivo já foi registrado.' })
  const { data: existe } = await supabase.storage.from(BUCKET).list('', { search: storagePath, limit: 1 })
  if (!existe?.some((f) => f.name === storagePath)) return resposta(400, { error: 'O envio do arquivo não terminou. Tente de novo.' })

  const agora = new Date().toISOString()
  const { data: doc, error } = await supabase.from('documentos').insert({
    cliente_id: item.cliente_id,
    nome_arquivo: String(nomeArquivo || storagePath).slice(0, 200),
    storage_path: storagePath,
    tipo_mime: tipoMime ? String(tipoMime).slice(0, 100) : null,
    tamanho_bytes: Number(tamanho) || null,
    obrigacao_id: alvo.tipo === 'obrigacao' ? item.id : null,
    tarefa_id: alvo.tipo === 'tarefa' ? item.id : null,
    observacao_ia: `Anexado pelo link da carteira ${ctx.carteira}`,
    status: 'confirmado',
    confirmado_em: agora,
  }).select('id, cliente_id, obrigacao_id, tarefa_id, nome_arquivo, tipo_mime, tamanho_bytes, created_at').single()
  if (error) throw error

  if (darBaixa) {
    const { error: errBaixa } = alvo.tipo === 'obrigacao'
      ? await supabase.from('obrigacoes').update({ status: 'concluido', updated_at: agora }).eq('id', item.id)
      : await supabase.from('tarefas').update({ concluida: true, concluida_em: agora, updated_at: agora }).eq('id', item.id)
    if (errBaixa) throw errBaixa
  }
  await registrarAcao(ctx, 'anexar', item.cliente_id, item.id, `${doc.nome_arquivo}${darBaixa ? ' (com baixa)' : ''}`)
  return resposta(200, { anexo: doc })
}

async function salvarObservacao(ctx, { alvo, texto }) {
  const item = await itemDaCarteira(ctx, alvo?.tipo, alvo?.id)
  if (!item) return resposta(404, { error: 'Item não encontrado nessa carteira.' })
  const obs = String(texto || '').trim().slice(0, 2000) || null
  const tabela = alvo.tipo === 'obrigacao' ? 'obrigacoes' : 'tarefas'
  const { error } = await supabase.from(tabela).update({ observacao: obs, updated_at: new Date().toISOString() }).eq('id', item.id)
  if (error && ['42703', 'PGRST204'].includes(error.code)) return resposta(400, { error: 'Esse tipo de item ainda não aceita observação.' })
  if (error) throw error
  await registrarAcao(ctx, 'observacao', item.cliente_id, item.id, obs ? `${item.titulo || item.tipo}: ${obs}` : `${item.titulo || item.tipo}: observação apagada`)
  return resposta(200, { ok: true })
}

async function urlDownload(ctx, { documentoId }) {
  if (!UUID.test(String(documentoId || ''))) return resposta(404, { error: 'Anexo não encontrado.' })
  const { data: doc, error } = await supabase.from('documentos').select('cliente_id, storage_path').eq('id', documentoId).maybeSingle()
  if (error) throw error
  if (!doc || !ctx.ids.has(doc.cliente_id)) return resposta(404, { error: 'Anexo não encontrado nessa carteira.' })
  const { data, error: errUrl } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300)
  if (errUrl) throw errUrl
  return resposta(200, { url: data.signedUrl })
}

// ---------- utilitários ----------

function cabecalho(event, nome) {
  const headers = event.headers || {}
  const chave = Object.keys(headers).find((k) => k.toLowerCase() === nome)
  return chave ? headers[chave] : undefined
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
