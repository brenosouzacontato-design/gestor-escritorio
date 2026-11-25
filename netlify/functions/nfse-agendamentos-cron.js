// netlify/functions/nfse-agendamentos-cron.js
//
// Scheduled Function (netlify.toml, a cada 5 minutos): emite as NFS-e agendadas cuja hora chegou
// (tabela nfse_agendamentos; regras em lib/nfse/agendamentos.js). A emissão é a mesma da tela
// (nfse.js → recorrente_emitir); a nota autorizada de produção vai no WhatsApp da empresa, se marcado.
// Agendamento feito pelo grupo do WhatsApp: o resultado é avisado no mesmo grupo.

const { executarAgendamentos } = require('./nfse')
const { enviarMensagem } = require('./lib/whatsapp')
const { quandoBR } = require('./lib/nfse/agendamentos')

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function avisar(ag, fim) {
  if (!ag.avisar_jid) return
  const cabecalho = fim.situacao === 'emitida' ? `✅ *${fim.mensagem}* (agendada)` : '❌ *A NFS-e agendada não saiu.*'
  const detalhe = fim.situacao === 'emitida' ? (fim.envio ? `\n📲 ${fim.envio}` : '') : `\n${String(fim.mensagem || '').slice(0, 500)}\nConfira em Gestor → ${ag.tipo === 'mei' ? 'NFS-e MEI' : 'Emitir NFS-e'}.`
  await enviarMensagem(ag.avisar_jid, `${cabecalho}\n💰 ${brl(ag.valor)} · marcada para ${quandoBR(ag.executar_em)}${detalhe}`)
}

exports.handler = async () => {
  try {
    const r = await executarAgendamentos({ avisar })
    if (r.executados || r.travados) console.log('nfse-agendamentos-cron:', JSON.stringify(r))
    return { statusCode: 200, body: JSON.stringify(r) }
  } catch (e) {
    // banco sem a tabela: o robô só fica parado até rodar o SQL
    if (/nfse_agendamentos/i.test(e.message || '')) return { statusCode: 200, body: 'sem tabela nfse_agendamentos' }
    console.error('nfse-agendamentos-cron:', e.message)
    return { statusCode: 500, body: e.message }
  }
}
