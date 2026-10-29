// netlify/functions/lib/assessorChat.js
//
// Parte pura do chat do Assessor (assessor-chat-background.js): limpa o que
// veio do navegador, monta o pedido ao Claude com busca na web restrita a
// sites oficiais e lê a resposta (texto, fontes e, no modo "obrigacoes",
// a lista em JSON). Sem rede aqui, pra poder testar com node.

// Sites oficiais aceitos na busca (subdomínios entram junto: gov.br cobre
// receita, esocial, sped, sefaz dos estados, prefeituras .gov.br etc.)
const DOMINIOS_OFICIAIS = ['gov.br', 'leg.br', 'jus.br']

const MAX_MENSAGENS = 20
const MAX_TEXTO = 4000
const REGIMES = ['SN', 'MEI', 'LP', 'LR']

function limpar(v, max = MAX_TEXTO) {
  return String(v ?? '')
    // CPF/CNPJ/telefone com ou sem pontuação não saem do escritório
    .replace(/\d[\d.\-/\s]{9,}\d/g, '[removido]')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ')
    .slice(0, max)
    .trim()
}

function hojeIso(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : new Date().toISOString().slice(0, 10)
}

// ---------- entrada ----------

function sanitizarPedido(entrada) {
  if (!entrada || typeof entrada !== 'object') throw new Error('Pedido vazio.')
  const modo = entrada.modo === 'obrigacoes' ? 'obrigacoes' : 'chat'
  const hoje = hojeIso(entrada.hoje)

  if (modo === 'chat') {
    const mensagens = (Array.isArray(entrada.mensagens) ? entrada.mensagens : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-MAX_MENSAGENS)
      .map((m) => ({ role: m.role, content: limpar(m.content) }))
      .filter((m) => m.content)
    // a conversa tem que começar e terminar com o escritório falando
    while (mensagens.length && mensagens[0].role !== 'user') mensagens.shift()
    if (!mensagens.length || mensagens[mensagens.length - 1].role !== 'user') throw new Error('Falta a pergunta.')
    return { modo, hoje, mensagens }
  }

  const competencia = String(entrada.competencia || '')
  if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(competencia)) throw new Error('Competência inválida (use MM/AAAA).')
  const regimes = {}
  for (const r of REGIMES) {
    const n = Number(entrada.regimes?.[r])
    if (Number.isFinite(n) && n > 0) regimes[r] = Math.min(Math.floor(n), 1e5)
  }
  const existentes = (Array.isArray(entrada.existentes) ? entrada.existentes : [])
    .slice(0, 150).map((x) => limpar(x, 80)).filter(Boolean)
  return { modo, hoje, competencia, regimes, existentes }
}

// ---------- pedido ao Claude ----------

const SISTEMA_CHAT = [
  'Você é o assessor fiscal e contábil de um escritório de contabilidade brasileiro (sistema Gestor).',
  'Responda em português do Brasil, de forma direta, para contadores.',
  'Baseie a resposta em fontes oficiais: use a ferramenta de busca, que só alcança sites oficiais',
  '(Receita Federal, Planalto, eSocial, SPED, Sefaz, prefeituras, Diário Oficial, tribunais).',
  'Cite a norma (lei, IN, resolução) e a data quando houver. Se não achar fonte oficial, diga isso',
  'claramente em vez de supor. Prazos e alíquotas mudam: prefira a versão mais recente da norma.',
  'Seja breve: no máximo uns 3 parágrafos curtos ou uma lista, salvo se pedirem detalhe.',
].join(' ')

function sistemaObrigacoes() {
  return [
    'Você é o assessor fiscal de um escritório de contabilidade brasileiro.',
    'Tarefa: listar as obrigações acessórias e guias federais (e o ICMS/ISS apenas como lembrete genérico)',
    'que um escritório precisa cumprir referentes à competência informada, para os regimes informados,',
    'com o vencimento oficial de cada uma. Use a busca para conferir na Agenda Tributária da Receita Federal',
    '(gov.br/receitafederal) e nas páginas oficiais (eSocial, SPED, FGTS Digital). Ajuste vencimentos que caem',
    'em fim de semana ou feriado conforme a regra oficial (antecipa ou prorroga).',
    'Responda SOMENTE com um bloco ```json contendo:',
    '{"obrigacoes":[{"nome":"...","regimes":["SN"|"MEI"|"LP"|"LR"],"vencimento":"AAAA-MM-DD"|null,',
    '"periodicidade":"mensal"|"trimestral"|"anual"|"eventual","fonte":"URL oficial","observacao":"curta",',
    '"ja_cadastrada":true|false}],"aviso":"curto, opcional"}.',
    'ja_cadastrada = true quando o nome bate com algum item da lista de obrigações que o escritório já usa.',
    'Não invente URL: use só endereços que a busca retornou.',
  ].join(' ')
}

const NOME_REGIME = { SN: 'Simples Nacional', MEI: 'MEI', LP: 'Lucro Presumido', LR: 'Lucro Real' }

function mensagemObrigacoes(p) {
  const regimes = Object.entries(p.regimes)
    .map(([r, n]) => `${NOME_REGIME[r]} (${n} empresa${n !== 1 ? 's' : ''})`).join(', ') || 'não informado'
  return [
    `Hoje é ${p.hoje}. Competência: ${p.competencia}.`,
    `Regimes das empresas do escritório: ${regimes}.`,
    `Obrigações que o escritório já cadastrou: ${p.existentes.join('; ') || 'nenhuma'}.`,
  ].join('\n')
}

function montarPedido(p, modelo) {
  const ferramentas = [{
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: p.modo === 'obrigacoes' ? 6 : 4,
    allowed_domains: DOMINIOS_OFICIAIS,
    user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' },
  }]
  const sistema = p.modo === 'obrigacoes'
    ? sistemaObrigacoes()
    : `${SISTEMA_CHAT} Hoje é ${p.hoje}.`
  const mensagens = p.modo === 'obrigacoes'
    ? [{ role: 'user', content: mensagemObrigacoes(p) }]
    : p.mensagens
  return {
    model: modelo,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: sistema,
    tools: ferramentas,
    messages: mensagens,
  }
}

// ---------- leitura da resposta ----------

function textoDaResposta(r) {
  return (r?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}

// URLs citadas no texto (citações da busca). Só domínios oficiais.
function fontesDaResposta(r) {
  const vistas = new Map()
  for (const b of r?.content || []) {
    if (b.type !== 'text' || !Array.isArray(b.citations)) continue
    for (const c of b.citations) {
      if (!c?.url || vistas.has(c.url) || !urlOficial(c.url)) continue
      vistas.set(c.url, { url: c.url, titulo: limpar(c.title || c.url, 160) })
    }
  }
  return [...vistas.values()].slice(0, 12)
}

function urlOficial(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return /^https?:$/.test(new URL(url).protocol)
      && DOMINIOS_OFICIAIS.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

// Lista de obrigações do bloco ```json (modo "obrigacoes"). Tolera texto em volta.
function lerObrigacoes(texto) {
  const bloco = /```(?:json)?\s*([\s\S]*?)```/i.exec(texto)
  let bruto = bloco ? bloco[1] : texto
  const ini = bruto.indexOf('{')
  const fim = bruto.lastIndexOf('}')
  if (ini < 0 || fim < ini) throw new Error('A resposta não trouxe a lista de obrigações.')
  bruto = bruto.slice(ini, fim + 1)
  const json = JSON.parse(bruto)
  const lista = (Array.isArray(json.obrigacoes) ? json.obrigacoes : [])
    .filter((o) => o && typeof o.nome === 'string' && o.nome.trim())
    .slice(0, 60)
    .map((o) => ({
      nome: limpar(o.nome, 120),
      regimes: (Array.isArray(o.regimes) ? o.regimes : []).filter((r) => REGIMES.includes(r)),
      vencimento: /^\d{4}-\d{2}-\d{2}$/.test(o.vencimento || '') ? o.vencimento : null,
      periodicidade: ['mensal', 'trimestral', 'anual', 'eventual'].includes(o.periodicidade) ? o.periodicidade : 'mensal',
      fonte: urlOficial(o.fonte) ? o.fonte : null,
      observacao: limpar(o.observacao, 240),
      ja_cadastrada: o.ja_cadastrada === true,
    }))
    .sort((a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999')))
  return { obrigacoes: lista, aviso: limpar(json.aviso, 300) }
}

module.exports = {
  DOMINIOS_OFICIAIS, sanitizarPedido, montarPedido, textoDaResposta, fontesDaResposta, lerObrigacoes, urlOficial,
}
