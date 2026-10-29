const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { uploadArquivo } = require('./lib/googleDrive')
const { enviarMensagem } = require('./lib/whatsapp')
const { identificarDocumento } = require('./lib/identificarDocumento')
const { listarCandidatosDocumento } = require('./lib/candidatosDocumento')
const { analisarComprovante, registrarComprovante } = require('./lib/comprovantePagamento')
const {
  ROTULO, detectarComando, hojeSP, somarDias, calcularVencimento, promptExtracao,
  parseJSONResposta, normalizarExtracao, lembreteReuniao, pendencias, confirmacao,
} = require('./lib/comandosWhatsapp')
const {
  EXTENSAO_POR_MIME, extrairMidia, extrairTexto, limparBase64, tipoReal, leituraPossivel, nomeDoArquivo,
} = require('./lib/midiaWhatsapp')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const DOCS_GRUPO_ID = process.env.WHATSAPP_DOCS_GROUP_ID // grupo "Documentos" — todo arquivo enviado aqui vai pro Drive
const PAGAMENTOS_GRUPO_ID = process.env.WHATSAPP_PAGAMENTOS_GROUP_ID // grupo "Pagamentos" — comprovantes pra baixa das guias
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID
const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
// Segredo na URL do webhook configurada na Evolution API
// (.../whatsapp-webhook?segredo=...; ver iniciar-gestor.bat). Sem a variável,
// aceita qualquer chamada, como antes.
const WEBHOOK_SEGREDO = process.env.WHATSAPP_WEBHOOK_SEGREDO


// O Netlify roda essa function síncrona atrás de um API Gateway que mata a
// conexão com "Inactivity Timeout" (504) depois de ~29s sem resposta — um
// teto fixo, não dá pra configurar/aumentar. Descoberto na prática: quando
// a chamada à Anthropic (extrairComIA) ou o envio da confirmação de volta
// pro WhatsApp (enviarMensagem, em lib/whatsapp.js) demoravam mais que
// isso, a function inteira era matada ANTES de gravar a tarefa no banco —
// a tarefa se perdia de vez, sem erro nem confirmação no grupo, sem
// nenhum rastro de que a mensagem chegou a ser processada. Por isso todo
// fetch pra serviço externo aqui tem um timeout curto e, quando estoura,
// cai num fallback que garante que a tarefa é criada mesmo assim (só sem
// os campos que a IA preencheria) — perder a formatação bonita é bem
// melhor que perder a tarefa inteira.
async function fetchComTimeout(url, opcoes, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Pede à IA os campos da categoria (ver promptExtracao em
// lib/comandosWhatsapp.js). Falhou ou estourou o tempo → null, e
// normalizarExtracao completa com o que dá para ler do texto: o item é
// criado de qualquer forma, só sem a arrumação que a IA faria.
async function extrairComIA(prompt) {
  const response = await fetchComTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  }, 12000)

  if (!response.ok) throw new Error(`Anthropic respondeu ${response.status}: ${await response.text()}`)
  const data = await response.json()
  return parseJSONResposta(data.content[0].text)
}

// Conteúdo do arquivo da mensagem: já vem em base64 no payload se a opção
// "Webhook Base64" estiver ligada no Evolution API; senão busca via
// getBase64FromMediaMessage. `anexo` vem de extrairMidia (lib/midiaWhatsapp.js):
// foto, print ou documento, já sem os envelopes do WhatsApp. O tipo é o real
// (pelo conteúdo), não o que o WhatsApp informa, e o nome sai com a
// extensão certa.
async function obterArquivoDaMensagem(body, anexo) {
  const { midia, tipo } = anexo
  let base64 = midia.base64 || null
  if (!base64) {
    const messageId = body?.data?.key?.id
    if (!messageId) throw new Error('Não achei o id da mensagem pra buscar o arquivo.')
    const resp = await fetch(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ message: { key: { id: messageId } } }),
    })
    if (!resp.ok) throw new Error(`Falha ao buscar o arquivo no WhatsApp (${resp.status}): ${await resp.text()}`)
    const dados = await resp.json()
    base64 = dados.base64
    if (!base64) throw new Error('A API do WhatsApp não devolveu o conteúdo do arquivo.')
  }
  base64 = limparBase64(base64)
  const mimeType = tipoReal(base64, midia.mimetype || dadosMime(tipo))
  return { base64, mimeType, nomeArquivo: nomeDoArquivo(midia, tipo, mimeType) }
}

const dadosMime = (tipo) => (tipo === 'imagem' ? 'image/jpeg' : 'application/octet-stream')

const fmtBRL = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDataBR = (iso) => iso.split('-').reverse().join('/')

// Resposta no grupo depois de registrar um comprovante
// (lib/comprovantePagamento.js → registrarComprovante).
function mensagemComprovante(res) {
  const a = res.analise
  const valor = a.valorPago != null ? `\n💰 ${fmtBRL(a.valorPago)}` : ''
  const data = a.dataPagamento ? ` em ${fmtDataBR(a.dataPagamento)}` : ''
  if (res.baixaAutomatica) {
    return `✅ *Comprovante identificado — guia marcada como paga!*\n👤 ${res.guia.clienteNome}\n📄 ${res.guia.titulo}${res.guia.competencia ? ` ${res.guia.competencia}` : ''}${valor}\n📅 Pago${data}\nO comprovante já está disponível no painel do cliente.`
  }
  const empresa = res.cliente ? `\n👤 ${res.cliente.nome}` : `\n👤 Empresa não identificada${a.pagadorNome ? ` (pagador: ${a.pagadorNome})` : ''}`
  const aviso = a.ehComprovante ? '' : '\n⚠️ Não parece um comprovante de pagamento — confira.'
  return `📥 *Comprovante recebido — falta conferir a baixa.*${empresa}${a.descricao ? `\n📄 ${a.descricao}` : ''}${valor}${data ? `\n📅 Pago${data}` : ''}${aviso}\nConfira e dê a baixa em Gestor → Pagamentos.`
}

// Arquivo enviado no grupo "Pagamentos" — é sempre tratado como comprovante:
// entra na fila de baixa (ou já baixa a guia, quando a IA tem certeza). Não
// vai pro Drive nem pra fila de documentos.
async function processarComprovante(body, anexo, remoteJid) {
  try {
    const { base64, mimeType, nomeArquivo } = await obterArquivoDaMensagem(body, anexo)
    const legenda = anexo.legenda
    const remetente = body?.data?.pushName || body?.data?.key?.participant || null
    let res
    try {
      res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente })
    } catch (eIA) {
      // IA fora do ar/timeout: o comprovante ainda entra na fila, sem a leitura
      console.error('Erro ao analisar comprovante (registrando sem leitura):', eIA.message)
      const analise = { ehComprovante: true, pagadorNome: null, pagadorDocumento: null, valorPago: null, dataPagamento: null, descricao: null, banco: null, guia: null, confianca: 'baixa', observacao: `Leitura automática falhou: ${eIA.message.slice(0, 200)}` }
      res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente, analise })
    }
    await enviarMensagem(remoteJid, mensagemComprovante(res))
    return { statusCode: 200, body: JSON.stringify({ success: true, comprovanteId: res.comprovanteId, baixaAutomatica: res.baixaAutomatica }) }
  } catch (e) {
    console.error('Erro ao processar comprovante:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao registrar o comprovante: ${e.message}`)
    // 200 de propósito: ver nota em processarDocumento
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Documento/imagem enviado no grupo "Documentos" — sobe pro Drive e entra
// na fila de documentos (ou, se for comprovante de pagamento, na fila de
// baixa de pagamentos).
async function processarDocumento(body, anexo, remoteJid) {
  try {
    const { base64, mimeType, nomeArquivo } = await obterArquivoDaMensagem(body, anexo)
    const legenda = anexo.legenda
    // foto/print/PDF que a IA consegue ler; senão (HEIC, grande demais...)
    // pula a leitura e o arquivo vai direto para a fila de revisão
    const leitura = leituraPossivel(base64, mimeType)

    // O backup no Drive é um extra: se falhar (ex: refresh token do Google
    // vencido), o documento ainda precisa entrar no sistema — identificação,
    // fila de revisão e baixa de guia por comprovante não dependem dele.
    // `erroDrive` vai junto na observação do documento e na resposta do grupo.
    let arquivo = null
    let erroDrive = null
    try {
      arquivo = await uploadArquivo({ nomeArquivo, mimeType, base64, folderId: DRIVE_FOLDER_ID })
      console.log('Arquivo salvo no Drive:', arquivo.id, arquivo.name)

      const remetente = body?.data?.key?.participant || body?.data?.pushName || remoteJid
      const { error: errLog } = await supabase.from('documentos_whatsapp').insert({
        nome_arquivo: arquivo.name,
        mime_type: mimeType,
        remetente,
        drive_file_id: arquivo.id,
        drive_link: arquivo.webViewLink || null,
      })
      if (errLog) console.error('Erro ao gravar log do upload:', errLog.message)
    } catch (eDrive) {
      erroDrive = eDrive.message
      console.error('Erro ao salvar no Drive (seguindo sem o backup):', erroDrive)
    }
    const avisoDrive = erroDrive ? `\n\n⚠️ Não consegui salvar a cópia no Drive: ${erroDrive.slice(0, 160)}` : ''

    // Comprovante de pagamento: vai pra fila de baixa de pagamentos (tela
    // Pagamentos), e a guia já é baixada quando a IA bate cliente, tributo e
    // valor com segurança (lib/comprovantePagamento.js). Se gravar na fila
    // falhar (ex: tabela comprovantes_pagamento ainda não criada), cai na
    // fila de documentos abaixo, como antes.
    let pareceComprovante = false
    try {
      if (!leitura.ok) throw new Error(leitura.motivo)
      const analise = await analisarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY })
      if (analise.ehComprovante) {
        pareceComprovante = true
        const remetente = body?.data?.pushName || body?.data?.key?.participant || null
        const res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente, analise })
        await enviarMensagem(remoteJid, `${mensagemComprovante(res)}${avisoDrive}`)
        return { statusCode: 200, body: JSON.stringify({ success: true, driveFileId: arquivo?.id || null, comprovanteId: res.comprovanteId, baixaAutomatica: res.baixaAutomatica }) }
      }
    } catch (eComp) {
      console.error('Erro ao verificar comprovante de pagamento:', eComp.message)
    }

    // Identificação automática (IA) + fila de revisão — mesmo pipeline do
    // upload manual (DocumentosPage.jsx), só que persistido direto (aba "A
    // revisar"), já que aqui não tem ninguém na tela pra confirmar na hora.
    // Só SUGERE: a baixa de fato só acontece quando alguém confirma no
    // sistema — nunca automático.
    let mensagemIdentificacao = '\n\n⚠️ Não consegui rodar a identificação automática — revise manualmente no sistema.'
    try {
      const candidatos = await listarCandidatosDocumento(supabase)
      // comprovante sem guia identificada com segurança já foi analisado
      // acima — não gasta uma segunda chamada de IA (o teto de ~29s da
      // function não comporta as duas), só entra na fila de revisão
      const sugestao = pareceComprovante
        ? { tipoDocumento: 'Comprovante de pagamento', clienteId: null, candidatoId: null, confianca: 'baixa', observacao: 'Comprovante de pagamento sem guia identificada com segurança.' }
        : !leitura.ok
          ? { tipoDocumento: 'Documento não identificado', clienteId: null, candidatoId: null, confianca: 'baixa', observacao: `Sem leitura automática: ${leitura.motivo}.` }
          : await identificarDocumento({ arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, candidatos, apiKey: ANTHROPIC_KEY })
      const candidato = sugestao.candidatoId ? candidatos.find((c) => c.id === sugestao.candidatoId) : null

      const storagePath = `${crypto.randomUUID()}.${EXTENSAO_POR_MIME[mimeType] || 'bin'}`
      const { error: errStorage } = await supabase.storage
        .from('documentos')
        .upload(storagePath, Buffer.from(base64, 'base64'), { contentType: mimeType })
      if (errStorage) throw errStorage

      const { error: errDoc } = await supabase.from('documentos').insert({
        cliente_id: sugestao.clienteId || null,
        nome_arquivo: nomeArquivo,
        storage_path: storagePath,
        tipo_mime: mimeType,
        tamanho_bytes: Buffer.byteLength(base64, 'base64'),
        tipo_documento_sugerido: sugestao.tipoDocumento,
        confianca: sugestao.confianca,
        observacao_ia: [
          sugestao.observacao,
          legenda ? `Mensagem no WhatsApp: "${legenda.slice(0, 300)}"` : null,
          erroDrive ? `[Sem cópia no Drive: ${erroDrive.slice(0, 200)}]` : null,
        ].filter(Boolean).join(' ') || null,
        candidato_sugerido_id: candidato?.id || null,
        candidato_sugerido_tipo: candidato?.tipo || null,
        status: sugestao.candidatoId ? 'identificado' : 'sem_match',
      })
      if (errDoc) throw errDoc

      const avisoLeitura = leitura.ok ? '' : `\n⚠️ Não li o arquivo automaticamente: ${leitura.motivo}.`
      mensagemIdentificacao = `\n\n🔎 ${sugestao.tipoDocumento}${avisoLeitura}` + (
        pareceComprovante
          ? '\n⚠️ Não consegui registrar na fila de pagamentos — dê a baixa em Gestor → Pagamentos → Baixa manual.'
          : candidato
          ? `\n👤 ${candidato.clienteNome} — ${candidato.rotulo}\nRevise e confirme em Documentos → A revisar.`
          : sugestao.clienteId
            ? `\n👤 Cliente identificado, mas sem correspondência clara. Revise em Documentos → A revisar.`
            : '\n⚠️ Não identifiquei o cliente. Revise em Documentos → A revisar.'
      )
    } catch (eIdent) {
      console.error('Erro ao identificar documento:', eIdent.message)
    }

    await enviarMensagem(remoteJid, `${arquivo ? '✅ *Documento salvo no Drive!*' : '✅ *Documento recebido!*'}\n📄 ${arquivo?.name || nomeArquivo}${mensagemIdentificacao}${avisoDrive}`)
    return { statusCode: 200, body: JSON.stringify({ success: true, driveFileId: arquivo?.id || null, nome: arquivo?.name || nomeArquivo }) }
  } catch (e) {
    console.error('Erro ao processar documento:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao salvar o documento: ${e.message}`)
    // 200 de propósito: a Evolution API reenvia o mesmo webhook até 10 vezes
    // quando recebe erro, e reprocessar não conserta uma falha dessas — só
    // repete a mesma mensagem de erro no grupo dez vezes
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// ---------- categorias: tarefa / obrigação / reunião / lembrete ----------

async function criarTarefa(item, mensagem, { prefixo = '' } = {}) {
  const { data, error } = await supabase
    .from('tarefas')
    .insert({
      titulo: `${prefixo}${item.titulo}`.slice(0, 200),
      observacao: mensagem, // conteúdo completo da mensagem
      cliente_id: item.cliente_id,
      vencimento: item.prazo ?? item.vencimento ?? item.data ?? null,
      departamento: item.departamento || 'contabil',
      prioridade: item.prioridade || 'normal',
      concluida: false,
      origem: 'whatsapp',
    })
    .select()
    .single()
  if (error) {
    console.error('Erro insert tarefa:', JSON.stringify(error))
    throw new Error(error.message)
  }
  return data
}

// Lembrete = tarefa + linha em "lembretes" (a tabela exige o vínculo com
// uma tarefa ou obrigação). O lembretes-cron manda o aviso no grupo.
async function criarLembrete(item, mensagem) {
  const tarefa = await criarTarefa({ ...item, prazo: item.data }, mensagem)
  const { error } = await supabase.from('lembretes').insert({
    tarefa_id: tarefa.id,
    data_hora: item.dataHora,
    mensagem: null,
  })
  if (error) throw new Error(`a tarefa foi criada, mas o lembrete falhou: ${error.message}`)
  return tarefa
}

async function criarReuniao(item, mensagem) {
  const { data, error } = await supabase
    .from('agenda_eventos')
    .insert({
      titulo: item.titulo,
      cliente_id: item.cliente_id,
      data: item.data,
      hora: item.hora,
      duracao_min: item.duracao_min,
      local: item.local,
      descricao: mensagem,
      origem: 'whatsapp',
      lembrete_em: lembreteReuniao(item.data, item.hora),
    })
    .select()
    .single()
  if (error) {
    // tabela ainda não criada (supabase-schema-agenda.sql) → quem chama cai na tarefa
    if (error.code === '42P01' || error.code === 'PGRST205') return null
    throw new Error(error.message)
  }
  return data
}

// Mesma lógica de criarObrigacaoComEtapas (src/pages/andamento/andamentoApi.js):
// obrigação + cópia das etapas do tipo + histórico.
async function criarObrigacao(item, tipo, etapasTemplate) {
  const hoje = hojeSP()
  const vencimento = item.vencimento ||
    (tipo.dia_vencimento ? calcularVencimento(item.competencia, tipo.mes_vencimento || 'mesmo', tipo.dia_vencimento) : null)
  const { data: obrigacao, error } = await supabase
    .from('obrigacoes')
    .insert({
      cliente_id: item.cliente_id,
      tipo: tipo.nome,
      competencia: item.competencia,
      tipo_obrigacao_id: tipo.id,
      departamento_id: tipo.departamento_id || null,
      titulo: tipo.nome,
      responsavel: item.responsavel || null,
      status: 'pendente',
      data_inicio: hoje,
      vencimento,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  const etapas = etapasTemplate.map((et, i) => ({
    obrigacao_id: obrigacao.id,
    etapas_template_id: et.id,
    nome: et.nome,
    ordem: et.ordem,
    status: i === 0 ? 'em_andamento' : 'pendente',
    data_prevista: (vencimento && etapasTemplate.length === 1) ? vencimento : somarDias(hoje, et.prazo_dias_relativo ?? 0),
  }))
  const { error: errEtapas } = await supabase.from('etapas_obrigacao').insert(etapas)
  if (errEtapas) throw new Error(`a obrigação foi criada, mas as etapas falharam: ${errEtapas.message}`)

  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: obrigacao.id,
    descricao: `Obrigação "${tipo.nome}" criada pelo WhatsApp: ${item.titulo}`,
    autor: item.responsavel || null,
  })
  return { ...obrigacao, vencimento }
}

async function processarComando({ categoria, texto }, mensagem, remoteJid) {
  const hoje = hojeSP()
  try {
    const { data: clientesBrutos } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('ativo', true)
    const clientes = clientesBrutos || []

    let tipos = []
    if (categoria === 'obrigacao') {
      const { data } = await supabase
        .from('tipos_obrigacao')
        .select('id, nome, departamento_id, mes_vencimento, dia_vencimento')
        .eq('ativo', true)
      tipos = data || []
    }

    let bruto = null
    try {
      bruto = await extrairComIA(promptExtracao(categoria, texto, { clientes, tipos, hoje }))
      console.log(`${categoria} extraída:`, JSON.stringify(bruto))
    } catch (eIA) {
      // Anthropic fora do ar, lenta (timeout de 12s) ou resposta que não
      // parseou: segue com o que dá para ler do texto
      console.error('Falha ao extrair com IA, usando só o texto:', eIA.message)
    }
    const item = normalizarExtracao(categoria, bruto, { texto, clientes, tipos, hoje })
    const falta = pendencias(item)
    const nomeCliente = item.cliente_id ? clientes.find((c) => c.id === item.cliente_id)?.nome : null

    // Obrigação: não duplica a mesma competência e o tipo precisa ter etapas
    let tipo = null, etapasTemplate = []
    if (categoria === 'obrigacao' && !falta.length) {
      tipo = tipos.find((t) => t.id === item.tipo_obrigacao_id)
      const { data: existente } = await supabase
        .from('obrigacoes')
        .select('id')
        .eq('cliente_id', item.cliente_id)
        .eq('tipo_obrigacao_id', tipo.id)
        .eq('competencia', item.competencia)
        .limit(1)
      if (existente?.length) {
        await enviarMensagem(remoteJid, `ℹ️ ${tipo.nome} — ${item.competencia} de ${nomeCliente} já existe no gestor. Não criei outra.`)
        return { statusCode: 200, body: JSON.stringify({ success: true, existente: existente[0].id }) }
      }
      const { data: tpl } = await supabase
        .from('etapas_template')
        .select('id, nome, ordem, prazo_dias_relativo')
        .eq('tipo_obrigacao_id', tipo.id)
        .order('ordem')
      etapasTemplate = tpl || []
      if (!etapasTemplate.length) falta.push(`etapas cadastradas no tipo "${tipo.nome}"`)
    }

    let criado
    if (categoria === 'reuniao' && !falta.length) {
      criado = await criarReuniao(item, mensagem)
      if (!criado) falta.push('a Agenda ativada no banco de dados')
    }
    if (criado) {
      // reunião já gravada na Agenda
    } else if (falta.length) {
      // Faltou algo: vira tarefa (com a categoria no título) e o grupo é avisado
      criado = await criarTarefa(item, mensagem, { prefixo: `${ROTULO[categoria]}: ` })
    } else if (categoria === 'lembrete') {
      criado = await criarLembrete(item, mensagem)
    } else if (categoria === 'obrigacao') {
      criado = await criarObrigacao(item, tipo, etapasTemplate)
      item.vencimento = criado.vencimento
    } else {
      criado = await criarTarefa(item, mensagem)
    }

    await enviarMensagem(remoteJid, confirmacao(item, { nomeCliente, nomeTipo: tipo?.nome, falta }))
    console.log(`${categoria} criada:`, criado.id)
    return { statusCode: 200, body: JSON.stringify({ success: true, categoria, id: criado.id }) }
  } catch (e) {
    console.error('Erro:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao criar ${ROTULO[categoria].toLowerCase()}: ${e.message}`)
    // 200 de propósito: com erro a Evolution reenvia o webhook e repetiria
    // a mensagem de erro (ou criaria o item em dobro)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

function segredoConfere(event) {
  if (!WEBHOOK_SEGREDO) return true
  const recebido = Buffer.from(String(event.queryStringParameters?.segredo || ''))
  const esperado = Buffer.from(WEBHOOK_SEGREDO)
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado)
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' }
  }
  if (!segredoConfere(event)) {
    console.warn('whatsapp-webhook: chamada sem o segredo certo — ignorada')
    return { statusCode: 401, body: 'Unauthorized' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' }
  }

  const remoteJid = body?.data?.key?.remoteJid || body?.data?.remoteJid || ''
  // texto e anexo (foto, print ou documento), também dentro de mensagem
  // temporária, de visualização única ou documento com legenda
  const mensagem = extrairTexto(body?.data?.message)
  const anexo = extrairMidia(body?.data?.message)
  const midia = anexo?.midia || null

  console.log('remoteJid:', remoteJid)
  console.log('mensagem:', mensagem)
  console.log('anexo:', anexo ? `${anexo.tipo} ${midia.mimetype || ''}` : 'nenhum')

  // Grupo "Documentos" — qualquer arquivo enviado aqui vai pro Drive, sem
  // depender de prefixo. Mensagem de texto nesse grupo (sem arquivo) é
  // ignorada, não cai no fluxo de tarefa abaixo.
  // Grupo "Pagamentos" — todo arquivo é comprovante de pagamento: vai pra
  // fila de baixa (tela Pagamentos do gestor). Texto sem arquivo é ignorado.
  if (PAGAMENTOS_GRUPO_ID && remoteJid === PAGAMENTOS_GRUPO_ID) {
    if (!midia) {
      return { statusCode: 200, body: 'No file in payments group message' }
    }
    return await processarComprovante(body, anexo, remoteJid)
  }

  if (DOCS_GRUPO_ID && remoteJid === DOCS_GRUPO_ID) {
    if (!midia) {
      return { statusCode: 200, body: 'No file in docs group message' }
    }
    return await processarDocumento(body, anexo, remoteJid)
  }

  // Mensagens com categoria: "tarefa:", "obrigação:", "reunião:" ou
  // "lembrete:" (ver lib/comandosWhatsapp.js). O resto é conversa.
  const comando = detectarComando(mensagem)
  if (!comando) {
    return { statusCode: 200, body: 'Not a command message' }
  }
  return await processarComando(comando, mensagem, remoteJid)
}
