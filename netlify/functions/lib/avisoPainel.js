// netlify/functions/lib/avisoPainel.js
//
// Aviso no WhatsApp do cliente com o link curto do painel. Sai só quando o
// escritório pede (painel-aviso-enviar.js): ao concluir a edição do painel,
// pelo botão "Notificar cliente" ou na pergunta que aparece ao anexar uma
// guia nova. A mensagem lista as guias anexadas que ainda não foram
// entregues; sem guia nova, avisa só que o painel foi atualizado.
// Guia já paga nunca entra na lista. Se entre as pendentes de entrega houver
// guia paga ou de competência anterior, a mensagem fica genérica (sem listar
// nada), para o cliente não receber cobrança do que já pagou.
// Colunas em supabase-schema-aviso-guia-painel.sql.

// Mesma regra do painel (PainelCompartilhadoPage.jsx → ehImposto): anexo de
// obrigação que não é imposto (ex: holerite) não é guia a pagar.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS', 'INSS MENSAL',
])
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i
function ehImposto(o) {
  return !!o && (o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`))
}

// Guia anexada há mais tempo que isso e nunca entregue não entra no aviso
// (já passou o mês; se precisar, reenvie pela Central de Entregas).
const JANELA_DIAS = 45

// Competência em que o escritório trabalha: o mês anterior (mesmo padrão do
// Gestor). Formato "MM/AAAA".
function competenciaAtual(agora = new Date()) {
  const d = new Date(agora.getTime() - 3 * 60 * 60 * 1000) // horário de Brasília
  const mes = d.getUTCMonth() // 0-11 → o mês anterior em 1-12
  return mes === 0 ? `12/${d.getUTCFullYear() - 1}` : `${String(mes).padStart(2, '0')}/${d.getUTCFullYear()}`
}
function ordinal(c) {
  const m = /^(\d{2})\/(\d{4})$/.exec(String(c || '').trim())
  return m ? Number(m[2]) * 100 + Number(m[1]) : null
}
function hojeISO(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Mesma regra do painel (guiaResolvida): paga, ou obrigação concluída com o
// vencimento já passado.
function guiaPaga(g, hoje) {
  if (g.pago_em) return true
  const o = g.obrigacoes
  const venc = String(g.vencimento_guia || o?.vencimento || '').slice(0, 10)
  return !!o && (o.status === 'concluido' || o.status === 'nao_aplica') && !!venc && venc < hoje
}
function deCompetenciaAnterior(g, atual) {
  const c = ordinal(g.obrigacoes?.competencia)
  return c != null && c < ordinal(atual)
}

// Guias do cliente anexadas e ainda não entregues (nem pelo aviso, nem pela Central).
// → { guias: as que estão em aberto, generica: true se a mensagem não deve listá-las }
async function guiasNovas(supabase, clienteId, agora = new Date()) {
  const candidatas = await guiasPendentesDeEntrega(supabase, clienteId)
  const hoje = hojeISO(agora)
  const atual = competenciaAtual(agora)
  const guias = candidatas.filter((g) => !guiaPaga(g, hoje))
  const generica = guias.length < candidatas.length || guias.some((g) => deCompetenciaAnterior(g, atual))
  return { guias, generica }
}

async function guiasPendentesDeEntrega(supabase, clienteId) {
  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const consultar = (comParcelamento) => supabase.from('documentos')
    .select('id, nome_arquivo, obrigacao_id, valor_guia, vencimento_guia, confirmado_em, pago_em, '
      + 'obrigacoes(titulo, tipo, competencia, vencimento, status, tipos_obrigacao(eh_imposto))'
      + (comParcelamento ? ', parcelamento_id, parcelamentos(origem, descricao)' : ''))
    .eq('cliente_id', clienteId)
    .eq('status', 'confirmado')
    .is('entregue_em', null)
    .gte('confirmado_em', desde)
  let { data, error } = await consultar(true)
  // banco sem o módulo de parcelamentos: segue só com as guias de obrigação
  if (error && /parcelamento/i.test(error.message || '')) ({ data, error } = await consultar(false))
  if (error) throw error
  return (data || []).filter((d) => d.parcelamento_id || ehImposto(d.obrigacoes))
}

// Documentos avulsos da seção "Documentos" do painel (contrato, alvará...)
// anexados e ainda não entregues. Sem as colunas no banco
// (supabase-schema-painel-documentos.sql): nenhum.
async function documentosNovos(supabase, clienteId, agora = new Date()) {
  const desde = new Date(agora.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('documentos')
    .select('id, nome_arquivo, tipo_documento_sugerido, painel_titulo, painel_competencia, confirmado_em')
    .eq('cliente_id', clienteId)
    .eq('status', 'confirmado')
    .eq('painel_visivel', true)
    .is('entregue_em', null)
    .gte('confirmado_em', desde)
  if (error) return []
  return data || []
}
const tituloDocumento = (d) => d.painel_titulo || d.tipo_documento_sugerido || d.nome_arquivo || 'Documento'

function tituloGuia(g) {
  if (g.obrigacoes) return g.obrigacoes.titulo || g.obrigacoes.tipo || 'Guia'
  if (g.parcelamentos) return `Parcelamento ${g.parcelamentos.origem || ''}`.trim()
  return 'Guia'
}

function fmtData(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const nomeCurto = (nome) => String(nome || '').replace(/^[\d./-]+\s+/, '')

function mensagemAviso(cliente, lista, link, { generica = false, documentos = [] } = {}) {
  const nome = nomeCurto(cliente.nome)
  const docs = documentos.map((d) => `• *${tituloDocumento(d)}*`)
  if (generica || (!lista.length && !docs.length)) {
    return [
      `Olá! O painel de *${nome}* foi atualizado pelo escritório.`,
      '',
      docs.length ? 'Acesse para ver os impostos, as guias, os documentos e as pendências:' : 'Acesse para ver os impostos, as guias e as pendências:',
      link,
    ].join('\n')
  }
  if (!lista.length) {
    return [
      docs.length === 1
        ? `Olá! Um novo documento de *${nome}* já está disponível no seu painel:`
        : `Olá! ${docs.length} novos documentos de *${nome}* já estão disponíveis no seu painel:`,
      '', ...docs, '', 'Acesse para baixar:', link,
    ].join('\n')
  }
  const linhas = [
    lista.length === 1
      ? `Olá! Uma nova guia de *${nome}* já está disponível no seu painel:`
      : `Olá! ${lista.length} novas guias de *${nome}* já estão disponíveis no seu painel:`,
    '',
  ]
  const ordenadas = [...lista].sort((a, b) => String(a.vencimento_guia || a.obrigacoes?.vencimento || '9999')
    .localeCompare(String(b.vencimento_guia || b.obrigacoes?.vencimento || '9999')))
  for (const g of ordenadas) {
    const venc = g.vencimento_guia || g.obrigacoes?.vencimento
    const comp = g.obrigacoes?.competencia
    const partes = [`• *${tituloGuia(g)}*${comp ? ` (${comp})` : ''}`]
    if (venc) partes.push(`vence ${fmtData(venc)}`)
    if (g.valor_guia != null) partes.push(Number(g.valor_guia).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
    linhas.push(partes.join(' · '))
  }
  if (docs.length) linhas.push('', docs.length === 1 ? 'E um novo documento:' : 'E novos documentos:', ...docs)
  linhas.push('', docs.length ? 'Acesse para ver o valor, baixar as guias e os documentos ou copiar o código de pagamento:'
    : 'Acesse para ver o valor, baixar a guia ou copiar o código de pagamento:', link)
  return linhas.join('\n')
}

module.exports = { ehImposto, guiasNovas, documentosNovos, tituloDocumento, mensagemAviso, tituloGuia, nomeCurto, competenciaAtual, guiaPaga }
