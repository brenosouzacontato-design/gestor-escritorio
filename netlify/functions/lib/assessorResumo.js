// netlify/functions/lib/assessorResumo.js
//
// Parte pura do "Resumo do assessor" (assessor-resumo.js): limpa o que veio
// do navegador e monta o pedido ao Claude. Só números e títulos de cards
// entram; qualquer sequência que pareça CPF/CNPJ/telefone é apagada.

const NIVEIS = ['urgente', 'atencao', 'dica']
const TIPOS = ['reforma', 'uso', 'dica']
const MAX_CARDS = 40

function texto(v, max = 200) {
  return String(v ?? '')
    // CPF/CNPJ/telefone com ou sem pontuação
    .replace(/\d[\d.\-/\s]{9,}\d/g, '[removido]')
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, max)
    .trim()
}

function inteiro(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 1e6) : 0
}

function sanitizarResumo(entrada) {
  if (!entrada || typeof entrada !== 'object') throw new Error('Resumo vazio.')
  const ind = entrada.indicadores || {}
  const porRegime = {}
  for (const [k, v] of Object.entries(ind.porRegime || {})) {
    if (/^[A-Za-z_]{1,20}$/.test(k)) porRegime[k] = inteiro(v)
  }
  const cards = (Array.isArray(entrada.cards) ? entrada.cards : [])
    .filter((c) => c && NIVEIS.includes(c.nivel) && TIPOS.includes(c.tipo))
    .slice(0, MAX_CARDS)
    .map((c) => ({
      id: texto(c.id, 60),
      tipo: c.tipo,
      nivel: c.nivel,
      titulo: texto(c.titulo),
      clientesAfetados: inteiro(c.clientesAfetados),
    }))
  return {
    hoje: /^\d{4}-\d{2}-\d{2}$/.test(entrada.hoje) ? entrada.hoje : new Date().toISOString().slice(0, 10),
    etapaReforma: texto(entrada.etapaReforma, 80),
    indicadores: {
      clientes: inteiro(ind.clientes),
      porRegime,
      empresasNfse: inteiro(ind.empresasNfse),
      obrigacoesAbertas: inteiro(ind.obrigacoesAbertas),
      notasEmAberto: inteiro(ind.notasEmAberto),
    },
    cards,
  }
}

const SISTEMA = [
  'Você é o assessor de um escritório de contabilidade brasileiro que usa o sistema Gestor',
  '(obrigações por competência, guias de imposto, painel do cliente, emissão de NFS-e em lote).',
  'Recebe um resumo em JSON com indicadores e alertas já calculados pelo sistema.',
  'Escreva em português do Brasil, direto, para o dono do escritório.',
  'Formato: até 5 prioridades da semana em lista numerada, cada uma com uma frase do que fazer e por quê;',
  'depois, uma linha "De olho na Reforma:" com o ponto da Reforma Tributária mais relevante para essa carteira.',
  'Use só o que está no JSON. Não invente prazos, números ou nomes de clientes. Sem títulos nem markdown além da lista.',
].join(' ')

function montarPedido(resumo, modelo) {
  return {
    model: modelo,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: SISTEMA,
    messages: [{ role: 'user', content: JSON.stringify(resumo) }],
  }
}

function textoDaResposta(resposta) {
  if (resposta?.stop_reason === 'refusal') return null
  return (resposta?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null
}

module.exports = { sanitizarResumo, montarPedido, textoDaResposta, SISTEMA }
