// netlify/functions/documentos-fiscais-sincronizar.js
//
// Handler HTTP usado pelo botão "Sincronizar agora" na tela ERP → Notas
// fiscais — só valida rápido se o OneFlow está conectado e dispara a
// sincronização de verdade numa Background Function
// (documentos-fiscais-sincronizar-background.js). Sincronizar sozinho aqui
// dentro sempre estourava o limite de execução de uma function síncrona
// (10-26s) muito antes de terminar as ~30 empresas, e a tela só via
// "Falha ao sincronizar" mesmo quando a sincronização completava certinho
// no servidor.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { dispararSincronizacaoBackground } = require('./lib/oneflowFiscal')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' })
  }

  const { data: cfg, error: errCfg } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'of_user_token')
    .maybeSingle()
  if (errCfg) return resposta(500, { error: errCfg.message })
  if (!cfg?.valor) {
    return resposta(422, { error: 'OneFlow não conectado — configure o token na tela ERP antes de sincronizar.' })
  }

  try {
    await dispararSincronizacaoBackground()
  } catch (e) {
    return resposta(500, { error: 'Falha ao disparar a sincronização: ' + e.message })
  }
  return resposta(202, { iniciado: true })
}

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
