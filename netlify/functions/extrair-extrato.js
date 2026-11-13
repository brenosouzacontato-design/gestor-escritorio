// netlify/functions/extrair-extrato.js
//
// Recebe um PDF de extrato bancário (em base64) e devolve um array de
// transações estruturadas, usando o suporte nativo da API da Anthropic
// pra ler PDF (manda o arquivo direto, sem precisar extrair texto antes
// — funciona bem mesmo com extratos em formato de tabela). A leitura em si
// mora em lib/extrairExtratoIA.js (também usada pelo extrato que chega no
// grupo Documentos do WhatsApp).
//
// Variável de ambiente necessária no Netlify (Site settings > Environment
// variables): ANTHROPIC_API_KEY
//
// Contrato de retorno (o que ImportarExtratoTab.jsx espera):
//   { transacoes: [{ "data": "YYYY-MM-DD", "descricao": "...", "identificador": "..." | null, "valor": 123.45, "tipo": "entrada" | "saida" }], truncado }

const { exigirEscritorio } = require('./lib/autenticacao');
const { extrairTransacoesIA } = require('./lib/extrairExtratoIA');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  const negado = await exigirEscritorio(event, 'extrair-extrato');
  if (negado) return negado;

  let pdfBase64, filename;
  try {
    const body = JSON.parse(event.body);
    pdfBase64 = body.pdfBase64;
    filename = body.filename ?? 'extrato.pdf';
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { pdfBase64, filename }.' });
  }

  try {
    return resposta(200, await extrairTransacoesIA({ pdfBase64, filename, apiKey: process.env.ANTHROPIC_API_KEY }));
  } catch (e) {
    return resposta(e.status || 500, e.respostaBruta ? { error: e.message, respostaBruta: e.respostaBruta } : { error: e.message });
  }
};

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
