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
// Também aceita certidões (CND) federal, estadual ou municipal: devolve
// `tipoDocumento` ('relatorio' | 'cnd_federal' | 'cnd_estadual' |
// 'cnd_municipal' | 'outro') e `validade` — painelApi.js guarda a CND na
// esfera certa de cnd_manual e o PDF fica pro cliente baixar no painel.
//
// Variável de ambiente necessária no Netlify: ANTHROPIC_API_KEY
//
// Contrato de retorno (o que painelApi.js espera):
//   { dataEmissao: "YYYY-MM-DD"|null, situacaoGeral: "regular"|"pendente"|null,
//     debitos: [{tributo, competencia, vencimento, valorOriginal, valor, situacao}],
//     parcelamentos: [{modalidade, valor, parcelas}],
//     dividasAtivas: [{inscricao, tributo, competencia, valor, situacao}], clienteId: string|null, observacao: string }
//   `valor` é sempre o saldo devedor ATUALIZADO/consolidado (com multa e
//   juros) — é o que o cliente vê como pendência na página compartilhada
//   (PainelCompartilhadoPage.jsx).

const { exigirEscritorio } = require('./lib/autenticacao');
const { extrairSituacaoFiscal } = require('./lib/extrairSituacaoFiscal');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  const negado = await exigirEscritorio(event, 'extrair-situacao-fiscal');
  if (negado) return negado;

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

  try {
    return resposta(200, await extrairSituacaoFiscal({ pdfBase64, filename, clientes, apiKey }));
  } catch (e) {
    return resposta(e.status || 500, { error: e.message, ...(e.respostaBruta ? { respostaBruta: e.respostaBruta } : {}) });
  }
};

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
