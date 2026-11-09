// netlify/functions/lib/whatsapp.js
//
// Envio de mensagem de texto via Evolution API (WhatsApp), extraído de
// whatsapp-webhook.js pra ser reaproveitado também por lembretes-cron.js
// sem duplicar a chamada HTTP.
//
// Variáveis de ambiente necessárias no Netlify:
//   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE

// Evolution API 1.x × 2.x: a 2.x (biblioteca do WhatsApp atualizada — a 1.8.7
// manda mensagens que o celular do cliente não consegue abrir, "Aguardando
// mensagem") mudou o corpo do envio: texto solto em `text` e mídia sem o
// `mediaMessage` aninhado. A versão vem de EVOLUTION_API_VERSAO ("1" ou "2")
// ou, sem ela, do que a própria Evolution informa em GET / — assim a troca
// do servidor não exige mexer no código nem no Netlify.
let versaoDetectada = null
async function versaoEvolution() {
  const fixa = String(process.env.EVOLUTION_API_VERSAO || '').trim()
  if (fixa) return fixa.startsWith('1') ? 1 : 2
  if (versaoDetectada) return versaoDetectada
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const resp = await fetch(`${EVOLUTION_URL}/`, { headers: { apikey: EVOLUTION_KEY }, signal: controller.signal })
    const json = await resp.json()
    const maior = parseInt(String(json?.version || ''), 10)
    if (maior >= 1) versaoDetectada = maior >= 2 ? 2 : 1
  } catch (e) {
    console.warn('Evolution API: não deu pra descobrir a versão, usando o formato da 1.x:', e.message)
  } finally {
    clearTimeout(timer)
  }
  return versaoDetectada || 1
}

function corpoTexto(versao, numero, texto) {
  return versao >= 2
    ? { number: numero, text: texto }
    // 1.x exige o texto aninhado: um { number, text } solto volta 400
    // "instance requires property textMessage"
    : { number: numero, textMessage: { text: texto } }
}

function corpoDocumento(versao, numero, { media, fileName, caption = '', mimetype = 'application/pdf' }) {
  const midia = { mediatype: 'document', mimetype, fileName, caption, media }
  return versao >= 2 ? { number: numero, ...midia } : { number: numero, mediaMessage: midia }
}

// Nunca lança exceção (os chamadores antigos — lembretes-cron.js,
// whatsapp-webhook.js — fazem "fire and forget" sem checar o retorno, e
// isso continua funcionando igual) mas agora devolve { sucesso, erro? } de
// verdade: antes, uma falha da Evolution API (número inválido, instância
// desconectada, erro 4xx/5xx) era só logada no console e o chamador achava
// que tinha dado certo — no módulo de Honorários isso fazia o lembrete ser
// marcado como enviado mesmo sem ter chegado no WhatsApp do cliente.
//
// Sempre loga o corpo da resposta (sucesso ou erro) — a Evolution API pode
// devolver HTTP 200/201 mesmo quando não consegue de fato entregar (ex:
// instância desconectada, número sem WhatsApp), então o status HTTP sozinho
// não é garantia total; o log dá visibilidade real de "o que a Evolution
// disse" pra investigar via Netlify Functions → Logs quando o status
// aparente (sucesso=true) não bater com a entrega de verdade.
async function enviarMensagem(numero, texto) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE) {
    const erro = 'EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE não configuradas.'
    console.error(erro)
    return { sucesso: false, erro }
  }
  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`
  // O Netlify mata a function inteira com 504 "Inactivity Timeout" depois
  // de ~29s sem resposta (teto fixo do API Gateway, não configurável) — se
  // a Evolution API/ngrok travar (ex: instância desconectada tentando
  // resolver um número/grupo, ou o túnel caiu), esse fetch sem timeout
  // ficava pendurado até isso acontecer. Como whatsapp-webhook.js chama
  // essa função DEPOIS de já ter gravado a tarefa/lembrete no banco, um
  // travamento aqui não devia arriscar derrubar a function inteira e levar
  // junto trabalho que já tinha sido feito com sucesso — por isso o
  // timeout curto, com erro claro em vez de pendurar.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify(corpoTexto(await versaoEvolution(), numero, texto)),
      signal: controller.signal,
    })
    const corpo = await resp.text().catch(() => '')
    console.log(`Evolution API sendText -> ${url} (número ${numero}), status ${resp.status}:`, corpo.slice(0, 500))
    if (!resp.ok) {
      // Um 404 com corpo em HTML (em vez do JSON de erro que a Evolution API
      // normalmente devolve) é sinal de que a chamada nem chegou nas rotas
      // da API — geralmente EVOLUTION_API_URL apontando pro lugar errado
      // (ex: o Manager/dashboard em vez do servidor da API) ou instância com
      // nome errado. Por isso a URL vai junto no erro: dá pra comparar com o
      // que a Evolution API realmente espera.
      const corpoPareceHtml = corpo.trim().startsWith('<')
      return { sucesso: false, erro: `Evolution API respondeu ${resp.status} em ${url}${corpoPareceHtml ? ' (página HTML, não a API — confira EVOLUTION_API_URL/EVOLUTION_INSTANCE)' : corpo ? `: ${corpo.slice(0, 200)}` : ''}` }
    }
    // Mesmo com 2xx, algumas instâncias devolvem um erro dentro do corpo
    // (ex: {"error": "..."} ou {"status": "ERROR"}) em vez de um status HTTP
    // de erro — confere isso também antes de considerar sucesso de verdade.
    let json = null
    try { json = JSON.parse(corpo) } catch { /* corpo pode não ser JSON */ }
    if (json?.error || json?.status === 'ERROR' || json?.status === 'error') {
      const detalhe = json.error || json.message || corpo.slice(0, 200)
      return { sucesso: false, erro: `Evolution API aceitou a chamada mas devolveu erro: ${detalhe}` }
    }
    // corpo vai junto mesmo no sucesso — a Evolution costuma devolver um
    // "status" (ex: PENDING) que só se confirma depois, de forma
    // assíncrona; como esse app não tem webhook de confirmação de entrega
    // configurado, esse corpo é a única pista de "o que aconteceu de
    // verdade" quando o envio aparenta sucesso mas a mensagem não chega.
    return { sucesso: true, corpo: corpo.slice(0, 500) }
  } catch (e) {
    const erro = e.name === 'AbortError' ? `Evolution API não respondeu em 10s (${url}) — travou ou o túnel/instância caiu.` : e.message
    console.error('Erro ao enviar mensagem:', erro)
    return { sucesso: false, erro }
  } finally {
    clearTimeout(timer)
  }
}

// Manda um arquivo (PDF da guia) com legenda — Central de Entregas
// (entregas-enviar.js). `media`: URL que a Evolution consegue baixar (link
// assinado do Storage) ou o conteúdo em base64. Mesmo contrato de
// enviarMensagem: nunca lança, devolve { sucesso, erro? }.
async function enviarDocumento(numero, { media, fileName, caption = '', mimetype = 'application/pdf' }) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !EVOLUTION_INSTANCE) {
    return { sucesso: false, erro: 'EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCE não configuradas.' }
  }
  const url = `${EVOLUTION_URL}/message/sendMedia/${EVOLUTION_INSTANCE}`
  const controller = new AbortController()
  // a Evolution baixa o arquivo antes de responder: mais folga que o texto
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify(corpoDocumento(await versaoEvolution(), numero, { media, fileName, caption, mimetype })),
      signal: controller.signal,
    })
    const corpo = await resp.text().catch(() => '')
    console.log(`Evolution API sendMedia (número ${numero}), status ${resp.status}:`, corpo.slice(0, 300))
    if (!resp.ok) return { sucesso: false, erro: `WhatsApp recusou o envio (${resp.status})${corpo ? `: ${corpo.slice(0, 200)}` : ''}` }
    let json = null
    try { json = JSON.parse(corpo) } catch { /* corpo pode não ser JSON */ }
    if (json?.error || json?.status === 'ERROR' || json?.status === 'error') {
      return { sucesso: false, erro: `WhatsApp devolveu erro: ${json.error || json.message || corpo.slice(0, 200)}` }
    }
    return { sucesso: true }
  } catch (e) {
    return { sucesso: false, erro: e.name === 'AbortError' ? 'O WhatsApp não respondeu em 20s.' : e.message }
  } finally {
    clearTimeout(timer)
  }
}

// Telefone do cadastro → número da Evolution. Aceita grupo (…@g.us) como está.
// "(11) 98888-7777" → "5511988887777". Devolve null quando não dá pra usar.
function numeroWhatsapp(valor) {
  const v = String(valor || '').trim()
  if (!v) return null
  if (/@g\.us$/.test(v)) return v
  let d = v.replace(/\D/g, '').replace(/^0+/, '')
  if (d.length === 10 || d.length === 11) d = `55${d}`
  return d.length >= 12 && d.length <= 13 ? d : null
}

module.exports = { enviarMensagem, enviarDocumento, numeroWhatsapp, versaoEvolution, corpoTexto, corpoDocumento }
