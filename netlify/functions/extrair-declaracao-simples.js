// netlify/functions/extrair-declaracao-simples.js
//
// Recebe a Declaração do Simples Nacional (PDF, em base64) e devolve os
// números gerenciais principais dela, usando o suporte nativo da API da
// Anthropic pra ler PDF (mesmo padrão de extrair-extrato.js). Alimenta o
// painel consolidado do cliente (src/pages/painel/PainelClientePage.jsx).
//
// Opcionalmente recebe também `clientes` ([{id, nome, cnpj}]) — quando
// presente, pede pro modelo tentar identificar de qual cliente da lista é
// o documento (mesmo padrão de identificar-documento.js: casa por
// nome/CNPJ, "null" se não tiver certeza, nunca inventa). Usado pelo
// upload "detectar empresa" da topbar de Empresas.jsx — quando o upload
// já parte de dentro do modal de uma empresa conhecida, `clientes` não é
// enviado e `clienteId` simplesmente não aparece no retorno.
//
// Variável de ambiente necessária no Netlify: ANTHROPIC_API_KEY
//
// Contrato de retorno (o que painelApi.js espera):
//   { competencia: "MM/YYYY"|null, faturamentoPeriodo: number|null, rbt12: number|null,
//     aliquotaEfetiva: number|null, valorDas: number|null, anexo: string|null,
//     receitaPorTipo: [{tipo: 'normal'|'st'|'monofasico', valor: number}],
//     historicoReceita: [{competencia: "MM/YYYY", faturamento: number}],
//     municipio: string|null, dataAbertura: "YYYY-MM-DD"|null,
//     clienteId: string|null, observacao: string }
//
// municipio/dataAbertura alimentam o cadastro do cliente (só preenchidos se
// ainda estiverem vazios, ver uploadDeclaracaoSimples em painelApi.js) pro
// Comprovante de Faturamento (ComprovanteFaturamentoPage.jsx).

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

function montarSystemPrompt(temClientes) {
  return `Você é um assistente contábil brasileiro. Recebe uma Declaração do Simples Nacional (PGDAS-D ou extrato/relatório de apuração) e extrai os números gerenciais principais dela.${temClientes ? ' Também recebe uma lista de clientes cadastrados e precisa identificar de qual cliente da lista é o documento.' : ''}

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"competencia":"MM/YYYY ou null","faturamentoPeriodo":number|null,"rbt12":number|null,"aliquotaEfetiva":number|null,"valorDas":number|null,"anexo":"string ou null","receitaPorTipo":[{"tipo":"normal"|"st"|"monofasico","valor":number}],"historicoReceita":[{"competencia":"MM/YYYY","faturamento":number}],"municipio":"string ou null","dataAbertura":"YYYY-MM-DD ou null"${temClientes ? ',"clienteId":"id da lista ou null"' : ''},"observacao":"string curta"}

Regras:
- "competencia": o período de apuração do documento, formato MM/YYYY.
- "faturamentoPeriodo": receita bruta apurada naquela competência (só o número, sem "R$" nem separador de milhar — use ponto como separador decimal).
- "rbt12": receita bruta acumulada dos últimos 12 meses (RBT12), mesmo formato numérico.
- "aliquotaEfetiva": alíquota efetiva resultante, em percentual (ex: 6.5 pra 6,5%), calculada sobre o total da competência.
- "valorDas": valor total do DAS apurado/devido naquela competência.
- "anexo": o anexo do Simples Nacional em que a atividade está enquadrada (ex: "I", "II", "III", "IV", "V"), se identificável.
- "receitaPorTipo": se a declaração mostrar o faturamento segregado por tipo de receita (normal, com Substituição Tributária/ST, monofásico — comum em empresas de comércio/indústria com produtos sujeitos a esses regimes), devolva um item por tipo presente, com o valor de cada um. Se a declaração NÃO segregar por tipo (a maioria dos casos), devolva array vazio — não invente uma quebra que não está no documento.
- "historicoReceita": declarações do Simples Nacional (PGDAS-D) costumam trazer uma tabela com a receita bruta mês a mês dos últimos 12 períodos, usada no cálculo do RBT12. Se essa tabela existir no documento, devolva cada linha dela (competência + faturamento daquele mês). Se não houver essa tabela detalhada, array vazio — não invente valores de meses que não estão explícitos no documento.
- "municipio": município e UF da sede da empresa, formato "Cidade/UF" (ex: "Ribeirão das Neves/MG"), se aparecer no cabeçalho/dados do contribuinte do documento. null se não aparecer.
- "dataAbertura": data de abertura/início de atividade da empresa, formato YYYY-MM-DD, se aparecer no documento. null se não aparecer.${temClientes ? '\n- "clienteId": só preencha se o nome ou CNPJ do documento bater com um item da lista de clientes. Se não tiver certeza, null — não invente.' : ''}
- "observacao": uma frase curta com qualquer ressalva (ex: "documento parece ser só um resumo, RBT12 não veio explícito").
- Se não conseguir identificar um valor com confiança, use null pra ele — não invente números.
- Se o PDF não parecer uma declaração/apuração do Simples Nacional, devolva todos os campos numéricos como null, receitaPorTipo vazio, e explique em "observacao".`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  let pdfBase64, filename, clientes;
  try {
    const body = JSON.parse(event.body);
    pdfBase64 = body.pdfBase64;
    filename = body.filename ?? 'declaracao.pdf';
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
        max_tokens: 1024,
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
                  ? `Extraia os dados gerenciais da declaração "${filename}".\n\nClientes cadastrados:\n${listaClientes}`
                  : `Extraia os dados gerenciais da declaração "${filename}".`,
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
      competencia: extraido.competencia || null,
      faturamentoPeriodo: extraido.faturamentoPeriodo ?? null,
      rbt12: extraido.rbt12 ?? null,
      aliquotaEfetiva: extraido.aliquotaEfetiva ?? null,
      valorDas: extraido.valorDas ?? null,
      anexo: extraido.anexo || null,
      receitaPorTipo: Array.isArray(extraido.receitaPorTipo) ? extraido.receitaPorTipo : [],
      historicoReceita: Array.isArray(extraido.historicoReceita) ? extraido.historicoReceita : [],
      municipio: extraido.municipio || null,
      dataAbertura: extraido.dataAbertura || null,
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
