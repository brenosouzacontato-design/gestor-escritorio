// Assessor: junta lembretes da Reforma, feedback de uso, dicas e notícias
// numa lista priorizada. Tudo puro (sem Supabase), para testar no Node.

import { isoDia } from './datas.js'
import { perfilCliente } from './perfil.js'
import { lembretesReforma } from './reforma.js'
import { feedbackUso } from './uso.js'
import { dicasRelevantes } from './dicas.js'
import { NOTICIAS, CRONOGRAMA, ATUALIZADO_EM, etapaAtual } from './noticias.js'

export const ORDEM_NIVEL = { urgente: 0, atencao: 1, dica: 2 }

export function montarAssessor(dados, hojeEntrada = new Date()) {
  const hoje = isoDia(hojeEntrada)
  const clientes = dados.clientes || []
  const empresas = new Map((dados.empresasNfse || []).map((e) => [e.cliente_id, e]))
  const perfis = clientes.map((c) => perfilCliente(c, empresas.get(c.id)))

  const indicadores = {
    clientes: perfis.length,
    porRegime: perfis.reduce((acc, p) => { const k = p.regime || 'sem_regime'; acc[k] = (acc[k] || 0) + 1; return acc }, {}),
    empresasNfse: perfis.filter((p) => p.nfse?.ativo).length,
    obrigacoesAbertas: (dados.obrigacoesAbertas || []).length,
    notasEmAberto: (dados.notas || []).length,
  }

  const cards = [
    ...lembretesReforma(perfis, hoje),
    ...feedbackUso({ ...dados, perfis }, hoje),
  ].sort((a, b) => ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel])

  const { fluxos, dicas } = dicasRelevantes(indicadores)
  const regimes = new Set(perfis.map((p) => p.regime).filter(Boolean))
  const noticias = NOTICIAS
    .filter((n) => !regimes.size || n.regimes.some((r) => regimes.has(r)))
    .sort((a, b) => b.data.localeCompare(a.data))

  return { hoje, perfis, indicadores, cards, fluxos, dicas, noticias, cronograma: CRONOGRAMA, etapa: etapaAtual(hoje), atualizadoEm: ATUALIZADO_EM }
}

// Só os cards de um cliente (filtro da tela).
export function cardsDoCliente(cards, clienteId) {
  if (!clienteId) return cards
  return cards.filter((c) => (c.clientes || []).some((x) => x.id === clienteId))
}

// O que vai para o Claude no "Resumo do assessor": só números e os títulos
// dos cards (que nunca levam nome de cliente). Nada de nome, CPF ou CNPJ.
export function resumoAnonimo(assessor) {
  return {
    hoje: assessor.hoje,
    etapaReforma: assessor.etapa?.titulo || '',
    indicadores: assessor.indicadores,
    cards: assessor.cards.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      nivel: c.nivel,
      titulo: c.titulo,
      clientesAfetados: (c.clientes || []).length,
    })),
  }
}
