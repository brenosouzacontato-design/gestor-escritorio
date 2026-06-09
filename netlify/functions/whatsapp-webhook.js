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
  const listaNomes = clientes.map(c => c.nome).join('\n')
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
        content: `Você é um assistente de escritório contábil. Extraia informações de tarefas de mensagens de WhatsApp.

Lista de clientes cadastrados:
${listaNomes}

Mensagem recebida: "${mensagem}"

Responda APENAS com JSON válido, sem markdown:
{
  "titulo": "título curto da tarefa",
  "cliente_nome": "nome exato do cliente da lista acima ou null se não mencionado",
  "prazo": "data no formato YYYY-MM-DD ou null se não mencionado",
  "departamento": "fiscal" ou "folha" ou "societario" ou "geral",
  "prioridade": "normal" ou "alta"
}`
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

  // Log completo para debug
  const remoteJid = body?.data?.key?.remoteJid || body?.data?.remoteJid || ''
  const mensagem = body?.data?.message?.conversation || 
                   body?.data?.message?.extendedTextMessage?.text || ''
  
  console.log('remoteJid:', remoteJid)
  console.log('mensagem:', mensagem)
  console.log('GRUPO_ID esperado:', GRUPO_ID)
  console.log('body keys:', Object.keys(body || {}))

  // Só processa mensagens com prefixo "tarefa:" — sem filtro de grupo por ora
  const textoLower = mensagem.toLowerCase().trim()
  if (!textoLower.startsWith('tarefa:')) {
    console.log('Ignorado: sem prefixo tarefa:')
    return { statusCode: 200, body: 'Not a task message' }
  }

  const textoTarefa = mensagem.substring(7).trim()

  try {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('ativo', true)

    const tarefa = await extrairTarefa(textoTarefa, clientes || [])

    let clienteId = null
    if (tarefa.cliente_nome && clientes) {
      const clienteEncontrado = clientes.find(c => 
        c.nome.toLowerCase().includes(tarefa.cliente_nome.toLowerCase()) ||
        tarefa.cliente_nome.toLowerCase().includes(c.nome.toLowerCase().split(' ')[0])
      )
      if (clienteEncontrado) clienteId = clienteEncontrado.id
    }

    const { data: novaTarefa, error } = await supabase
      .from('tarefas')
      .insert({
        titulo: tarefa.titulo,
        cliente_id: clienteId,
        vencimento: tarefa.prazo || null,
        departamento: tarefa.departamento || 'geral',
        prioridade: tarefa.prioridade || 'normal',
        concluida: false,
        origem: 'whatsapp',
      })
      .select()
      .single()

    if (error) throw error

    const nomeCliente = tarefa.cliente_nome || 'sem cliente'
    const prazo = tarefa.prazo ? ` · Prazo: ${tarefa.prazo}` : ''
    const confirmacao = `✅ *Tarefa criada!*\n📋 ${tarefa.titulo}\n👤 ${nomeCliente}${prazo}`
    
    await enviarMensagem(remoteJid, confirmacao)

    console.log('Tarefa criada:', novaTarefa.id)
    return { statusCode: 200, body: JSON.stringify({ success: true }) }

  } catch (e) {
    console.error('Erro:', e.message)
    return { statusCode: 500, body: e.message }
  }
}
