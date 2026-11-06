// Trilha de progresso do fechamento de uma empresa numa competência — usada
// na visualização Tracker do Fechamento (Empresas.jsx) e no link da carteira
// (PainelCarteiraPage.jsx). Seis etapas, na ordem em que o mês anda:
//   0 Geradas            obrigações da competência criadas, nada feito
//   1 Em andamento       alguma obrigação concluída / não se aplica
//   2 Aguardando cliente marcado assim no Fechamento (cliente_entrega_competencia)
//   3 Concluído          todas concluídas / não se aplica, ou marcado "concluído"
//   4 Guias entregues    todas as guias anexadas enviadas pela Central de
//                        Entregas (ou marcadas à mão); sem guia anexada, vale
//                        a marcação manual de concluído do Fechamento
//   5 Cliente abriu      o cliente abriu pelo menos uma guia pelo painel
// Etapas 4 e 5 leem as colunas de documentos da Central de Entregas
// (entregue_em, aberto_em, entrega_erro — supabase-schema-central-entregas.sql).

export const ETAPAS_TRILHA = [
  { id: 'geradas', rotulo: 'Geradas' },
  { id: 'andamento', rotulo: 'Em andamento' },
  { id: 'aguardando', rotulo: 'Aguardando cliente' },
  { id: 'concluido', rotulo: 'Concluído' },
  { id: 'entregue', rotulo: 'Guias entregues' },
  { id: 'abriu', rotulo: 'Cliente abriu' },
]

const feita = (o) => o.status === 'concluido' || o.status === 'nao_aplica'

// Situação de uma guia anexada (linha de documentos), na ordem que interessa
export function situacaoEntregaGuia(g) {
  if (g.aberto_em) return 'aberta'
  if (g.entregue_em) return 'entregue'
  if (g.entrega_erro) return 'falhou'
  return 'a_entregar'
}

// obrigacoes: as da empresa NA competência ({ status })
// guias: documentos da empresa na competência ({ entregue_em, aberto_em, entrega_erro })
// marcadoConcluido / aguardando: marcação manual do Fechamento
export function trilhaEmpresa({ obrigacoes = [], guias = [], marcadoConcluido = false, aguardando = false }) {
  const total = obrigacoes.length
  const feitas = obrigacoes.filter(feita).length
  const vencidas = obrigacoes.filter((o) => o.status === 'vencido').length
  const sit = guias.map(situacaoEntregaGuia)
  const guiasTotal = guias.length
  const guiasAbertas = sit.filter((s) => s === 'aberta').length
  const guiasEnviadas = sit.filter((s) => s === 'aberta' || s === 'entregue').length
  const guiasFalhas = sit.filter((s) => s === 'falhou').length
  const base = { total, feitas, vencidas, guiasTotal, guiasEnviadas, guiasAbertas, guiasFalhas, vazia: total === 0 && !marcadoConcluido }

  const concluido = marcadoConcluido || (total > 0 && feitas === total)
  if (concluido) {
    const entregue = guiasTotal > 0 ? guiasEnviadas === guiasTotal : marcadoConcluido
    if (entregue) return { ...base, etapa: guiasAbertas > 0 ? 5 : 4, aguardando: false }
    // alguma aberta antes de todas irem: ainda falta entregar
    return { ...base, etapa: 3, aguardando: false }
  }
  if (aguardando) return { ...base, etapa: 2, aguardando: true }
  return { ...base, etapa: feitas > 0 ? 1 : 0, aguardando: false }
}

// Agrupa as guias por empresa: { [cliente_id]: [guia, ...] }
export function guiasPorEmpresa(guias = []) {
  const mapa = {}
  for (const g of guias) {
    if (!g.cliente_id) continue
    ;(mapa[g.cliente_id] ||= []).push(g)
  }
  return mapa
}

// Quantas empresas em cada etapa (para o funil / resumo)
export function contagemEtapas(trilhas) {
  const c = [0, 0, 0, 0, 0, 0]
  for (const t of trilhas) c[t.etapa]++
  return c
}
