// netlify/functions/lib/honorariosLembrete.js
//
// Lógica de lembrete de honorário — compartilhada entre o cron diário
// (honorarios-cron.js), o envio manual sob demanda
// (honorarios-enviar-lembrete.js) e a prévia editável
// (honorarios-prever-lembrete.js). Diferente de lembretes.js
// (obrigação/tarefa), esse manda DIRETO pro celular do cliente, não pro
// grupo interno — por isso a validação de telefone é rígida (ver
// lib/telefone.js): sem confirmar que o número é mesmo um celular, não
// monta número nenhum pra enviar.
//
// montarLembreteHonorario faz só a parte "pura" (busca dados, valida,
// compõe o texto) — sem mandar mensagem nem gravar nada, pra poder ser
// reaproveitada tanto pela prévia (só mostra) quanto pelo envio de fato
// (monta + manda + marca enviado).

const { normalizarTelefoneWhatsapp } = require('./telefone')
const { enviarMensagem } = require('./whatsapp')

function fmtMoeda(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')
}

// Retorna { honorario, numero, texto, motivoBloqueio? } — motivoBloqueio
// preenchido quando não dá pra montar um envio válido (telefone inválido,
// PIX não configurada, já pago); nesses casos `numero`/`texto` vêm null.
async function montarLembreteHonorario(supabase, honorarioId) {
  const { data: honorario, error: errHon } = await supabase
    .from('honorarios')
    .select('id, competencia, tipo, descricao, valor, vencimento, status, clientes(nome, telefone)')
    .eq('id', honorarioId)
    .single()
  if (errHon) throw errHon
  if (!honorario) return { honorario: null, numero: null, texto: null, motivoBloqueio: 'Honorário não encontrado.' }
  if (honorario.status !== 'pendente') {
    return { honorario, numero: null, texto: null, motivoBloqueio: 'Honorário já está marcado como pago.' }
  }

  const numero = normalizarTelefoneWhatsapp(honorario.clientes?.telefone)
  if (!numero) {
    return { honorario, numero: null, texto: null, motivoBloqueio: 'Telefone do cliente não é um celular válido (confira em Clientes).' }
  }

  const { data: config, error: errConfig } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', ['honorarios_pix_chave', 'honorarios_pix_favorecido'])
  if (errConfig) throw errConfig
  const porChave = Object.fromEntries((config || []).map((r) => [r.chave, r.valor]))
  const chavePix = porChave.honorarios_pix_chave
  if (!chavePix) {
    return { honorario, numero: null, texto: null, motivoBloqueio: 'Chave PIX não configurada (tela Honorários → Configurar PIX).' }
  }
  const favorecido = porChave.honorarios_pix_favorecido || ''

  const referencia = honorario.tipo === 'avulso' ? (honorario.descricao || 'serviço avulso') : `honorário de ${honorario.competencia}`
  const texto = `🧾 *Lembrete de honorário contábil*\n`
    + `Olá, ${honorario.clientes?.nome || ''}! O ${referencia} no valor de ${fmtMoeda(honorario.valor)} venceu em ${fmtData(honorario.vencimento)}.\n\n`
    + `💳 Chave PIX: ${chavePix}`
    + (favorecido ? `\n👤 ${favorecido}` : '')
    + `\n\nSe já pagou, pode desconsiderar. Qualquer dúvida, é só chamar por aqui.`

  return { honorario, numero, texto, motivoBloqueio: null }
}

// textoPersonalizado (opcional) substitui o texto composto automaticamente
// — usado quando a prévia foi editada antes de confirmar o envio.
async function enviarLembreteHonorario(supabase, honorarioId, textoPersonalizado) {
  const { numero, texto, motivoBloqueio } = await montarLembreteHonorario(supabase, honorarioId)
  if (motivoBloqueio) return { enviado: false, motivo: motivoBloqueio }

  const resultadoEnvio = await enviarMensagem(numero, textoPersonalizado?.trim() || texto)
  if (!resultadoEnvio.sucesso) {
    return { enviado: false, motivo: `WhatsApp não confirmou o envio: ${resultadoEnvio.erro}` }
  }

  const { error: errUpdate } = await supabase
    .from('honorarios')
    .update({ lembrete_enviado_em: new Date().toISOString() })
    .eq('id', honorarioId)
  if (errUpdate) throw errUpdate

  return { enviado: true }
}

module.exports = { montarLembreteHonorario, enviarLembreteHonorario }
