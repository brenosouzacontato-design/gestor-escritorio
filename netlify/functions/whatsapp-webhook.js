const { createClient } = require('@supabase/supabase-js')
const { uploadArquivo } = require('./lib/googleDrive')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const DOCS_GRUPO_ID = process.env.WHATSAPP_DOCS_GROUP_ID // grupo "Documentos" — todo arquivo enviado aqui vai pro Drive
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID
const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const EXTENSAO_POR_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function extrairTarefa(mensagem, clientes) {
  const listaNomes = clientes.map(c => `${c.nome} (id: ${c.id})`).join('\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Você é um assistente de escritório contábil brasileiro. Extraia informações de tarefas de mensagens de WhatsApp.

Clientes cadastrados:
${listaNomes}

Mensagem: "${mensagem}"

Responda APENAS com JSON válido sem markdown:
{
  "titulo": "título curto e claro da tarefa",
  "cliente_id": "id exato do cliente da lista ou null se não identificado",
  "prazo": "data YYYY-MM-DD ou null",
  "departamento": "fiscal" ou "folha" ou "societario" ou "contabil",
  "prioridade": "normal" ou "alta"
}

Regras:
- titulo deve ser conciso mas descritivo
- Se mencionar urgente/urgência, prioridade = alta
- Se não identificar cliente, cliente_id = null (não invente)
- departamento: PGDAS/DAS/NFSe/fiscal = fiscal, folha/holerite/eSocial = folha, contrato/abertura/alteração = societario, restante = contabil`
      }]
    })
  })

  const data = await response.json()
  const texto = data.content[0].text.trim()
  try {
    return JSON.parse(texto)
  } catch {
    return JSON.parse(texto.replace(/```json|```/g, '').trim())
  }
}

async function enviarMensagem(numero, texto) {
  try {
    await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ number: numero, text: texto })
    })
  } catch (e) {
    console.error('Erro ao enviar mensagem:', e.message)
  }
}

// Documento/imagem enviado no grupo "Documentos" — busca o conteúdo (já
// vem em base64 no payload se a opção "Webhook Base64" estiver ligada no
// Evolution API; senão busca via getBase64FromMediaMessage) e sobe pro
// Drive. `midia` é o bloco documentMessage/imageMessage do payload.
async function processarDocumento(body, midia, remoteJid) {
  try {
    const mimeType = midia.mimetype || 'application/octet-stream'
    const nomeArquivo = midia.fileName || `whatsapp-${Date.now()}.${EXTENSAO_POR_MIME[mimeType] || 'bin'}`

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

    const arquivo = await uploadArquivo({ nomeArquivo, mimeType, base64, folderId: DRIVE_FOLDER_ID })
    console.log('Arquivo salvo no Drive:', arquivo.id, arquivo.name)
    await enviarMensagem(remoteJid, `✅ *Documento salvo no Drive!*\n📄 ${arquivo.name}`)
    return { statusCode: 200, body: JSON.stringify({ success: true, driveFileId: arquivo.id, nome: arquivo.name }) }
  } catch (e) {
    console.error('Erro ao processar documento:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao salvar o documento: ${e.message}`)
    return { statusCode: 500, body: e.message }
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' }
  }

  const remoteJid = body?.data?.key?.remoteJid || body?.data?.remoteJid || ''
  const mensagem = body?.data?.message?.conversation ||
                   body?.data?.message?.extendedTextMessage?.text || ''
  const midia = body?.data?.message?.documentMessage ||
                body?.data?.message?.imageMessage ||
                body?.data?.message?.documentWithCaptionMessage?.message?.documentMessage ||
                null

  console.log('remoteJid:', remoteJid)
  console.log('mensagem:', mensagem)
  console.log('tem midia:', !!midia)

  // Grupo "Documentos" — qualquer arquivo enviado aqui vai pro Drive, sem
  // depender de prefixo. Mensagem de texto nesse grupo (sem arquivo) é
  // ignorada, não cai no fluxo de tarefa abaixo.
  if (DOCS_GRUPO_ID && remoteJid === DOCS_GRUPO_ID) {
    if (!midia) {
      return { statusCode: 200, body: 'No file in docs group message' }
    }
    return await processarDocumento(body, midia, remoteJid)
  }

  // Só processa mensagens com prefixo "tarefa:"
  if (!mensagem.toLowerCase().trim().startsWith('tarefa:')) {
    return { statusCode: 200, body: 'Not a task message' }
  }

  const textoTarefa = mensagem.substring(7).trim()

  try {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('ativo', true)

    const tarefa = await extrairTarefa(textoTarefa, clientes || [])
    console.log('Tarefa extraída:', JSON.stringify(tarefa))

    // Validar cliente_id — garantir que existe na lista
    let clienteIdFinal = null
    if (tarefa.cliente_id && clientes) {
      const existe = clientes.find(c => c.id === tarefa.cliente_id)
      if (existe) clienteIdFinal = tarefa.cliente_id
    }

    // Inserir tarefa — sempre cria, mesmo sem cliente
    const { data: novaTarefa, error } = await supabase
      .from('tarefas')
      .insert({
        titulo: tarefa.titulo || textoTarefa.substring(0, 100),
        observacao: mensagem, // conteúdo completo da mensagem
        cliente_id: clienteIdFinal,
        vencimento: tarefa.prazo || null,
        departamento: tarefa.departamento || 'contabil',
        prioridade: tarefa.prioridade || 'normal',
        concluida: false,
        origem: 'whatsapp',
      })
      .select()
      .single()

    if (error) {
      console.error('Erro insert:', JSON.stringify(error))
      throw new Error(error.message)
    }

    // Confirmação no grupo
    const nomeCliente = clienteIdFinal
      ? clientes.find(c => c.id === clienteIdFinal)?.nome || 'cliente identificado'
      : '⚠️ cliente não identificado'
    const prazo = tarefa.prazo ? `\n📅 Prazo: ${tarefa.prazo}` : ''
    const confirmacao = `✅ *Tarefa criada!*\n📋 ${tarefa.titulo}${prazo}\n👤 ${nomeCliente}`

    await enviarMensagem(remoteJid, confirmacao)

    console.log('Tarefa criada:', novaTarefa.id)
    return { statusCode: 200, body: JSON.stringify({ success: true, id: novaTarefa.id }) }

  } catch (e) {
    console.error('Erro:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao criar tarefa: ${e.message}`)
    return { statusCode: 500, body: e.message }
  }
}
