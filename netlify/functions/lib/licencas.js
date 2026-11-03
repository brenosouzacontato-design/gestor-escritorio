// netlify/functions/lib/licencas.js
//
// Regras dos avisos de vencimento de alvarás/licenças (tabela licencas,
// supabase-schema-licencas.sql), usadas pelo lembretes-cron.js. Funções
// puras: recebem a data de hoje (AAAA-MM-DD, fuso de São Paulo) para
// poderem ser testadas.

const NOMES_TIPO = {
  funcionamento: 'Alvará de funcionamento',
  sanitario: 'Alvará sanitário',
  bombeiros: 'AVCB / CLCB (bombeiros)',
  ambiental: 'Licença ambiental',
  outro: 'Licença',
}

function nomeLicenca(l) {
  if (l.tipo === 'outro') return l.descricao?.trim() || NOMES_TIPO.outro
  return NOMES_TIPO[l.tipo] || 'Licença'
}

// Dias de hoje até a validade (negativo = já venceu).
function diasAte(validade, hoje) {
  if (!validade) return null
  const ms = Date.parse(`${validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)
  return Math.round(ms / 86400000)
}

function hojeSaoPaulo(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora)
}

function horaSaoPaulo(agora = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(agora))
}

// Quais avisos já chegaram e ainda não foram mandados. Sempre existe o
// aviso do dia do vencimento (0). Se vários chegaram juntos (licença
// cadastrada já perto de vencer), manda uma mensagem só e marca todos.
// → { enviar: boolean, marcar: number[], dias }
function avisosPendentes(l, hoje) {
  const dias = diasAte(l.data_validade, hoje)
  if (dias === null || l.arquivada) return { enviar: false, marcar: [], dias }
  const enviados = new Set(l.avisos_enviados || [])
  const limites = [...new Set([...(l.avisos_dias || []), 0])].filter((n) => Number.isInteger(n) && n >= 0)
  const marcar = limites.filter((n) => dias <= n && !enviados.has(n)).sort((a, b) => b - a)
  return { enviar: marcar.length > 0, marcar, dias }
}

function dataBR(iso) {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function quando(dias) {
  if (dias < 0) return `venceu há ${-dias} dia${dias === -1 ? '' : 's'}`
  if (dias === 0) return 'vence hoje'
  return `vence em ${dias} dia${dias === 1 ? '' : 's'}`
}

const NOMES_ETAPA = {
  a_iniciar: 'renovação a iniciar',
  aguardando_cliente: 'aguardando documentos do cliente',
  protocolado: 'protocolado no órgão',
}

function textoAviso(l, dias) {
  const linhas = [
    `📄 *Licença ${dias <= 0 ? 'vencida' : 'vencendo'}*`,
    `${nomeLicenca(l)}${l.orgao ? ` · ${l.orgao}` : ''}`,
    `👤 ${l.clientes?.nome || 'Cliente'}`,
    `🗓️ ${quando(dias)} (${dataBR(l.data_validade)})`,
  ]
  if (l.etapa) linhas.push(`🔄 ${NOMES_ETAPA[l.etapa] || l.etapa}${l.protocolo ? ` · prot. ${l.protocolo}` : ''}`)
  else linhas.push('Renovação ainda não iniciada no Gestor (Clientes → Licenciamento).')
  return linhas.join('\n')
}

// Tarefa de renovação aberta no primeiro aviso, se a licença pede e ainda
// não tem tarefa nem renovação em andamento.
function deveCriarTarefa(l, pendentes) {
  return !!(pendentes.enviar && l.criar_tarefa && !l.tarefa_id && !l.etapa)
}

function dadosTarefa(l, dias) {
  return {
    cliente_id: l.cliente_id,
    titulo: `Renovar ${nomeLicenca(l)}`,
    descricao: `${quando(dias)} (${dataBR(l.data_validade)}).${l.orgao ? ` Órgão: ${l.orgao}.` : ''} Acompanhe em Clientes → Licenciamento.`,
    departamento: 'societario',
    prioridade: dias <= 30 ? 'alta' : 'media',
    vencimento: l.data_validade,
  }
}

module.exports = { NOMES_TIPO, nomeLicenca, diasAte, hojeSaoPaulo, horaSaoPaulo, avisosPendentes, textoAviso, deveCriarTarefa, dadosTarefa }
