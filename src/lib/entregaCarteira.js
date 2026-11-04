// Status de entrega de cada empresa na competência, igual ao Fechamento do
// gestor (Empresas.jsx → faseEmpresa): entregue quando o escritório marcou
// como entregue ou quando todas as obrigações da competência estão
// concluídas / não se aplica; aguardando cliente quando marcado assim;
// em andamento quando já tem alguma concluída; a fazer quando nada começou.
// Usado no link da carteira (PainelCarteiraPage.jsx), só para leitura.

export const STATUS_ENTREGA = {
  entregue:   { rotulo: 'Entregue',           cor: 'var(--ok)',     fundo: 'var(--ok-dim)' },
  aguardando: { rotulo: 'Aguardando cliente', cor: '#7C3AED',      fundo: 'rgba(124,58,237,.12)' },
  andamento:  { rotulo: 'Em andamento',       cor: 'var(--warn)',   fundo: 'var(--warn-dim)' },
  a_fazer:    { rotulo: 'A fazer',            cor: 'var(--text2)',  fundo: 'var(--surface2)' },
  sem_obrigacao: { rotulo: 'Sem obrigações',  cor: 'var(--text3)',  fundo: 'var(--surface2)' },
}

const feita = (o) => o.status === 'concluido' || o.status === 'nao_aplica'

// obrigacoes: lista de { cliente_id, competencia, status }
// entregas: lista de { cliente_id, entregue, aguardando_cliente, atualizado_em }
// Devolve { status, feitas, total, atualizadoEm }
export function statusEntregaEmpresa(clienteId, competencia, obrigacoes = [], entregas = []) {
  const obs = obrigacoes.filter((o) => o.cliente_id === clienteId && o.competencia === competencia)
  const feitas = obs.filter(feita).length
  const total = obs.length
  const marca = entregas.find((e) => e.cliente_id === clienteId)
  const base = { feitas, total, atualizadoEm: marca?.atualizado_em || null }
  if (marca?.entregue) return { ...base, status: 'entregue' }
  if (total > 0 && feitas === total) return { ...base, status: 'entregue' }
  if (marca?.aguardando_cliente) return { ...base, status: 'aguardando' }
  if (feitas > 0) return { ...base, status: 'andamento' }
  return { ...base, status: total === 0 ? 'sem_obrigacao' : 'a_fazer' }
}

// Contagem por status para o resumo do topo
export function resumoEntregas(empresas, competencia, obrigacoes, entregas) {
  const contagem = { entregue: 0, aguardando: 0, andamento: 0, a_fazer: 0, sem_obrigacao: 0 }
  for (const e of empresas) contagem[statusEntregaEmpresa(e.id, competencia, obrigacoes, entregas).status]++
  return contagem
}
