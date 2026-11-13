// contabilExtrato.js
//
// Regras da importação de extrato bancário que valem igual na tela
// (src/pages/contabil/ImportarExtratoTab.jsx) e no servidor
// (netlify/functions/importar-extrato-background.mjs — extrato enviado no
// grupo "Documentos" do WhatsApp). Sem dependências: as funções que acessam
// o banco recebem o client do Supabase como parâmetro (o do navegador ou o
// da function, com a service key).
//
// Tudo segue o padrão já usado na contabilidade das empresas (ex.: AMANDA
// LIMA GONÇALVES): plano padrão OneFlow, banco no grupo 1.1.01.003, regras
// de classificação aprendidas e o que não tem regra em "Valores a
// Identificar".

import { PREFIXO_DISPONIVEL, CODIGOS_CONTA_PENDENTE, acharContaPendente } from '../pages/contabil/planoContasConstantes.js';

// ---------- leitura ----------

// Rede de segurança pra extração por IA: quando a própria descrição já diz
// a direção ("Transferência enviada", "Pix recebido", "Pagamento de boleto
// efetuado"...), ela vence o "tipo" que a IA devolveu — a IA olha uma
// página por vez e, em extrato sem sinal no valor, às vezes erra a direção
// (ex: "Depósito recebido ... * Débito" virava saída por causa do "Débito").
export function corrigirTipoPelaDescricao(t) {
  const d = (t.descricao || '').toLowerCase();
  if (/\b(recebid[oa]|dep[óo]sito recebido|reembolso|estorno|resgate)\b/.test(d)) return { ...t, tipo: 'entrada' };
  if (/\b(enviad[oa]|pagamento (de boleto )?efetuado|tarifa|saque)\b/.test(d)) return { ...t, tipo: 'saida' };
  return t;
}

// Transação válida pro lançamento: data ISO, valor positivo e direção.
export function transacaoValida(t) {
  return !!t && /^\d{4}-\d{2}-\d{2}$/.test(String(t.data || ''))
    && Number.isFinite(Number(t.valor)) && Math.abs(Number(t.valor)) > 0
    && (t.tipo === 'entrada' || t.tipo === 'saida');
}

// ---------- regras de classificação ----------

// Extrai a "contraparte" do histórico pra usar como padrão da regra.
// Nosso histórico de extrato vem como "Tipo - Contraparte" (ver
// netlify/functions/extrair-extrato.js), então pega o que vem depois do
// primeiro " - "; se não achar esse formato, usa o histórico inteiro.
export function extrairPadraoClassificacao(historico) {
  const partes = (historico ?? '').split(' - ');
  const base = partes.length > 1 ? partes.slice(1).join(' - ') : historico ?? '';
  return base.trim().toUpperCase();
}

// Acha a regra mais específica (padrão mais longo) cujo trecho aparece no
// histórico da transação — permite cadastrar regras a partir de qualquer
// trecho do texto, não só da contraparte inteira.
export function encontrarRegraAplicavel(descricao, regras) {
  const alvo = (descricao ?? '').trim().toUpperCase();
  let melhor = null;
  for (const r of regras) {
    if (r.padrao && alvo.includes(r.padrao) && (!melhor || r.padrao.length > melhor.padrao.length)) {
      melhor = r;
    }
  }
  return melhor;
}

// ---------- lançamentos ----------

// Transações do extrato -> itens de lançamento (partida dobrada contra a
// conta do banco). `t.conta_id` vazio = sem classificação: vai pra
// "Valores a Identificar" (contaPendenteId) e fica não conciliado, pra
// classificar depois na aba Lançamentos.
//
// extrato_referencia identifica a transação de forma estável pra não
// duplicar se o mesmo extrato (ou um período sobreposto) for reimportado —
// pela tela ou pelo WhatsApp. Usa o identificador do banco quando tem,
// senão a descrição. Duas transações legítimas e idênticas no mesmo dia
// (ex: dois Pix de R$ 160 pra mesma pessoa — comum no Nubank, que não traz
// código da transação) dariam a mesma chave: a partir da 2ª ocorrência
// dentro do mesmo extrato a chave ganha "#2", "#3"... — a 1ª mantém a chave
// antiga, então reimportar o mesmo extrato continua sem duplicar.
export function montarItensExtrato(transacoes, { contaBancoId, contaPendenteId }) {
  const ocorrencias = new Map();
  return transacoes.map((t) => {
    const contraId = t.conta_id || contaPendenteId;
    if (!contraId) {
      throw new Error(`Não achei a conta "Valores a Identificar" (código ${CODIGOS_CONTA_PENDENTE.join(' ou ')}) no plano dessa empresa, e a transação "${t.descricao}" não tem conta selecionada.`);
    }
    const valor = Math.abs(Number(t.valor));
    const partidas = t.tipo === 'entrada'
      ? [
          { conta_id: contaBancoId, tipo: 'debito', valor },
          { conta_id: contraId, tipo: 'credito', valor },
        ]
      : [
          { conta_id: contraId, tipo: 'debito', valor },
          { conta_id: contaBancoId, tipo: 'credito', valor },
        ];
    const base = [contaBancoId, t.data, t.tipo, valor.toFixed(2), t.identificador || (t.descricao || '').trim()].join('|');
    const n = (ocorrencias.get(base) || 0) + 1;
    ocorrencias.set(base, n);
    return {
      data: t.data,
      historico: t.descricao,
      numeroDocumento: t.identificador || null,
      origem: 'importacao_extrato',
      extratoReferencia: n === 1 ? base : `${base}#${n}`,
      conciliado: !!t.conta_id,
      partidas,
    };
  });
}

// Insere vários lançamentos de uma vez (evita 2 round-trips sequenciais por
// transação, que fica lento demais com extratos grandes). Usa
// extratoReferencia com índice único parcial em (empresa_id,
// extrato_referencia) pra pular transações já importadas antes (ON CONFLICT
// DO NOTHING) em vez de duplicar.
// itens: [{ data, historico, numeroDocumento, origem, extratoReferencia, conciliado, partidas }]
export async function inserirLancamentosEmLote(supabase, empresaId, itens) {
  for (const item of itens) {
    const totalDebito = item.partidas.filter(p => p.tipo === 'debito').reduce((s, p) => s + Number(p.valor), 0);
    const totalCredito = item.partidas.filter(p => p.tipo === 'credito').reduce((s, p) => s + Number(p.valor), 0);
    if (Math.abs(totalDebito - totalCredito) > 0.005) {
      throw new Error(`Lançamento "${item.historico}" não bate: débito R$ ${totalDebito.toFixed(2)} x crédito R$ ${totalCredito.toFixed(2)}`);
    }
  }

  const itensPorRef = new Map(itens.map((it) => [it.extratoReferencia, it]));
  const linhas = itens.map((item) => ({
    empresa_id: empresaId,
    data: item.data,
    historico: item.historico,
    numero_documento: item.numeroDocumento ?? null,
    origem: item.origem ?? 'importacao_extrato',
    extrato_referencia: item.extratoReferencia,
    conciliado: item.conciliado ?? true,
  }));

  const BATCH = 200;
  const lancamentosCriados = [];
  for (let i = 0; i < linhas.length; i += BATCH) {
    const lote = linhas.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('lancamentos_contabeis')
      .upsert(lote, { onConflict: 'empresa_id,extrato_referencia', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    lancamentosCriados.push(...data);
  }

  const partidas = lancamentosCriados.flatMap((lancamento) => {
    const item = itensPorRef.get(lancamento.extrato_referencia);
    return item.partidas.map((p) => ({
      lancamento_id: lancamento.id,
      conta_id: p.conta_id,
      tipo: p.tipo,
      valor: p.valor,
    }));
  });

  for (let i = 0; i < partidas.length; i += BATCH) {
    const lote = partidas.slice(i, i + BATCH);
    const { error } = await supabase.from('partidas_contabeis').insert(lote);
    if (error) throw error;
  }

  return { criados: lancamentosCriados.length, pulados: itens.length - lancamentosCriados.length };
}

// ---------- conta do banco ----------

// Nome do banco como vem no extrato -> palavra-chave pra achar a conta no
// grupo "Bancos Conta Movimento" (1.1.01.003) e nome da conta nova.
const BANCOS = [
  { re: /nubank|nu pagamentos/i, chave: 'nubank', nome: 'Nubank' },
  { re: /ita[uú]/i, chave: 'itau', nome: 'Itaú' },
  { re: /bradesco/i, chave: 'bradesco', nome: 'Bradesco' },
  { re: /santander/i, chave: 'santander', nome: 'Santander' },
  { re: /banco do brasil|\bbb\b/i, chave: 'banco do brasil', nome: 'Banco do Brasil' },
  { re: /caixa econ[oô]mica|\bcef\b/i, chave: 'caixa economica', nome: 'Caixa Econômica Federal' },
  { re: /\binter\b|banco inter/i, chave: 'inter', nome: 'Banco Inter' },
  { re: /\bc6\b/i, chave: 'c6', nome: 'C6 Bank' },
  { re: /sicoob/i, chave: 'sicoob', nome: 'Sicoob' },
  { re: /sicredi/i, chave: 'sicredi', nome: 'Sicredi' },
  { re: /mercado ?pago/i, chave: 'mercado pago', nome: 'Mercado Pago' },
  { re: /pagbank|pagseguro/i, chave: 'pag', nome: 'PagBank' },
  { re: /\bstone\b/i, chave: 'stone', nome: 'Stone' },
  { re: /cora\b/i, chave: 'cora', nome: 'Cora' },
  { re: /btg/i, chave: 'btg', nome: 'BTG Pactual' },
  { re: /ifood/i, chave: 'ifood', nome: 'Ifood' },
];

export const PREFIXO_BANCOS = `${PREFIXO_DISPONIVEL}.003`;

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function identificarBanco(nomeBanco) {
  const texto = String(nomeBanco || '').trim();
  if (!texto) return null;
  const conhecido = BANCOS.find((b) => b.re.test(texto));
  if (conhecido) return { chave: conhecido.chave, nome: conhecido.nome };
  const nome = texto.replace(/\s+/g, ' ').slice(0, 60);
  return { chave: semAcento(nome), nome };
}

// Conta do banco do extrato entre as contas da empresa: analítica do grupo
// 1.1.01.003 cujo nome tem a palavra-chave do banco. Sem banco informado e
// com uma conta só no grupo, usa ela. Devolve null quando precisa criar.
export function acharContaBanco(contas, banco) {
  const doGrupo = contas.filter((c) => c.ativo !== false && c.aceita_lancamento
    && String(c.codigo || '').startsWith(`${PREFIXO_BANCOS}.`));
  if (!banco) return doGrupo.length === 1 ? doGrupo[0] : null;
  return doGrupo.find((c) => semAcento(c.nome).includes(banco.chave)) || null;
}

// Próximo código livre dentro do grupo de bancos (1.1.01.003.NNN).
export function proximoCodigoBanco(contas) {
  const nivel = PREFIXO_BANCOS.split('.').length + 1;
  const numeros = contas
    .map((c) => String(c.codigo || '').split('.'))
    .filter((p) => p.length === nivel && p.slice(0, -1).join('.') === PREFIXO_BANCOS)
    .map((p) => parseInt(p[p.length - 1], 10))
    .filter((n) => !Number.isNaN(n));
  return `${PREFIXO_BANCOS}.${String((numeros.length ? Math.max(...numeros) : 0) + 1).padStart(3, '0')}`;
}

export { acharContaPendente };

// ---------- período e DRE ----------

// Período "cheio" do extrato: do 1º dia do mês da primeira transação ao
// último dia do mês da última (extrato mensal -> DRE do mês).
export function periodoDoExtrato(transacoes) {
  const datas = transacoes.map((t) => t.data).filter(Boolean).sort();
  if (!datas.length) return null;
  const [a, m] = datas[datas.length - 1].split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return {
    dataInicio: `${datas[0].slice(0, 7)}-01`,
    dataFim: `${datas[datas.length - 1].slice(0, 7)}-${String(ultimoDia).padStart(2, '0')}`,
  };
}

// DRE simplificada: uma linha por conta de Receita/Despesa/Custo — cada
// conta já é a própria linha, "resultado" é receitas menos despesas menos
// custos. Custo entra igual despesa (natureza devedora, reduz o resultado).
export async function calcularDREPorContaCom(supabase, empresaId, { dataInicio, dataFim }) {
  const [{ data: contas, error: errContas }, { data: movimento, error: errMov }] = await Promise.all([
    supabase.from('contas_contabeis').select('*').eq('empresa_id', empresaId).eq('ativo', true)
      .in('tipo', ['receita', 'despesa', 'custo']).order('nome'),
    supabase.from('vw_movimento_contas').select('*').eq('empresa_id', empresaId).gte('data', dataInicio).lte('data', dataFim),
  ]);
  if (errContas) throw errContas;
  if (errMov) throw errMov;

  const movPorConta = {};
  for (const m of movimento) {
    if (!movPorConta[m.conta_id]) movPorConta[m.conta_id] = { debito: 0, credito: 0 };
    movPorConta[m.conta_id].debito += Number(m.total_debito);
    movPorConta[m.conta_id].credito += Number(m.total_credito);
  }

  // Não filtra valor!==0 aqui: uma conta-pai (sintética) pode não ter
  // movimento próprio mas ter filhas com movimento — quem decide o que
  // exibir é a agregação por hierarquia (comSomasDeFilhas), no chamador.
  const linhas = contas.map((c) => {
    const mov = movPorConta[c.id] || { debito: 0, credito: 0 };
    const valor = c.natureza === 'credora' ? mov.credito - mov.debito : mov.debito - mov.credito;
    return { conta: c, valor };
  });

  const receitas = linhas.filter((l) => l.conta.tipo === 'receita');
  const despesas = linhas.filter((l) => l.conta.tipo === 'despesa');
  const custos = linhas.filter((l) => l.conta.tipo === 'custo');
  const totalReceitas = receitas.reduce((s, l) => s + l.valor, 0);
  const totalDespesas = despesas.reduce((s, l) => s + l.valor, 0);
  const totalCustos = custos.reduce((s, l) => s + l.valor, 0);

  return {
    receitas, despesas, custos, totalReceitas, totalDespesas, totalCustos,
    resultado: totalReceitas - totalDespesas - totalCustos,
  };
}
