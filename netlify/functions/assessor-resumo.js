// netlify/functions/assessor-resumo.js
//
// "Resumo do assessor": recebe os indicadores já calculados pela tela
// Assessor (src/lib/assessor) — só números e títulos de alertas, sem nomes,
// CPFs ou CNPJs — e pede ao Claude as prioridades da semana.
// Só roda quando alguém clica no botão (custo só nesse momento).
//
// Variável de ambiente: ANTHROPIC_API_KEY (a mesma das outras functions).
// Opcional: ASSESSOR_MODELO para trocar o modelo.

const Anthropic = require('@anthropic-ai/sdk');
const { exigirEscritorio } = require('./lib/autenticacao');
const { sanitizarResumo, montarPedido, textoDaResposta } = require('./lib/assessorResumo');

const MODELO = process.env.ASSESSOR_MODELO || 'claude-opus-5-5';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' });

  const negado = await exigirEscritorio(event, 'assessor-resumo');
  if (negado) return negado;

  let resumo;
  try {
    resumo = sanitizarResumo(JSON.parse(event.body || '{}').resumo);
  } catch (e) {
    return resposta(400, { error: `Body inválido: ${e.message}` });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return resposta(500, { error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' });
  }

  const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
  try {
    const r = await client.beta.messages.create({
      ...montarPedido(resumo, MODELO),
      // Se o modelo recusar, a própria API tenta outro modelo na mesma chamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const texto = textoDaResposta(r);
    if (!texto) return resposta(502, { error: 'O Claude não devolveu um resumo. Tente de novo.' });
    return resposta(200, { texto, modelo: r.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return resposta(429, { error: 'Muitas chamadas seguidas ao Claude. Tente em instantes.' });
    if (e instanceof Anthropic.AuthenticationError) return resposta(500, { error: 'ANTHROPIC_API_KEY inválida.' });
    if (e instanceof Anthropic.APIError) return resposta(502, { error: `Erro na API da Anthropic (${e.status ?? 'rede'}): ${e.message}` });
    console.error('assessor-resumo:', e);
    return resposta(500, { error: 'Falha ao gerar o resumo.' });
  }
};

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
