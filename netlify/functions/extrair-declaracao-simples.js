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

const { exigirEscritorio } = require('./lib/autenticacao');
const { extrairDeclaracaoSimples } = require('./lib/extrairDeclaracaoSimples');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' });
  }

  const negado = await exigirEscritorio(event, 'extrair-declaracao-simples');
  if (negado) return negado;

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

  try {
    return resposta(200, await extrairDeclaracaoSimples({ pdfBase64, filename, clientes, apiKey }));
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
