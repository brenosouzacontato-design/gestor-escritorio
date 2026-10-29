// netlify/functions/assessor-chat-resultado.js
//
// A tela do Assessor consulta aqui o resultado que assessor-chat-background.js
// gravou no Netlify Blobs. Responde { status: 'processando' | 'pronto' | 'erro', ... }
// ou 404 enquanto o background ainda não começou.

const { connectLambda, getStore } = require('@netlify/blobs')
const { exigirEscritorio } = require('./lib/autenticacao')

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return resposta(405, { error: 'Use GET.' })
  const negado = await exigirEscritorio(event, 'assessor-chat-resultado')
  if (negado) return negado

  const id = String(event.queryStringParameters?.id || '')
  if (!ID.test(id)) return resposta(400, { error: 'id inválido.' })

  connectLambda(event)
  const dados = await getStore('assessor-chat').get(id, { type: 'json' })
  if (!dados) return resposta(404, { status: 'aguardando' })
  return resposta(200, dados)
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) }
}
