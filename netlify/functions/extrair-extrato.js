// netlify/functions/extrair-extrato.js
//
// Recebe um PDF de extrato bancário (em base64) e devolve um array de
// transações estruturadas, usando o suporte nativo da API da Anthropic
// pra ler PDF (manda o arquivo direto, sem precisar extrair texto antes
// — funciona bem mesmo com extratos em formato de tabela).
//
// Variável de ambiente necessária no Netlify (Site settings > Environment
// variables): ANTHROPIC_API_KEY
//
// Contrato de retorno (o que ImportarExtratoTab.jsx espera):
//   [{ "data": "YYYY-MM-DD", "descricao": "...", "identificador": "..." | null, "valor": 123.45, "tipo": "entrada" | "saida" }]

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Você é um assistente que extrai transações de extratos bancários em PDF.
Devolva APENAS um JSON array, sem nenhum texto antes ou depois, sem markdown e sem crases, no formato exato:
[{"data":"YYYY-MM-DD","descricao":"string","identificador":"string ou null","valor":number,"tipo":"entrada"|"saida"}]

Regras:
- "valor" é sempre positivo (o sinal já fica representado pelo campo "tipo").
- "tipo" é "entrada" para créditos, depósitos, PIX recebido, transferências recebidas.
- "tipo" é "saida" para débitos, saques, pagamentos, PIX enviado, tarifas.
- "descricao": o tipo de operação + a contraparte (quem pagou/recebeu), limpo e legível, SEM códigos de controle internos do banco. Exemplo: se o extrato traz \`Pix enviado: "Cp :00360305-Eloiza Maria Goncalves Martins"\`, devolva descricao "Pix enviado - Eloiza Maria Goncalves Martins".
- "identificador": o código de controle/identificação da transação, se houver (número do PIX, "Cp :XXXXXXXX", nosso número de boleto, número do documento etc — só o código, sem o rótulo). No exemplo acima seria "00360305". Se o extrato não trouxer nenhum identificador pra aquela linha, use null — não invente um código.
- "data" no formato YYYY-MM-DD (assuma o ano correto pelo cabeçalho do extrato, se o dia/mês vier sozinho).
- Ignore linhas de saldo (saldo anterior, saldo do dia, saldo final), cabeçalho, rodapé e totalizadores — extraia só as transações individuais.
- Se não conseguir ler uma linha com confiança, não invente: pule essa linha em vez de adivinhar.
- Se o PDF não parecer um extrato bancário, devolva um array vazio: []`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  let pdfBase64, filename;
  try {
    const body = JSON.parse(event.body);
    pdfBase64 = body.pdfBase64;
    filename = body.filename ?? 'extrato.pdf';
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { pdfBase64, filename }.' });
  }

  if (!pdfBase64) {
    return resposta(400, { error: 'pdfBase64 não informado.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return resposta(500, { error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' });
  }

  try {
    const anthropicResp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              },
              { type: 'text', text: `Extraia todas as transações do extrato "${filename}".` },
            ],
          },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      return resposta(502, { error: `Erro na API da Anthropic (${anthropicResp.status}): ${errText}` });
    }

    const data = await anthropicResp.json();
    const texto = (data.content ?? [])
      .filter((bloco) => bloco.type === 'text')
      .map((bloco) => bloco.text)
      .join('');

    const limpo = texto.replace(/```json|```/g, '').trim();

    let transacoes;
    try {
      transacoes = JSON.parse(limpo);
    } catch {
      return resposta(502, {
        error: 'Não consegui interpretar a resposta do modelo como JSON.',
        respostaBruta: texto.slice(0, 2000),
      });
    }

    if (!Array.isArray(transacoes)) {
      return resposta(502, { error: 'A resposta do modelo não veio como array.' });
    }

    return resposta(200, transacoes);
  } catch (e) {
    return resposta(500, { error: e.message });
  }
};

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
