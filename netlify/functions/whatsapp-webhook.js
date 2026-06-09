const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

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

  console.log('remoteJid:', remoteJid)
  console.log('mensagem:', mensagem)

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
