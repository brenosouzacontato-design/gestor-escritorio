// netlify/functions/identificar-documento.js
//
// Handler HTTP usado por DocumentosPage.jsx (upload manual): recebe um
// documento (PDF ou imagem, em base64) mais a lista de "candidatos" e
// devolve a sugestão de identificação. A lógica de fato (chamada à Claude)
// mora em lib/identificarDocumento.js, reaproveitada também por
// whatsapp-webhook.js pros documentos que chegam pelo grupo "Documentos".
//
// IMPORTANTE: isso só SUGERE — quem confirma e aplica a baixa é o usuário
// em DocumentosPage.jsx (aba "A revisar"), chamando confirmarDocumento
// (documentosApi.js).
//
// Variável de ambiente necessária no Netlify: ANTHROPIC_API_KEY
//
// Contrato de retorno (o que DocumentosPage.jsx espera):
//   { tipoDocumento: string, clienteId: string|null, candidatoId: string|null,
//     confianca: "alta"|"media"|"baixa", observacao: string }

const { identificarDocumento } = require('./lib/identificarDocumento');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  let arquivoBase64, filename, mimeType, candidatos;
  try {
    const body = JSON.parse(event.body);
    arquivoBase64 = body.arquivoBase64;
    filename = body.filename ?? 'documento';
    mimeType = body.mimeType ?? 'application/pdf';
    candidatos = Array.isArray(body.candidatos) ? body.candidatos : [];
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { arquivoBase64, filename, mimeType, candidatos }.' });
  }

  if (!arquivoBase64) {
    return resposta(400, { error: 'arquivoBase64 não informado.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return resposta(500, { error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' });
  }

  try {
    const sugestao = await identificarDocumento({ arquivoBase64, filename, mimeType, candidatos, apiKey });
    return resposta(200, sugestao);
  } catch (e) {
    return resposta(502, { error: e.message });
  }
};

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
