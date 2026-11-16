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

// Texto padrão da cobrança — o mesmo do modelo 'cobranca_honorario' da
// Central de Mensagens (src/lib/mensagens.js). Vale quando o modelo não
// existe no banco ou está desativado.
const MODELO_PADRAO = '🧾 *Lembrete de honorário contábil*\nOlá, {nome}! O {referencia} no valor de {valor} venceu em {vencimento}.\n\n💳 Chave PIX: {pix_chave}\n👤 {pix_favorecido}\n\nSe já pagou, pode desconsiderar. Qualquer dúvida, é só chamar por aqui.'

// Mesma regra de src/lib/mensagens.js (montarTexto): troca {variavel} e tira a
// linha que só tinha uma variável vazia.
function montarTexto(modelo, valores) {
  return String(modelo || '').split('\n').map((linha) => {
    let vazia = false
    const nova = linha.replace(/\{(\w+)\}/g, (inteiro, v) => {
      if (!(v in valores)) return inteiro
      const val = valores[v]
      if (val === '' || val == null) { vazia = true; return '' }
      return String(val)
    })
    return vazia && !nova.replace(/[^\p{L}\p{N}]/gu, '') ? null : nova
  }).filter((l) => l !== null).join('\n').trim()
}

// Modelo editável da Central de Mensagens; sem a tabela, o texto padrão.
async function modeloCobranca(supabase) {
  const { data, error } = await supabase.from('mensagens_modelos').select('id, texto, ativo').eq('chave', 'cobranca_honorario').maybeSingle()
  if (error || !data || data.ativo === false || !data.texto?.trim()) return { id: null, texto: MODELO_PADRAO }
  return { id: data.id, texto: data.texto }
}

// Retorna { honorario, numero, texto, motivoBloqueio?, modeloId } — motivoBloqueio
// preenchido quando não dá pra enviar (telefone inválido, PIX não configurada,
// já pago). Com telefone inválido o texto ainda vem (a Central de Mensagens
// mostra a cobrança com o aviso); nos outros casos `numero`/`texto` vêm null.
async function montarLembreteHonorario(supabase, honorarioId) {
  const { data: honorario, error: errHon } = await supabase
    .from('honorarios')
    .select('id, competencia, tipo, descricao, valor, vencimento, status, nome_avulso, telefone_avulso, clientes(nome, telefone)')
    .eq('id', honorarioId)
    .single()
  if (errHon) throw errHon
  if (!honorario) return { honorario: null, numero: null, texto: null, motivoBloqueio: 'Honorário não encontrado.' }
  if (honorario.status !== 'pendente') {
    return { honorario, numero: null, texto: null, motivoBloqueio: 'Honorário já está marcado como pago.' }
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

  // Avulso de não cliente não tem linha em "clientes" pra puxar nome/telefone
  // — usa nome_avulso/telefone_avulso preenchidos na hora de criar a cobrança.
  const nome = String(honorario.clientes?.nome || honorario.nome_avulso || '').replace(/^[\d./-]+\s+/, '').trim()
  const referencia = honorario.tipo === 'avulso' ? (honorario.descricao || 'serviço avulso') : `honorário de ${honorario.competencia}`
  const modelo = await modeloCobranca(supabase)
  const texto = montarTexto(modelo.texto, {
    nome, referencia, competencia: honorario.competencia || '',
    valor: fmtMoeda(honorario.valor), vencimento: fmtData(honorario.vencimento),
    pix_chave: chavePix, pix_favorecido: porChave.honorarios_pix_favorecido || '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
  })

  const numero = normalizarTelefoneWhatsapp(honorario.clientes?.telefone || honorario.telefone_avulso)
  if (!numero) {
    const ondeCorrigir = honorario.clientes ? 'confira em Clientes' : 'edite o honorário avulso'
    return { honorario, numero: null, texto, modeloId: modelo.id, motivoBloqueio: `Telefone não é um celular válido (${ondeCorrigir}).` }
  }
  return { honorario, numero, texto, modeloId: modelo.id, motivoBloqueio: null }
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

  // respostaEvolution vai junto pra tela — se a mensagem não chegar de
  // verdade mesmo com enviado=true aqui, esse é o dado que mostra o que a
  // Evolution disse (ex: um "status":"PENDING" que nunca confirma), já que
  // não tem webhook de confirmação de entrega configurado neste app.
  return { enviado: true, respostaEvolution: resultadoEnvio.corpo || null }
}

module.exports = { montarLembreteHonorario, enviarLembreteHonorario, montarTexto, MODELO_PADRAO }
