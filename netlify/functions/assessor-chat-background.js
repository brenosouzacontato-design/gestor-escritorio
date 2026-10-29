// netlify/functions/assessor-chat-background.js
//
// Chat do Assessor e "sugestões de obrigações da competência": pergunta ao
// Claude, que busca só em sites oficiais (gov.br, leg.br, jus.br).
// Background Function (sufixo -background): a busca na web costuma passar
// dos 10-26s de uma function normal. O Netlify responde 202 na hora e esta
// roda até 15 minutos; o resultado vai para o Netlify Blobs (loja
// "assessor-chat", chave = id que o navegador mandou) e a tela consulta em
// assessor-chat-resultado.js.
//
// Variável de ambiente: ANTHROPIC_API_KEY. Opcional: ASSESSOR_MODELO.

const Anthropic = require('@anthropic-ai/sdk')
const { connectLambda, getStore } = require('@netlify/blobs')
const { exigirEscritorio } = require('./lib/autenticacao')
const { sanitizarPedido, montarPedido, textoDaResposta, fontesDaResposta, lerObrigacoes } = require('./lib/assessorChat')

const MODELO = process.env.ASSESSOR_MODELO || 'claude-opus-5-5'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RETOMADAS = 4

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return
  if (await exigirEscritorio(event, 'assessor-chat-background')) return

  connectLambda(event)
  const loja = getStore('assessor-chat')

  let corpo
  try { corpo = JSON.parse(event.body || '{}') } catch { return }
  const id = String(corpo.id || '')
  if (!ID.test(id)) return
  const gravar = (dados) => loja.setJSON(id, { ...dados, em: new Date().toISOString() })

  let pedido
  try {
    pedido = sanitizarPedido(corpo.pedido)
  } catch (e) {
    await gravar({ status: 'erro', erro: e.message })
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    await gravar({ status: 'erro', erro: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' })
    return
  }
  await gravar({ status: 'processando' })

  const client = new Anthropic({ timeout: 5 * 60_000, maxRetries: 1 })
  const params = montarPedido(pedido, MODELO)
  try {
    let r
    const mensagens = [...params.messages]
    for (let i = 0; i <= MAX_RETOMADAS; i++) {
      r = await client.beta.messages.create({
        ...params,
        messages: mensagens,
        // Se o modelo recusar, a própria API tenta outro modelo na mesma chamada.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
      // a busca no servidor pausou no meio: devolve o turno e deixa continuar
      if (r.stop_reason !== 'pause_turn') break
      mensagens.push({ role: 'assistant', content: r.content })
    }
    if (r.stop_reason === 'refusal') {
      await gravar({ status: 'erro', erro: 'O Claude não quis responder essa pergunta. Tente reformular.' })
      return
    }
    const texto = textoDaResposta(r)
    if (!texto) {
      await gravar({ status: 'erro', erro: 'O Claude não devolveu resposta. Tente de novo.' })
      return
    }
    const fontes = fontesDaResposta(r)
    if (pedido.modo === 'obrigacoes') {
      const { obrigacoes, aviso } = lerObrigacoes(texto)
      await gravar({ status: 'pronto', modo: 'obrigacoes', obrigacoes, aviso, fontes, modelo: r.model })
    } else {
      await gravar({ status: 'pronto', modo: 'chat', texto, fontes, modelo: r.model })
    }
  } catch (e) {
    let erro = 'Falha ao consultar o Claude.'
    if (e instanceof Anthropic.RateLimitError) erro = 'Muitas chamadas seguidas ao Claude. Tente em instantes.'
    else if (e instanceof Anthropic.AuthenticationError) erro = 'ANTHROPIC_API_KEY inválida.'
    else if (e instanceof Anthropic.APIError) erro = `Erro na API da Anthropic (${e.status ?? 'rede'}): ${e.message}`
    else if (e instanceof SyntaxError) erro = 'A lista de obrigações veio num formato inesperado. Tente de novo.'
    else console.error('assessor-chat-background:', e)
    await gravar({ status: 'erro', erro })
  }
}
