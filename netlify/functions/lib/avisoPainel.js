// netlify/functions/lib/avisoPainel.js
//
// Aviso no WhatsApp do cliente com o link curto do painel. Sai só quando o
// escritório pede (painel-aviso-enviar.js): ao concluir a edição do painel,
// pelo botão "Notificar cliente" ou na pergunta que aparece ao anexar uma
// guia nova. A mensagem lista as guias anexadas que ainda não foram
// entregues; sem guia nova, avisa só que o painel foi atualizado.
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

// Guias do cliente anexadas e ainda não entregues (nem pelo aviso, nem pela Central)
async function guiasNovas(supabase, clienteId) {
  const desde = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString()
  const consultar = (comParcelamento) => supabase.from('documentos')
    .select('id, nome_arquivo, obrigacao_id, valor_guia, vencimento_guia, confirmado_em, '
      + 'obrigacoes(titulo, tipo, competencia, vencimento, tipos_obrigacao(eh_imposto))'
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

function mensagemAviso(cliente, lista, link) {
  const nome = nomeCurto(cliente.nome)
  if (!lista.length) {
    return [
      `Olá! O painel de *${nome}* foi atualizado pelo escritório.`,
      '',
      'Acesse para ver os impostos, as guias e as pendências:',
      link,
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
  linhas.push('', 'Acesse para ver o valor, baixar a guia ou copiar o código de pagamento:', link)
  return linhas.join('\n')
}

module.exports = { ehImposto, guiasNovas, mensagemAviso, tituloGuia, nomeCurto }
