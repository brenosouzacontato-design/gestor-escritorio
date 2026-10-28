// Categorias das mensagens do grupo do escritório no WhatsApp.
//
//   tarefa: ...      → cria uma tarefa
//   obrigação: ...   → cria uma obrigação (com as etapas do tipo)
//   reunião: ...     → cria uma reunião na Agenda do gestor
//   lembrete: ...    → cria uma tarefa com lembrete no WhatsApp na data/hora
//
// Aqui fica só a lógica pura (sem Supabase nem rede), testada em
// __tests__/comandosWhatsapp.test.cjs. Quem grava é whatsapp-webhook.js.

const FUSO = 'America/Sao_Paulo'
const OFFSET = '-03:00' // Brasil sem horário de verão desde 2019

// Prefixo (sem acento, minúsculo) → categoria
const PREFIXOS = {
  tarefa: 'tarefa',
  obrigacao: 'obrigacao',
  obrig: 'obrigacao',
  reuniao: 'reuniao',
  lembrete: 'lembrete',
  lembrar: 'lembrete',
}

const ROTULO = {
  tarefa: 'Tarefa',
  obrigacao: 'Obrigação',
  reuniao: 'Reunião',
  lembrete: 'Lembrete',
}

// Tira acento caractere a caractere (mantém o tamanho da string, para o
// índice do prefixo valer também no texto original).
function semAcento(s) {
  return [...String(s)].map((ch) => ch.normalize('NFD').replace(/\p{M}/gu, '')[0] || ch).join('')
}

// "Obrigação: DCTFWeb ..." → { categoria: 'obrigacao', texto: 'DCTFWeb ...' }
// Aceita negrito do WhatsApp (*reunião:*), maiúsculas, sem acento e
// separador ":" ou "-". Mensagem sem prefixo conhecido → null.
function detectarComando(mensagem) {
  const original = String(mensagem || '').normalize('NFC')
  const chave = semAcento(original).toLowerCase()
  const m = chave.match(/^\s*[*_~]*\s*([a-z]+)\s*[*_~]*\s*[:\-–]\s*[*_~]*\s*/)
  if (!m) return null
  const categoria = PREFIXOS[m[1]]
  if (!categoria) return null
  const texto = original.slice(m[0].length).replace(/[*_~]+\s*$/, '').trim()
  if (!texto) return null
  return { categoria, texto }
}

// ---------- datas ----------

function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

function horaSP(agora = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(agora)
}

function somarDias(iso, dias) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function dataValida(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T12:00:00Z')
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null
}

function horaValida(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function competenciaValida(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2})\/(\d{4})$/)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null
  return `${String(Number(m[1])).padStart(2, '0')}/${m[2]}`
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

// Data e hora escritas no texto, sem IA (plano B quando a IA falha):
// "hoje", "amanhã", "depois de amanhã", "sexta", "25/11", "25/11/2026",
// "14h", "14h30", "14:30", "às 9".
function extrairDataHora(texto, hoje) {
  const t = semAcento(String(texto || '')).toLowerCase()
  let data = null
  if (/depois de amanha/.test(t)) data = somarDias(hoje, 2)
  else if (/\bamanha\b/.test(t)) data = somarDias(hoje, 1)
  else if (/\bhoje\b/.test(t)) data = hoje
  if (!data) {
    const m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
    if (m) {
      const dia = Number(m[1]), mes = Number(m[2])
      let ano = m[3] ? Number(m[3]) : Number(hoje.slice(0, 4))
      if (ano < 100) ano += 2000
      let iso = dataValida(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`)
      // "05/01" escrito em dezembro é janeiro do ano que vem
      if (iso && !m[3] && iso < hoje) iso = dataValida(`${ano + 1}${iso.slice(4)}`)
      data = iso
    }
  }
  if (!data) {
    const idx = DIAS_SEMANA.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t))
    if (idx >= 0) {
      const atual = new Date(hoje + 'T12:00:00Z').getUTCDay()
      data = somarDias(hoje, ((idx - atual + 7) % 7) || 7)
    }
  }
  let hora = null
  const h = t.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?)(?!\/)/) || t.match(/\bas (\d{1,2})\b(?!\/)/)
  if (h) hora = horaValida(`${h[1]}:${h[2] || h[3] || '00'}`)
  return { data, hora }
}

// "2026-11-25" + "14:30" → "2026-11-25T14:30:00-03:00"
function dataHoraISO(data, hora) {
  return `${data}T${hora || '09:00'}:00${OFFSET}`
}

function dataBR(iso) {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

// Igual a calcularVencimento de src/pages/andamento/andamentoApi.js
function calcularVencimento(competencia, mesVencimento, diaVencimento) {
  const [mes, ano] = competencia.split('/').map(Number)
  let anoAlvo = ano, mesAlvo = mes
  if (mesVencimento === 'seguinte') {
    mesAlvo += 1
    if (mesAlvo > 12) { mesAlvo = 1; anoAlvo += 1 }
  }
  const ultimoDia = new Date(anoAlvo, mesAlvo, 0).getDate()
  const dia = Math.min(diaVencimento, ultimoDia)
  return `${anoAlvo}-${String(mesAlvo).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function competenciaDe(hoje) {
  return `${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`
}

// ---------- IA ----------

const DEPARTAMENTOS = ['fiscal', 'folha', 'societario', 'contabil']

function promptExtracao(categoria, texto, { clientes = [], tipos = [], hoje }) {
  const listaClientes = clientes.map((c) => `${c.nome} (id: ${c.id})`).join('\n')
  const listaTipos = tipos.map((t) => `${t.nome} (id: ${t.id})`).join('\n')
  const diaSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][new Date(hoje + 'T12:00:00Z').getUTCDay()]

  const campos = {
    tarefa: `  "titulo": "título curto e claro da tarefa",
  "cliente_id": "id exato do cliente da lista ou null",
  "prazo": "data YYYY-MM-DD ou null",
  "departamento": "fiscal" ou "folha" ou "societario" ou "contabil",
  "prioridade": "normal" ou "alta"`,
    lembrete: `  "titulo": "do que lembrar, curto e claro",
  "cliente_id": "id exato do cliente da lista ou null",
  "data": "dia do lembrete YYYY-MM-DD ou null",
  "hora": "hora do lembrete HH:MM (24h) ou null",
  "departamento": "fiscal" ou "folha" ou "societario" ou "contabil",
  "prioridade": "normal" ou "alta"`,
    reuniao: `  "titulo": "assunto da reunião, curto",
  "cliente_id": "id exato do cliente da lista ou null",
  "data": "dia da reunião YYYY-MM-DD ou null",
  "hora": "hora de início HH:MM (24h) ou null",
  "duracao_min": número de minutos ou null,
  "local": "local ou link da reunião, ou null"`,
    obrigacao: `  "titulo": "título curto da obrigação",
  "cliente_id": "id exato do cliente da lista ou null",
  "tipo_obrigacao_id": "id exato do tipo de obrigação da lista ou null",
  "competencia": "MM/YYYY ou null",
  "vencimento": "data YYYY-MM-DD ou null",
  "responsavel": "nome do responsável citado ou null"`,
  }[categoria]

  return `Você é um assistente de escritório contábil brasileiro. A mensagem abaixo veio do grupo do escritório no WhatsApp e é um(a) ${ROTULO[categoria].toLowerCase()}.

Hoje é ${diaSemana}, ${dataBR(hoje)}.

Clientes cadastrados:
${listaClientes || '(nenhum)'}
${categoria === 'obrigacao' ? `\nTipos de obrigação cadastrados:\n${listaTipos || '(nenhum)'}\n` : ''}
Mensagem: "${texto}"

Responda APENAS com JSON válido, sem markdown:
{
${campos}
}

Regras:
- Datas relativas ("amanhã", "sexta", "dia 25") são calculadas a partir de hoje; dia sem mês é o próximo dia com esse número.
- Se não identificar o cliente, cliente_id = null (não invente).${categoria === 'obrigacao' ? '\n- Se nenhum tipo da lista corresponder, tipo_obrigacao_id = null (não invente).' : ''}
- Se mencionar urgente/urgência, prioridade = alta.
- departamento: PGDAS/DAS/NFSe/fiscal = fiscal, folha/holerite/eSocial = folha, contrato/abertura/alteração = societario, restante = contabil.`
}

function parseJSONResposta(texto) {
  const limpo = String(texto || '').replace(/```json|```/g, '').trim()
  try { return JSON.parse(limpo) } catch { /* tenta achar o objeto */ }
  const m = limpo.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) : null
}

// Junta o que a IA devolveu (pode ser null, se falhou) com o que dá para
// tirar do texto, e valida ids, datas e horas. Nunca lança.
function normalizarExtracao(categoria, bruto, { texto, clientes = [], tipos = [], hoje, agora = new Date() }) {
  const ia = bruto && typeof bruto === 'object' ? bruto : {}
  const heur = extrairDataHora(texto, hoje)
  const idsClientes = new Set(clientes.map((c) => c.id))
  const idsTipos = new Set(tipos.map((t) => t.id))
  const titulo = String(ia.titulo || '').trim().slice(0, 150) || texto.slice(0, 100)
  const base = {
    categoria,
    titulo,
    cliente_id: idsClientes.has(ia.cliente_id) ? ia.cliente_id : null,
    departamento: DEPARTAMENTOS.includes(ia.departamento) ? ia.departamento : 'contabil',
    prioridade: ia.prioridade === 'alta' || /urgent/i.test(semAcento(texto)) ? 'alta' : 'normal',
  }

  if (categoria === 'tarefa') {
    return { ...base, prazo: dataValida(ia.prazo) || heur.data }
  }

  if (categoria === 'lembrete') {
    let data = dataValida(ia.data) || heur.data
    const hora = horaValida(ia.hora) || heur.hora || '09:00'
    if (!data) data = hora > horaSP(agora) ? hoje : somarDias(hoje, 1)
    return { ...base, data, hora, dataHora: dataHoraISO(data, hora) }
  }

  if (categoria === 'reuniao') {
    const data = dataValida(ia.data) || heur.data
    const hora = horaValida(ia.hora) || heur.hora
    const dur = Number(ia.duracao_min)
    return {
      ...base,
      data,
      hora,
      duracao_min: Number.isFinite(dur) && dur > 0 && dur <= 600 ? Math.round(dur) : null,
      local: ia.local ? String(ia.local).trim().slice(0, 200) : null,
    }
  }

  if (categoria === 'obrigacao') {
    const tipoId = idsTipos.has(ia.tipo_obrigacao_id) ? ia.tipo_obrigacao_id : null
    return {
      ...base,
      tipo_obrigacao_id: tipoId,
      competencia: competenciaValida(ia.competencia) || competenciaDe(hoje),
      vencimento: dataValida(ia.vencimento) || heur.data,
      responsavel: ia.responsavel ? String(ia.responsavel).trim().slice(0, 80) : null,
    }
  }

  return base
}

// Reunião: avisa 1 hora antes; sem hora, às 8h do dia.
function lembreteReuniao(data, hora) {
  if (!hora) return dataHoraISO(data, '08:00')
  const inicio = new Date(dataHoraISO(data, hora))
  return new Date(inicio.getTime() - 60 * 60 * 1000).toISOString()
}

// O que falta para a mensagem virar o que foi pedido. Lista vazia = ok.
// Quando falta algo, o webhook cria uma tarefa comum e avisa no grupo.
function pendencias(item) {
  if (item.categoria === 'obrigacao') {
    const falta = []
    if (!item.cliente_id) falta.push('o cliente')
    if (!item.tipo_obrigacao_id) falta.push('o tipo de obrigação (do jeito que está cadastrado no gestor)')
    return falta
  }
  if (item.categoria === 'reuniao' && !item.data) return ['o dia da reunião']
  return []
}

// ---------- confirmação no grupo ----------

function confirmacao(item, { nomeCliente, nomeTipo, falta = [] } = {}) {
  const cliente = `👤 ${nomeCliente || '⚠️ cliente não identificado'}`
  if (falta.length) {
    const virou = `${ROTULO[item.categoria]} não criada: faltou ${falta.join(' e ')}.`
    const prazo = item.prazo ? `\n📅 Prazo: ${dataBR(item.prazo)}` : ''
    // reenviar só resolve quando faltou algo na mensagem (não no cadastro/banco)
    const reenviar = falta.some((f) => /banco|etapas/.test(f)) ? '' : `\n\nPara criar certo, mande de novo com ${falta.join(' e ')}.`
    return `⚠️ ${virou}\n✅ Criei uma *tarefa* no lugar:\n📋 ${item.titulo}${prazo}\n${cliente}${reenviar}`
  }
  if (item.categoria === 'tarefa') {
    const prazo = item.prazo ? `\n📅 Prazo: ${dataBR(item.prazo)}` : ''
    return `✅ *Tarefa criada!*\n📋 ${item.titulo}${prazo}\n${cliente}`
  }
  if (item.categoria === 'lembrete') {
    return `🔔 *Lembrete criado!*\n📋 ${item.titulo}\n⏰ ${dataBR(item.data)} às ${item.hora}\n${cliente}\nAviso aqui no grupo na hora marcada.`
  }
  if (item.categoria === 'reuniao') {
    const quando = item.hora ? `${dataBR(item.data)} às ${item.hora}` : `${dataBR(item.data)} (sem hora definida)`
    const local = item.local ? `\n📍 ${item.local}` : ''
    return `📅 *Reunião marcada na Agenda!*\n📋 ${item.titulo}\n🕒 ${quando}${local}\n${cliente}\nAviso aqui no grupo ${item.hora ? '1 hora antes' : 'às 8h do dia'}.`
  }
  if (item.categoria === 'obrigacao') {
    const venc = item.vencimento ? `\n📅 Vencimento: ${dataBR(item.vencimento)}` : ''
    return `📌 *Obrigação criada!*\n📋 ${nomeTipo || item.titulo} — ${item.competencia}${venc}\n${cliente}`
  }
  return '✅ Registrado.'
}

module.exports = {
  ROTULO,
  detectarComando,
  hojeSP,
  horaSP,
  somarDias,
  extrairDataHora,
  dataHoraISO,
  dataBR,
  calcularVencimento,
  promptExtracao,
  parseJSONResposta,
  normalizarExtracao,
  lembreteReuniao,
  pendencias,
  confirmacao,
}
