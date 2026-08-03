// netlify/functions/identificar-documento.js
//
// Recebe um documento (PDF ou imagem, em base64) mais a lista de
// "candidatos" (etapas de obrigação em andamento + tarefas pendentes, de
// todos os clientes) e pede pro Claude identificar o documento e sugerir
// qual candidato ele resolve. Mesmo padrão do extrair-extrato.js (documento
// direto pro Claude, sem OCR prévio) e do whatsapp-webhook.js (lista de
// candidatos com id, o modelo escolhe o id certo ou null).
//
// IMPORTANTE: isso só SUGERE — quem confirma e aplica a baixa é o usuário
// em DocumentosPage.jsx, chamando confirmarDocumento (documentosApi.js).
//
// Variável de ambiente necessária no Netlify: ANTHROPIC_API_KEY
//
// Contrato de retorno (o que DocumentosPage.jsx espera):
//   { tipoDocumento: string, clienteId: string|null, candidatoId: string|null,
//     confianca: "alta"|"media"|"baixa", observacao: string }

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

const MIME_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const SYSTEM_PROMPT = `Você é um assistente de escritório contábil brasileiro. Recebe um documento (comprovante, guia, certidão, recibo etc) e uma lista de "candidatos" — obrigações e tarefas em aberto de vários clientes — e precisa: 1) identificar que tipo de documento é; 2) identificar de qual cliente ele é (comparando com a lista); 3) apontar qual candidato da lista esse documento resolve, se houver um.

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"tipoDocumento":"string","clienteId":"id da lista ou null","candidatoId":"id da lista ou null","confianca":"alta"|"media"|"baixa","observacao":"string curta"}

Regras:
- "tipoDocumento": descrição curta e objetiva do documento (ex: "Comprovante de pagamento do DAS", "Guia do FGTS", "Certidão Negativa de Débitos"). Se não conseguir identificar, use "Documento não identificado".
- "clienteId": só preencha se o nome do cliente (ou CNPJ) aparecer no documento e bater com um item da lista de candidatos. Se não tiver certeza, null — não invente.
- "candidatoId": só preencha se o tipo de documento corresponder claramente ao rótulo de um candidato daquele MESMO cliente (ex: documento é "guia do DAS" e existe candidato "PGDAS" do mesmo cliente). Se não achar correspondência clara, null.
- "confianca": "alta" só quando cliente E candidato foram identificados com bastante segurança; "media" quando um dos dois ficou incerto; "baixa" quando pouca coisa foi identificada.
- "observacao": uma frase curta explicando a escolha (ou por que ficou null).
- Se o arquivo não parecer um documento relevante pra um escritório de contabilidade, devolva tipoDocumento "Documento não identificado" e os dois ids null.`;

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

  const listaCandidatos = candidatos
    .map((c) => `- id: ${c.id} | cliente: ${c.clienteNome} (clienteId: ${c.clienteId}) | ${c.rotulo}`)
    .join('\n');

  const conteudoArquivo = MIME_IMAGEM.includes(mimeType)
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: arquivoBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivoBase64 } };

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              conteudoArquivo,
              {
                type: 'text',
                text: `Documento: "${filename}".\n\nCandidatos (obrigações/tarefas em aberto):\n${listaCandidatos || '(nenhum candidato em aberto no momento)'}`,
              },
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

    let sugestao;
    try {
      sugestao = JSON.parse(limpo);
    } catch {
      return resposta(502, {
        error: 'Não consegui interpretar a resposta do modelo como JSON.',
        respostaBruta: texto.slice(0, 2000),
      });
    }

    return resposta(200, {
      tipoDocumento: sugestao.tipoDocumento || 'Documento não identificado',
      clienteId: sugestao.clienteId || null,
      candidatoId: sugestao.candidatoId || null,
      confianca: sugestao.confianca || 'baixa',
      observacao: sugestao.observacao || '',
    });
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
