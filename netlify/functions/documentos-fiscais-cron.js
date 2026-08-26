// netlify/functions/documentos-fiscais-cron.js
//
// Roda diariamente (ver netlify.toml): só dispara a sincronização de
// documentos fiscais numa Background Function
// (documentos-fiscais-sincronizar-background.js), que faz o trabalho de
// verdade e checa o of_user_token — rodar a sincronização inline aqui
// estourava o limite de execução de uma function síncrona (10-26s) bem
// antes de terminar as ~30 empresas.

const { dispararSincronizacaoBackground } = require('./lib/oneflowFiscal')

exports.handler = async () => {
  try {
    await dispararSincronizacaoBackground()
    return resposta(200, { disparado: true })
  } catch (e) {
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
