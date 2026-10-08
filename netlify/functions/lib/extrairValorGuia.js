// netlify/functions/lib/extrairValorGuia.js
//
// Lê uma guia de imposto (DAS, DARF, GPS/INSS, FGTS Digital, DCTFWeb, ISS,
// ICMS...) com a Claude e devolve o valor total a recolher e o vencimento.
// Usado por extrair-valor-guia.js pra preencher documentos.valor_guia, que
// a nova versão do painel do cliente (PainelCompartilhadoPage.jsx) mostra
// no lugar de "valor na guia".

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

const MIME_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const SYSTEM_PROMPT = `Você é um assistente de escritório contábil brasileiro. Recebe uma guia de recolhimento de imposto/contribuição (DAS, DAS-MEI, DARF, GPS, DCTFWeb, FGTS Digital/GRF, ISS, ICMS, parcelamento etc.) ou um comprovante de pagamento, e extrai o valor e o vencimento.

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"ehGuia":true|false,"valor":number|null,"vencimento":"YYYY-MM-DD ou null","observacao":"string curta"}

Regras:
- "valor": o VALOR TOTAL a pagar da guia (campo "Valor Total", "Total a recolher", "Valor a pagar", "Valor do documento" — já com multa e juros, se a guia trouxer). Se for comprovante de pagamento, o valor pago. Número sem "R$", ponto como separador decimal (ex: 1234.56). Se a guia tiver várias linhas/composição, use o total geral, nunca uma parcela isolada.
- "vencimento": a data limite de pagamento ("Pagar até", "Data de vencimento", "Vencimento"). Se só houver "Data de validade do cálculo", use essa.
- "ehGuia": false se o documento não for guia de recolhimento nem comprovante de pagamento (ex: holerite, relatório, recibo de entrega, declaração) — nesse caso valor e vencimento null.
- Se não conseguir ler um campo com confiança, null — nunca invente números.
- "observacao": uma frase curta (ex: "DARF IRRF, valor total com acréscimos").`;

async function extrairValorGuia({ arquivoBase64, mimeType, filename, apiKey }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada.');
  const conteudoArquivo = MIME_IMAGEM.includes(mimeType)
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: arquivoBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivoBase64 } };

  const resp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [conteudoArquivo, { type: 'text', text: `Guia: "${filename || 'guia'}".` }] }],
    }),
  });
  if (!resp.ok) throw new Error(`Erro na API da Anthropic (${resp.status}): ${await resp.text()}`);

  const data = await resp.json();
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let extraido;
  try {
    extraido = JSON.parse(texto.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error('Não consegui interpretar a resposta do modelo como JSON: ' + texto.slice(0, 300));
  }

  const valor = Number(extraido.valor);
  return {
    ehGuia: extraido.ehGuia !== false,
    valor: extraido.ehGuia !== false && Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null,
    vencimento: /^\d{4}-\d{2}-\d{2}$/.test(extraido.vencimento || '') ? extraido.vencimento : null,
    observacao: extraido.observacao || '',
  };
}

module.exports = { extrairValorGuia };
