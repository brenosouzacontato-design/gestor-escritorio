// netlify/functions/whatsapp-grupos.js
//
// Lista os grupos de WhatsApp em que o número do escritório (instância da
// Evolution API) está, para escolher o grupo de entrega de uma empresa pelo
// nome (Central de Entregas → Empresas → "Escolher grupo").
//
//   GET → { grupos: [{ id: '…@g.us', nome, membros }] } | { error }
// Exige login do escritório.

const { exigirEscritorio } = require('./lib/autenticacao')

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return resposta(405, { error: 'Método não permitido, use GET.' })
  const negado = await exigirEscritorio(event, 'whatsapp-grupos')
  if (negado) return negado
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE) {
    return resposta(500, { error: 'WhatsApp não configurado (EVOLUTION_API_URL/KEY/INSTANCE).' })
  }

  const controller = new AbortController()
  // com muitos grupos a Evolution demora; o Netlify corta em ~26s
  const timer = setTimeout(() => controller.abort(), 22000)
  try {
    const url = `${EVOLUTION_URL}/group/fetchAllGroups/${EVOLUTION_INSTANCE}?getParticipants=false`
    const resp = await fetch(url, { headers: { apikey: EVOLUTION_KEY }, signal: controller.signal })
    const corpo = await resp.text().catch(() => '')
    if (!resp.ok) return resposta(502, { error: `WhatsApp não listou os grupos (${resp.status}): ${corpo.slice(0, 200)}` })
    let lista = []
    try { lista = JSON.parse(corpo) } catch { /* corpo inválido */ }
    if (!Array.isArray(lista)) lista = Array.isArray(lista?.groups) ? lista.groups : []
    const grupos = lista
      .filter((g) => /@g\.us$/.test(String(g?.id || '')))
      .map((g) => ({ id: g.id, nome: g.subject || g.name || '(sem nome)', membros: g.size ?? (Array.isArray(g.participants) ? g.participants.length : null) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    return resposta(200, { grupos })
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'O WhatsApp demorou demais para listar os grupos. Tente de novo.' : e.message
    console.error('whatsapp-grupos:', msg)
    return resposta(502, { error: msg })
  } finally {
    clearTimeout(timer)
  }
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
