// netlify/functions/lib/filaMensagens.js
//
// Central de Mensagens (tela Mensagens; schema em
// supabase-schema-central-mensagens.sql). Toda mensagem programada para o
// cliente passa por mensagens_fila e só sai depois de aprovada na tela:
//   - enfileirarCobrancasHonorario: o cron diário de honorários
//     (honorarios-cron.js) não manda mais direto — põe a cobrança na fila,
//     aguardando aprovação;
//   - enviarFila: manda as aprovadas cujo horário já chegou (mensagens-cron.js
//     a cada 5 min, e mensagens-enviar.js logo depois da aprovação).

const { enviarMensagem } = require('./whatsapp')
const { montarLembreteHonorario } = require('./honorariosLembrete')

// Pega (status 'aprovada' -> 'enviando') as mensagens prontas e manda.
// ids: só essas (envio logo após aprovar); sem ids, todas as que venceram.
async function enviarFila(supabase, { ids = null, agora = new Date() } = {}) {
  let q = supabase.from('mensagens_fila')
    .update({ status: 'enviando' })
    .eq('status', 'aprovada')
    .or(`agendada_para.is.null,agendada_para.lte.${agora.toISOString()}`)
  if (ids?.length) q = q.in('id', ids)
  const { data: lote, error } = await q.select('id, telefone, texto, honorario_id')
  if (error) throw error

  let enviadas = 0
  const erros = []
  for (const m of lote || []) {
    let falha = null
    if (!m.telefone) falha = 'Cliente sem celular válido no cadastro.'
    else {
      const r = await enviarMensagem(m.telefone, m.texto).catch((e) => ({ sucesso: false, erro: e.message }))
      if (!r.sucesso) falha = `WhatsApp não confirmou o envio: ${r.erro || 'erro desconhecido'}`
    }
    const quando = new Date().toISOString()
    await supabase.from('mensagens_fila')
      .update(falha ? { status: 'erro', erro: falha } : { status: 'enviada', enviado_em: quando, erro: null })
      .eq('id', m.id)
    if (falha) { erros.push({ id: m.id, erro: falha }); continue }
    enviadas++
    if (m.honorario_id) {
      await supabase.from('honorarios').update({ lembrete_enviado_em: quando }).eq('id', m.honorario_id)
    }
  }
  return { enviadas, erros }
}

// Cobranças de honorário vencidas e sem lembrete enviado entram na fila para
// aprovação (uma vez por honorário: se já tem mensagem na fila — mesmo
// descartada — não cria outra; com erro no envio, cria de novo).
async function enfileirarCobrancasHonorario(supabase, { hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const { data: honorarios, error } = await supabase
    .from('honorarios')
    .select('id, cliente_id')
    .eq('status', 'pendente')
    .is('lembrete_enviado_em', null)
    .lte('vencimento', hoje)
  if (error) throw error
  if (!honorarios?.length) return { enfileiradas: 0, puladas: [] }

  const { data: jaNaFila, error: errFila } = await supabase
    .from('mensagens_fila')
    .select('honorario_id, status')
    .in('honorario_id', honorarios.map((h) => h.id))
  if (errFila) throw errFila // sem a tabela: não manda nada sem aprovação
  const tem = new Set((jaNaFila || []).filter((m) => m.status !== 'erro').map((m) => m.honorario_id))

  let enfileiradas = 0
  const puladas = []
  for (const h of honorarios) {
    if (tem.has(h.id)) continue
    try {
      const { honorario, numero, texto, motivoBloqueio, modeloId } = await montarLembreteHonorario(supabase, h.id)
      if (motivoBloqueio && !/celular válido/.test(motivoBloqueio)) { puladas.push({ id: h.id, motivo: motivoBloqueio }); continue }
      // sem celular válido também entra: a tela mostra o aviso e dá para corrigir o cadastro antes de aprovar
      const { error: errIns } = await supabase.from('mensagens_fila').insert({
        cliente_id: h.cliente_id, honorario_id: h.id, modelo_id: modeloId || null,
        destino_nome: honorario?.clientes?.nome || honorario?.nome_avulso || null,
        telefone: numero || null,
        texto: texto || '(sem texto: confira o cadastro e o PIX em Honorários)',
        origem: 'honorarios-cron', status: 'aguardando_aprovacao', criado_por: 'cobrança automática',
      })
      if (errIns) throw errIns
      enfileiradas++
    } catch (e) {
      puladas.push({ id: h.id, motivo: e.message })
    }
  }
  return { enfileiradas, puladas }
}

module.exports = { enviarFila, enfileirarCobrancasHonorario }
