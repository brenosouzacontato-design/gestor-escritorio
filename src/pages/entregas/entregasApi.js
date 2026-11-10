// entregasApi.js — Central de Entregas
// Guias anexadas (tabela documentos) de uma competência: as das obrigações
// da competência + as de parcelamento que vencem no mês seguinte (o mês em
// que tudo daquela competência é entregue) + as guias anexadas fora de uma
// obrigação (numa tarefa, ex. "Recalcular guia", ou soltas) da tarefa da
// competência ou anexadas/vencendo no mês seguinte. Entrega pelo WhatsApp do
// escritório em netlify/functions/entregas-enviar.js; colunas em
// supabase-schema-central-entregas.sql.
import { supabase, cabecalhosFunctions } from '../../lib/supabase'

// "10/2026" → ['2026-11-01', '2026-12-01'] (mês seguinte à competência)
function mesDeEntrega(competencia) {
  const [m, a] = competencia.split('/').map(Number)
  const ini = new Date(Date.UTC(a, m, 1))
  const fim = new Date(Date.UTC(a, m + 1, 1))
  return [ini.toISOString().slice(0, 10), fim.toISOString().slice(0, 10)]
}

// Documento sem obrigação nem parcelamento é guia? Pelo que a IA leu (valor
// ou vencimento da guia) ou pelo nome/tipo — extrato, nota, comprovante e
// planilha anexados numa tarefa ficam de fora.
const PARECE_GUIA = /(pg)?das|guia|darf|inss|fgts|dctfweb|gps|dae|parcelamento|boleto|icms|iss|simples nacional|pgmei|irrf|recolhimento/i
const NAO_GUIA = /comprovante|extrato|nota fiscal|nfs-?e|planilha|certid|of[ií]cio|contrato|recibo/i
export function pareceGuia(d) {
  if (d.vencimento_guia || d.valor_guia != null) return true
  const texto = `${d.tipo_documento_sugerido || ''} ${d.nome_arquivo || ''} ${d.tarefas?.titulo || ''}`
  return PARECE_GUIA.test(texto) && !NAO_GUIA.test(`${d.tipo_documento_sugerido || ''} ${d.nome_arquivo || ''}`)
}

// Guias anexadas numa tarefa ou soltas (sem obrigação/parcelamento)
async function guiasForaDeObrigacao(competencia, ini, fim) {
  const [m, a] = competencia.split('/').map(Number)
  const inicioComp = new Date(Date.UTC(a, m - 1, 1)).toISOString().slice(0, 10)
  const consulta = (comParcelamento) => {
    let q = supabase.from('documentos')
      .select('*, clientes!inner(*), tarefas(titulo, competencia, vencimento)')
      .is('obrigacao_id', null)
      .eq('status', 'confirmado')
      .gte('created_at', inicioComp).lt('created_at', fim)
    if (comParcelamento) q = q.is('parcelamento_id', null)
    return q
  }
  let { data, error } = await consulta(true)
  if (error && /parcelamento/i.test(error.message || '')) ({ data, error } = await consulta(false))
  if (error) return []
  return (data || []).filter((d) => {
    if (!pareceGuia(d)) return false
    const venc = d.vencimento_guia ? String(d.vencimento_guia).slice(0, 10) : null
    if (d.tarefas?.competencia) return d.tarefas.competencia === competencia
    if (venc) return venc >= ini && venc < fim
    return String(d.created_at).slice(0, 10) >= ini
  })
}

export async function listarGuias(competencia) {
  const [ini, fim] = mesDeEntrega(competencia)
  const [obrig, parc, fora] = await Promise.all([
    supabase.from('documentos')
      .select('*, clientes!inner(*), obrigacoes!inner(id, titulo, tipo, competencia, vencimento)')
      .eq('obrigacoes.competencia', competencia)
      .eq('status', 'confirmado'),
    supabase.from('documentos')
      .select('*, clientes!inner(*), parcelamentos(origem, descricao)')
      .not('parcelamento_id', 'is', null)
      .gte('vencimento_guia', ini).lt('vencimento_guia', fim),
    guiasForaDeObrigacao(competencia, ini, fim),
  ])
  if (obrig.error) throw obrig.error
  // parcelamentos: coluna pode não existir num banco antigo — só não entra
  const todas = [...(obrig.data || []), ...(parc.error ? [] : parc.data || []), ...fora]
  const vistas = new Set()
  return todas
    .filter((d) => (vistas.has(d.id) ? false : vistas.add(d.id)))
    .filter((d) => d.clientes?.ativo !== false)
    .map((d) => ({
      ...d,
      titulo: d.obrigacoes?.titulo || d.obrigacoes?.tipo
        || (d.parcelamentos ? `Parcelamento ${d.parcelamentos.origem || ''}`.trim() : d.tipo_documento_sugerido || d.tarefas?.titulo || d.nome_arquivo),
      vencimento: d.vencimento_guia || d.obrigacoes?.vencimento || null,
      // de onde veio a guia, quando não é de uma obrigação/parcelamento
      origem: d.obrigacoes || d.parcelamentos ? null : d.tarefas ? `tarefa: ${d.tarefas.titulo}` : 'anexo avulso',
    }))
    .sort((a, b) => (a.clientes.nome || '').localeCompare(b.clientes.nome || '') || a.titulo.localeCompare(b.titulo))
}

// Situação de entrega de uma guia, na ordem em que interessa ao escritório
export function situacaoGuia(d) {
  if (d.aberto_em) return 'aberta'          // baixou a guia ou copiou o PIX/código
  if (d.entregue_em && d.visto_em) return 'vista' // abriu o painel depois da entrega
  if (d.entregue_em) return 'entregue'
  if (d.entrega_erro) return 'falhou'
  return 'a_entregar'
}

export async function enviarGuia(documentoId, destino = null) {
  const resp = await fetch('/.netlify/functions/entregas-enviar', {
    method: 'POST', headers: await cabecalhosFunctions(), body: JSON.stringify({ documentoId, destino }),
  })
  const r = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(r.error || `Falha no envio (${resp.status}).`)
  return r
}

// Entregue por fora (e-mail, em mãos…) ou desfazer a marca
export async function marcarEntregaManual(documentoId, entregue) {
  const patch = entregue
    ? { entregue_em: new Date().toISOString(), entrega_canal: 'manual', entrega_erro: null }
    : { entregue_em: null, entrega_canal: null, entrega_destino: null }
  const { error } = await supabase.from('documentos').update(patch).eq('id', documentoId)
  if (error) throw error
}

// Entrega manual não tem como saber se o cliente abriu: o escritório
// confirma na mão (mesmas colunas da abertura pelo painel)
export async function confirmarAberturaManual(documentoId, confirmada) {
  const agora = new Date().toISOString()
  const patch = confirmada
    ? { aberto_em: agora, aberto_ultimo_em: agora }
    : { aberto_em: null, aberto_ultimo_em: null, aberto_vezes: 0 }
  const { error } = await supabase.from('documentos').update(patch).eq('id', documentoId)
  if (error) throw error
  return patch
}

export async function urlGuia(storagePath) {
  const { data, error } = await supabase.storage.from('documentos').createSignedUrl(storagePath, 60 * 10)
  if (error) throw error
  return data.signedUrl
}

// Empresas ativas com o WhatsApp de entrega e o painel ligado/desligado
export async function listarEmpresasEntrega() {
  const { data, error } = await supabase.from('clientes').select('*').eq('ativo', true).order('nome')
  if (error) throw error
  return data || []
}

export async function salvarEmpresaEntrega(clienteId, patch) {
  const { error } = await supabase.from('clientes').update(patch).eq('id', clienteId)
  if (error) {
    if (['42703', 'PGRST204'].includes(error.code)) {
      throw new Error('Falta rodar supabase-schema-central-entregas.sql no Supabase.')
    }
    throw error
  }
}
