// Regras de prazo e arquivamento das tarefas (tela Tarefas).
// Sem dependências de React/Supabase, pra poder testar com node.

// Concluídas há pelo menos este número de dias saem do quadro e vão para "Arquivadas".
export const DIAS_PARA_ARQUIVAR = 7

const DIA_MS = 24 * 60 * 60 * 1000

function inicioDoDia(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// Data em que a tarefa foi concluída (tarefas antigas podem não ter concluida_em).
export function dataConclusao(t) {
  return t?.concluida_em || (t?.concluida ? t.updated_at : null) || null
}

// Dias inteiros desde a conclusão (null se não concluída).
export function diasDesdeConclusao(t, agora = new Date()) {
  const d = dataConclusao(t)
  if (!d) return null
  return Math.floor((inicioDoDia(agora) - inicioDoDia(d)) / DIA_MS)
}

export function estaArquivada(t, agora = new Date()) {
  const concluida = t?.kanban_status ? t.kanban_status === 'concluido' : !!t?.concluida
  if (!concluida) return false
  const dias = diasDesdeConclusao(t, agora)
  return dias !== null && dias >= DIAS_PARA_ARQUIVAR
}

// Situação do vencimento, pra cor e texto do selo de prazo no card.
// tipo: 'atrasada' | 'hoje' | 'breve' (até 3 dias) | 'futuro' | null
export function situacaoPrazo(vencimento, agora = new Date()) {
  if (!vencimento) return { tipo: null, dias: null, texto: '' }
  const [y, m, d] = String(vencimento).slice(0, 10).split('-').map(Number)
  const venc = new Date(y, m - 1, d)
  const dias = Math.round((venc - inicioDoDia(agora)) / DIA_MS)
  if (dias < 0) return { tipo: 'atrasada', dias, texto: dias === -1 ? 'Atrasada há 1 dia' : `Atrasada há ${-dias} dias` }
  if (dias === 0) return { tipo: 'hoje', dias, texto: 'Vence hoje' }
  if (dias === 1) return { tipo: 'breve', dias, texto: 'Vence amanhã' }
  if (dias <= 3) return { tipo: 'breve', dias, texto: `Vence em ${dias} dias` }
  return { tipo: 'futuro', dias, texto: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}` }
}
