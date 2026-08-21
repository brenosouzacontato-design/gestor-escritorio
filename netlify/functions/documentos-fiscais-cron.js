// netlify/functions/documentos-fiscais-cron.js
//
// Roda diariamente: sincroniza os documentos fiscais (NF-e/NFS-e de
// entrada e saída) de todos os clientes vinculados ao OneFlow, pra
// competência atual e a anterior (documentos costumam ser escriturados
// com atraso). Depende do token de sessão do escritório (of_user_token,
// salvo em `configuracoes` quando alguém faz login no modal "Configure o
// token OneFlow") — esse token vale ~23h e não tem renovação automática
// (precisa da senha, que este app nunca guarda); se estiver vencido, essa
// execução só registra e não sincroniza nada — por isso a tela mostra a
// data da última sincronização, pra dar pra perceber se parou.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { sincronizarTodosClientes, competenciaAtual, competenciaAnterior } = require('./lib/oneflowFiscal')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

exports.handler = async () => {
  const { data: cfg, error: errCfg } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'of_user_token')
    .maybeSingle()
  if (errCfg) return resposta(500, { error: errCfg.message })

  const userToken = cfg?.valor
  if (!userToken) {
    return resposta(200, { sincronizados: 0, motivo: 'OneFlow não conectado (of_user_token ausente) — nada sincronizado.' })
  }

  try {
    const resultado = await sincronizarTodosClientes(supabase, userToken, [competenciaAtual(), competenciaAnterior()])
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
