// netlify/functions/extrair-situacao-fiscal.js
//
// Recebe o Relatório de Situação Fiscal da RFB (PDF, em base64) e devolve
// os dados principais dele, usando o suporte nativo da API da Anthropic
// pra ler PDF (mesmo padrão de extrair-declaracao-simples.js). Alimenta o
// painel consolidado do cliente (src/pages/painel/PainelClientePage.jsx).
//
// Opcionalmente recebe também `clientes` ([{id, nome, cnpj}]) — quando
// presente, pede pro modelo tentar identificar de qual cliente da lista é
// o documento (mesmo padrão de identificar-documento.js: casa por
// nome/CNPJ, "null" se não tiver certeza, nunca inventa). Usado pelo
// upload "detectar empresa" da topbar de Empresas.jsx.
//
// Variável de ambiente necessária no Netlify: ANTHROPIC_API_KEY
//
// Contrato de retorno (o que painelApi.js espera):
//   { dataEmissao: "YYYY-MM-DD"|null, situacaoGeral: "regular"|"pendente"|null,
//     debitos: [{tributo, valor, situacao}], parcelamentos: [{modalidade, valor, parcelas}],
//     dividasAtivas: [{inscricao, valor, situacao}], clienteId: string|null, observacao: string }

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

function montarSystemPrompt(temClientes) {
  return `Você é um assistente contábil brasileiro. Recebe um Relatório de Situação Fiscal emitido pela Receita Federal (RFB) e extrai as informações principais dele.${temClientes ? ' Também recebe uma lista de clientes cadastrados e precisa identificar de qual cliente da lista é o documento.' : ''}

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"dataEmissao":"YYYY-MM-DD ou null","situacaoGeral":"regular"|"pendente"|null,"debitos":[{"tributo":"string","valor":number,"situacao":"string"}],"parcelamentos":[{"modalidade":"string","valor":number,"parcelas":"string"}],"dividasAtivas":[{"inscricao":"string","valor":number,"situacao":"string"}]${temClientes ? ',"clienteId":"id da lista ou null"' : ''},"observacao":"string curta"}

Regras:
- "dataEmissao": data em que o relatório foi gerado/emitido.
- "situacaoGeral": "regular" se o relatório indicar que não há pendências fiscais impeditivas, "pendente" se houver qualquer pendência/débito/irregularidade.
- "debitos": lista de débitos/pendências em aberto na Receita Federal (não inclui os já inscritos em Dívida Ativa). "tributo" é o nome/código do tributo ou débito, "valor" é o valor numérico (sem "R$", ponto como separador decimal), "situacao" é o status descrito no relatório (ex: "em cobrança", "exigibilidade suspensa").
- "parcelamentos": lista de parcelamentos ativos junto à RFB. "modalidade" é o tipo/nome do parcelamento, "parcelas" é o texto descrevendo parcelas pagas/total (ex: "12/60") se disponível.
- "dividasAtivas": lista de débitos já inscritos em Dívida Ativa da União (PGFN). "inscricao" é o número da inscrição, se houver.
- Se não houver nenhum item numa das três listas, devolva array vazio [], não null.${temClientes ? '\n- "clienteId": só preencha se o nome ou CNPJ do documento bater com um item da lista de clientes. Se não tiver certeza, null — não invente.' : ''}
- Se não conseguir identificar um campo com confiança, use null pra ele (ou [] pras listas) — não invente números ou textos.
- "observacao": uma frase curta com qualquer ressalva relevante.
- Se o PDF não parecer um Relatório de Situação Fiscal da RFB, devolva situacaoGeral null, listas vazias, e explique em "observacao".`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  let pdfBase64, filename, clientes;
  try {
    const body = JSON.parse(event.body);
    pdfBase64 = body.pdfBase64;
    filename = body.filename ?? 'situacao-fiscal.pdf';
    clientes = Array.isArray(body.clientes) ? body.clientes : null;
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

  const temClientes = !!(clientes && clientes.length > 0);
  const listaClientes = temClientes
    ? clientes.map((c) => `- id: ${c.id} | nome: ${c.nome} | cnpj: ${c.cnpj || '—'}`).join('\n')
    : '';

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
        max_tokens: 2048,
        system: montarSystemPrompt(temClientes),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
              },
              {
                type: 'text',
                text: temClientes
                  ? `Extraia os dados do Relatório de Situação Fiscal "${filename}".\n\nClientes cadastrados:\n${listaClientes}`
                  : `Extraia os dados do Relatório de Situação Fiscal "${filename}".`,
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

    let extraido;
    try {
      extraido = JSON.parse(limpo);
    } catch {
      return resposta(502, {
        error: 'Não consegui interpretar a resposta do modelo como JSON.',
        respostaBruta: texto.slice(0, 2000),
      });
    }

    return resposta(200, {
      dataEmissao: extraido.dataEmissao || null,
      situacaoGeral: extraido.situacaoGeral || null,
      debitos: Array.isArray(extraido.debitos) ? extraido.debitos : [],
      parcelamentos: Array.isArray(extraido.parcelamentos) ? extraido.parcelamentos : [],
      dividasAtivas: Array.isArray(extraido.dividasAtivas) ? extraido.dividasAtivas : [],
      clienteId: temClientes ? (extraido.clienteId || null) : null,
      observacao: extraido.observacao || '',
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
