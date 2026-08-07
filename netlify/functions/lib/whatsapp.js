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

async function enviarMensagem(numero, texto) {
  try {
    await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
      body: JSON.stringify({ number: numero, text: texto })
    })
  } catch (e) {
    console.error('Erro ao enviar mensagem:', e.message)
  }
}

module.exports = { enviarMensagem }
