// netlify/functions/documentos-fiscais-sincronizar-background.js
//
// Faz o trabalho pesado de sincronizar documentos fiscais de todos os
// clientes — disparado tanto pelo botão "Sincronizar agora"
// (documentos-fiscais-sincronizar.js) quanto pelo cron diário
// (documentos-fiscais-cron.js) via dispararSincronizacaoBackground().
// Background Function (sufixo -background no nome): o Netlify responde
// 202 pra quem chamou na hora e deixa essa aqui rodar até 15 minutos —
// sincronizar ~30 empresas com múltiplas páginas de API cada não cabe no
// limite de 10-26s de uma function síncrona normal. Ninguém espera o
// resultado desse handler, então erro vira só log.
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
  if (errCfg) {
    console.error('documentos-fiscais-sincronizar-background: falha ao ler of_user_token:', errCfg.message)
    return
  }
  if (!cfg?.valor) {
    console.log('documentos-fiscais-sincronizar-background: OneFlow não conectado, nada sincronizado.')
    return
  }

  try {
    const resultado = await sincronizarTodosClientes(supabase, cfg.valor, [competenciaAtual(), competenciaAnterior()])
    console.log(`documentos-fiscais-sincronizar-background: ${resultado.sincronizados}/${resultado.total} empresas, ${resultado.erros.length} com erro.`)
    if (resultado.erros.length > 0) console.error('Erros:', JSON.stringify(resultado.erros))
  } catch (e) {
    console.error('documentos-fiscais-sincronizar-background: falha geral:', e.message)
  }
}
