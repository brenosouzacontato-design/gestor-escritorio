// netlify/functions/identificar-lancamentos.js
//
// IA sugere a conta contábil dos lançamentos que ficaram em "Valores a
// Identificar" depois da importação do extrato. A tela (aba Lançamentos >
// "Identificar com NFs e IA", src/pages/contabil/IdentificarIAModal.jsx)
// primeiro casa o que dá com as NFs de entrada (src/lib/identificarLancamentos.js)
// e manda o resto pra cá agrupado por contraparte, em lotes pequenos —
// uma chamada por lote, pra caber no tempo de uma function síncrona.
//
// Body: { empresaNome, contas: [{codigo, nome, tipo}], grupos: [{chave,
//   contraparte, natureza, qtd, total, exemplos, fornecedorNf}], regras:
//   [{padrao, conta_codigo}] }
// Resposta: { sugestoes: [{ chave, conta_codigo, confianca, motivo }], modelo }
//
// Variáveis: ANTHROPIC_API_KEY; opcional IDENTIFICAR_MODELO.

const Anthropic = require('@anthropic-ai/sdk');
const { exigirEscritorio } = require('./lib/autenticacao');

const MODELO = process.env.IDENTIFICAR_MODELO || 'claude-opus-5-5';
const MAX_GRUPOS = 40;

const SYSTEM = `Você é contador de um escritório contábil brasileiro e classifica movimentações bancárias de pequenas empresas (Simples Nacional) no plano de contas da empresa.

Para cada grupo (todas as movimentações de uma mesma contraparte, saídas ou entradas), escolha UMA conta do plano enviado e devolva o código exato dela. Use só códigos que existem na lista. Quando não houver base para decidir, devolva conta_codigo "" e confiança "baixa" — o contador revisa tudo antes de aplicar, então é melhor deixar em branco do que chutar.

Critérios:
- Saída para fornecedor que emitiu NF de entrada para a empresa (campo fornecedorNf) = compra de mercadoria/insumo (grupo 4, ex.: "Compras de Mercadorias" ou "Compras de Matérias-Primas" conforme a atividade).
- Atacadistas, distribuidoras, açougues, padarias industriais, hortifrúti e similares, mesmo sem NF, também costumam ser compra de mercadoria/insumo.
- Pagamentos recorrentes a pessoas físicas, em valores de diária/salário/semana, costumam ser mão de obra (salários, serviços prestados por pessoa física, autônomos).
- Saída para o(a) próprio(a) titular ou sócio = retirada/distribuição de lucros (patrimônio líquido), não despesa.
- "DAS", "Simples Nacional" = imposto do Simples (obrigação tributária do grupo 2.1.05 se existir; senão a conta de impostos).
- Energia, água, telefone, internet, aluguel, sistemas, apps, tarifas bancárias, contador = despesas operacionais correspondentes.
- Aplicação/resgate (RDB, CDB, poupança) = conta de aplicações financeiras.
- Transferência para outra conta da própria empresa (maquininha, conta digital) = conta de banco correspondente se existir; se não existir, deixe em branco.
- Entradas de clientes, marketplaces e maquininhas = receita de vendas; estorno/devolução de compra volta para a conta da compra.
- Gastos claramente pessoais (clínica, loja de veículos, salão, farmácia em valor alto) pela conta da empresa = retirada da titular (patrimônio líquido), com confiança "media".
- Respeite as regras já cadastradas pelo escritório quando a contraparte combinar com o padrão.

"motivo": uma frase curta em português explicando a escolha.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sugestoes'],
  properties: {
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chave', 'conta_codigo', 'confianca', 'motivo'],
        properties: {
          chave: { type: 'string' },
          conta_codigo: { type: 'string' },
          confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          motivo: { type: 'string' },
        },
      },
    },
  },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' });
  const negado = await exigirEscritorio(event, 'identificar-lancamentos');
  if (negado) return negado;
  if (!process.env.ANTHROPIC_API_KEY) return resposta(500, { error: 'ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return resposta(400, { error: 'Body inválido.' }); }
  const contas = Array.isArray(body.contas) ? body.contas : [];
  const grupos = Array.isArray(body.grupos) ? body.grupos.slice(0, MAX_GRUPOS) : [];
  if (!contas.length || !grupos.length) return resposta(400, { error: 'Envie contas e grupos.' });

  // o plano vem primeiro e igual em todos os lotes da mesma empresa: fica
  // em cache entre as chamadas
  const plano = contas.map((c) => `${c.codigo} | ${c.nome} | ${c.tipo}`).join('\n');
  const regras = (body.regras ?? []).map((r) => `${r.padrao} -> ${r.conta_codigo}`).join('\n') || '(nenhuma)';
  const lote = grupos.map((g) => ({
    chave: g.chave, contraparte: g.contraparte, natureza: g.natureza, qtd: g.qtd, total: g.total,
    exemplos: (g.exemplos ?? []).slice(0, 3),
    ...(g.fornecedorNf ? { fornecedorNf: g.fornecedorNf } : {}),
  }));

  const client = new Anthropic({ timeout: 24_000, maxRetries: 0 });
  try {
    const r = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Empresa: ${body.empresaNome || 'não informada'}\n\nPlano de contas (código | nome | tipo):\n${plano}\n\nRegras do escritório (padrão -> código):\n${regras}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `Classifique estes grupos (devolva uma sugestão por chave):\n${JSON.stringify(lote)}` },
        ],
      }],
    });
    if (r.stop_reason === 'refusal') return resposta(502, { error: 'A IA recusou este lote.' });
    const texto = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let dados;
    try { dados = JSON.parse(texto); } catch { return resposta(502, { error: 'Resposta da IA veio incompleta, tente de novo.' }); }
    const codigos = new Set(contas.map((c) => c.codigo));
    const sugestoes = (dados.sugestoes ?? []).map((s) => ({
      ...s,
      conta_codigo: codigos.has(s.conta_codigo) ? s.conta_codigo : '',
    }));
    return resposta(200, { sugestoes, modelo: r.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return resposta(429, { error: 'Muitas chamadas seguidas à IA. Tente em instantes.' });
    if (e instanceof Anthropic.AuthenticationError) return resposta(500, { error: 'ANTHROPIC_API_KEY inválida.' });
    if (e instanceof Anthropic.APIConnectionTimeoutError) return resposta(504, { error: 'A IA demorou demais neste lote.' });
    if (e instanceof Anthropic.APIError) return resposta(502, { error: `Erro na API da Anthropic (${e.status ?? 'rede'}): ${e.message}` });
    return resposta(500, { error: e.message });
  }
};

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
