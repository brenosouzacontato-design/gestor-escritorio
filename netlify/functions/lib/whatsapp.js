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
  try {
    const resp = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ number: numero, text: texto })
    })
    const corpo = await resp.text().catch(() => '')
    console.log(`Evolution API sendText -> número ${numero}, status ${resp.status}:`, corpo.slice(0, 500))
    if (!resp.ok) {
      return { sucesso: false, erro: `Evolution API respondeu ${resp.status}${corpo ? `: ${corpo.slice(0, 200)}` : ''}` }
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
    console.error('Erro ao enviar mensagem:', e.message)
    return { sucesso: false, erro: e.message }
  }
}

module.exports = { enviarMensagem }
