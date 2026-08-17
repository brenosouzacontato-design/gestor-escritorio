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
async function enviarMensagem(numero, texto) {
  try {
    const resp = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ number: numero, text: texto })
    })
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '')
      console.error(`Evolution API respondeu ${resp.status} ao enviar mensagem:`, corpo)
      return { sucesso: false, erro: `Evolution API respondeu ${resp.status}${corpo ? `: ${corpo.slice(0, 200)}` : ''}` }
    }
    return { sucesso: true }
  } catch (e) {
    console.error('Erro ao enviar mensagem:', e.message)
    return { sucesso: false, erro: e.message }
  }
}

module.exports = { enviarMensagem }
