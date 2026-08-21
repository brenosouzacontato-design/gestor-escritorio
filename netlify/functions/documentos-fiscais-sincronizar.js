// netlify/functions/documentos-fiscais-sincronizar.js
//
// Handler HTTP usado pelo botão "Sincronizar agora" na tela ERP → Notas
// fiscais — dispara a mesma sincronização do cron
// (lib/oneflowFiscal.js sincronizarTodosClientes), mas sob demanda, sem
// esperar a execução diária.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { sincronizarTodosClientes, competenciaAtual, competenciaAnterior } = require('./lib/oneflowFiscal')

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
    const resultado = await sincronizarTodosClientes(supabase, cfg.valor, [competenciaAtual(), competenciaAnterior()])
    return resposta(200, resultado)
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
