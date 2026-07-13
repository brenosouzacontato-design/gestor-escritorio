// contabilApi.js
// Camada de dados do módulo contábil. Importa o client Supabase já
// existente no Gestor.
import { supabase } from '../../lib/supabase';

// ---------- PLANO DE CONTAS ----------

export async function listarContas(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('codigo');
  if (error) throw error;
  return data;
}

export async function criarConta(conta) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .insert(conta)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarConta(id, patch) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function atualizarContasEmLote(ids, patch) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .update(patch)
    .in('id', ids)
    .select();
  if (error) throw error;
  return data;
}

// ---------- LANÇAMENTOS ----------

// partidas: [{ conta_id, tipo: 'debito'|'credito', valor }, ...]
// soma dos débitos precisa ser igual à soma dos créditos (validado no banco também)
export async function criarLancamento({ empresaId, data, historico, numeroDocumento, origem = 'manual', partidas, extratoReferencia }) {
  const totalDebito = partidas.filter(p => p.tipo === 'debito').reduce((s, p) => s + Number(p.valor), 0);
  const totalCredito = partidas.filter(p => p.tipo === 'credito').reduce((s, p) => s + Number(p.valor), 0);
  if (Math.abs(totalDebito - totalCredito) > 0.005) {
    throw new Error(`Lançamento não bate: débito R$ ${totalDebito.toFixed(2)} x crédito R$ ${totalCredito.toFixed(2)}`);
  }

  const { data: lancamento, error: errLanc } = await supabase
    .from('lancamentos_contabeis')
    .insert({
      empresa_id: empresaId,
      data,
      historico,
      numero_documento: numeroDocumento ?? null,
      origem,
      extrato_referencia: extratoReferencia ?? null,
    })
    .select()
    .single();
  if (errLanc) throw errLanc;

  const partidasComLancamento = partidas.map(p => ({
    lancamento_id: lancamento.id,
    conta_id: p.conta_id,
    tipo: p.tipo,
    valor: p.valor,
  }));

  const { error: errPartidas } = await supabase
    .from('partidas_contabeis')
    .insert(partidasComLancamento);
  if (errPartidas) throw errPartidas;

  return lancamento;
}

// Insere vários lançamentos de uma vez (usado pela importação de extrato —
// evita 2 round-trips sequenciais por transação, que fica lento demais com
// extratos grandes). Usa extratoReferencia com índice único parcial em
// (empresa_id, extrato_referencia) pra pular transações já importadas antes
// (ON CONFLICT DO NOTHING) em vez de duplicar.
// itens: [{ data, historico, numeroDocumento, origem, extratoReferencia, conciliado, partidas }]
export async function criarLancamentosEmLote(empresaId, itens) {
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

// Reclassifica um lançamento importado que caiu em "Valores a Identificar":
// troca a conta da partida indicada e marca o lançamento como conciliado.
export async function reclassificarLancamento(lancamentoId, partidaId, novaContaId) {
  const { error: errPartida } = await supabase
    .from('partidas_contabeis')
    .update({ conta_id: novaContaId })
    .eq('id', partidaId);
  if (errPartida) throw errPartida;

  const { data, error: errLanc } = await supabase
    .from('lancamentos_contabeis')
    .update({ conciliado: true })
    .eq('id', lancamentoId)
    .select('*, partidas_contabeis(*, contas_contabeis(codigo, nome))')
    .single();
  if (errLanc) throw errLanc;
  return data;
}

// Mesma ideia que reclassificarLancamento, mas pra várias partidas
// pendentes de uma vez, todas indo pra mesma conta escolhida.
export async function reclassificarLancamentosEmLote(partidaIds, lancamentoIds, novaContaId) {
  const { error: errPartidas } = await supabase
    .from('partidas_contabeis')
    .update({ conta_id: novaContaId })
    .in('id', partidaIds);
  if (errPartidas) throw errPartidas;

  const { error: errLancs } = await supabase
    .from('lancamentos_contabeis')
    .update({ conciliado: true })
    .in('id', lancamentoIds);
  if (errLancs) throw errLancs;
}

// ---------- REGRAS DE CLASSIFICAÇÃO AUTOMÁTICA ----------

// Extrai a "contraparte" do histórico pra usar como padrão da regra.
// Nosso histórico de extrato vem como "Tipo - Contraparte" (ver
// netlify/functions/extrair-extrato.js), então pega o que vem depois do
// primeiro " - "; se não achar esse formato, usa o histórico inteiro.
export function extrairPadraoClassificacao(historico) {
  const partes = (historico ?? '').split(' - ');
  const base = partes.length > 1 ? partes.slice(1).join(' - ') : historico ?? '';
  return base.trim().toUpperCase();
}

export async function listarRegrasClassificacao(empresaId) {
  const { data, error } = await supabase
    .from('regras_classificacao')
    .select('*, contas_contabeis(codigo, nome)')
    .eq('empresa_id', empresaId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Acha a regra mais específica (padrão mais longo) cujo trecho aparece no
// histórico da transação — permite cadastrar regras a partir de qualquer
// trecho do texto, não só da contraparte inteira.
export function encontrarRegraAplicavel(descricao, regras) {
  const alvo = normalizarTexto(descricao);
  let melhor = null;
  for (const r of regras) {
    if (r.padrao && alvo.includes(r.padrao) && (!melhor || r.padrao.length > melhor.padrao.length)) {
      melhor = r;
    }
  }
  return melhor;
}

function normalizarTexto(texto) {
  return (texto ?? '').trim().toUpperCase();
}

// Grava/atualiza a regra "esse padrão sempre cai nessa conta" — chamado
// toda vez que um lançamento é classificado (manual, em lote ou na
// importação de extrato), pra ir aprendendo sozinho com o histórico.
export async function salvarRegraClassificacao(empresaId, historico, contaId) {
  const padrao = extrairPadraoClassificacao(historico);
  if (!padrao) return;
  const { error } = await supabase
    .from('regras_classificacao')
    .upsert({ empresa_id: empresaId, padrao, conta_id: contaId, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,padrao' });
  if (error) throw error;
}

// Cadastro manual de regra: o usuário escolhe o trecho (não precisa ser a
// contraparte inteira) e a conta, direto na tela de Regras.
export async function salvarRegraManual(empresaId, padraoBruto, contaId) {
  const padrao = normalizarTexto(padraoBruto);
  if (!padrao) throw new Error('Informe um trecho do histórico pra regra.');
  const { error } = await supabase
    .from('regras_classificacao')
    .upsert({ empresa_id: empresaId, padrao, conta_id: contaId, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,padrao' });
  if (error) throw error;
}

export async function excluirRegraClassificacao(id) {
  const { error } = await supabase.from('regras_classificacao').delete().eq('id', id);
  if (error) throw error;
}

export async function listarLancamentos(empresaId, { dataInicio, dataFim } = {}) {
  let query = supabase
    .from('lancamentos_contabeis')
    .select('*, partidas_contabeis(*, contas_contabeis(codigo, nome))')
    .eq('empresa_id', empresaId)
    .order('data', { ascending: false });

  if (dataInicio) query = query.gte('data', dataInicio);
  if (dataFim) query = query.lte('data', dataFim);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function excluirLancamento(id) {
  const { error } = await supabase.from('lancamentos_contabeis').delete().eq('id', id);
  if (error) throw error;
}

// ---------- BALANCETE ----------

// Retorna saldo por conta no período, já considerando a natureza da conta
// (devedora: saldo = débito - crédito | credora: saldo = crédito - débito)
export async function calcularBalancete(empresaId, { dataInicio, dataFim }) {
  const [{ data: contas, error: errContas }, { data: movimento, error: errMov }] = await Promise.all([
    supabase.from('contas_contabeis').select('*').eq('empresa_id', empresaId).eq('ativo', true).order('codigo'),
    supabase.from('vw_movimento_contas').select('*').eq('empresa_id', empresaId).gte('data', dataInicio).lte('data', dataFim),
  ]);
  if (errContas) throw errContas;
  if (errMov) throw errMov;

  // saldo anterior (tudo antes de dataInicio)
  const { data: movimentoAnterior, error: errAnterior } = await supabase
    .from('vw_movimento_contas')
    .select('*')
    .eq('empresa_id', empresaId)
    .lt('data', dataInicio);
  if (errAnterior) throw errAnterior;

  const porConta = {};
  for (const c of contas) {
    porConta[c.id] = {
      conta: c,
      saldoAnterior: 0,
      debito: 0,
      credito: 0,
      saldoAtual: 0,
    };
  }

  for (const m of movimentoAnterior) {
    if (!porConta[m.conta_id]) continue;
    const c = porConta[m.conta_id].conta;
    const delta = c.natureza === 'devedora'
      ? Number(m.total_debito) - Number(m.total_credito)
      : Number(m.total_credito) - Number(m.total_debito);
    porConta[m.conta_id].saldoAnterior += delta;
  }

  for (const m of movimento) {
    if (!porConta[m.conta_id]) continue;
    porConta[m.conta_id].debito += Number(m.total_debito);
    porConta[m.conta_id].credito += Number(m.total_credito);
  }

  for (const id of Object.keys(porConta)) {
    const linha = porConta[id];
    const movLiquido = linha.conta.natureza === 'devedora'
      ? linha.debito - linha.credito
      : linha.credito - linha.debito;
    linha.saldoAtual = linha.saldoAnterior + movLiquido;
  }

  return Object.values(porConta).sort((a, b) => a.conta.codigo.localeCompare(b.conta.codigo));
}

// ---------- DRE ----------

const ORDEM_DRE = [
  { grupo: 'receita_bruta', label: 'Receita Bruta', sinal: 1 },
  { grupo: 'deducao', label: '(-) Deduções', sinal: -1 },
  { grupo: 'custo', label: '(-) Custos', sinal: -1 },
  { grupo: 'despesa_administrativa', label: '(-) Despesas Administrativas', sinal: -1 },
  { grupo: 'despesa_comercial', label: '(-) Despesas Comerciais', sinal: -1 },
  { grupo: 'despesa_financeira', label: '(-) Despesas Financeiras', sinal: -1 },
  { grupo: 'outras_receitas', label: '(+) Outras Receitas', sinal: 1 },
  { grupo: 'outras_despesas', label: '(-) Outras Despesas', sinal: -1 },
  { grupo: 'ir_csll', label: '(-) IRPJ / CSLL', sinal: -1 },
];

export async function calcularDRE(empresaId, { dataInicio, dataFim }) {
  const balancete = await calcularBalancete(empresaId, { dataInicio, dataFim });

  const porGrupo = {};
  for (const linha of balancete) {
    const grupo = linha.conta.grupo_dre;
    if (!grupo) continue;
    const movimentoPeriodo = linha.conta.natureza === 'devedora'
      ? linha.debito - linha.credito
      : linha.credito - linha.debito;
    porGrupo[grupo] = (porGrupo[grupo] ?? 0) + movimentoPeriodo;
  }

  const linhas = ORDEM_DRE.map(({ grupo, label, sinal }) => ({
    grupo,
    label,
    valor: sinal * (porGrupo[grupo] ?? 0),
  }));

  const receitaBruta = linhas.find(l => l.grupo === 'receita_bruta')?.valor ?? 0;
  const deducoes = linhas.find(l => l.grupo === 'deducao')?.valor ?? 0;
  const custos = linhas.find(l => l.grupo === 'custo')?.valor ?? 0;
  const despesasOperacionais = ['despesa_administrativa', 'despesa_comercial', 'despesa_financeira']
    .reduce((s, g) => s + (linhas.find(l => l.grupo === g)?.valor ?? 0), 0);
  const outras = ['outras_receitas', 'outras_despesas']
    .reduce((s, g) => s + (linhas.find(l => l.grupo === g)?.valor ?? 0), 0);
  const irCsll = linhas.find(l => l.grupo === 'ir_csll')?.valor ?? 0;

  const receitaLiquida = receitaBruta + deducoes;
  const lucroBruto = receitaLiquida + custos;
  const resultadoOperacional = lucroBruto + despesasOperacionais;
  const resultadoAntesIR = resultadoOperacional + outras;
  const resultadoLiquido = resultadoAntesIR + irCsll;

  return {
    linhas,
    totais: {
      receitaBruta,
      receitaLiquida,
      lucroBruto,
      resultadoOperacional,
      resultadoAntesIR,
      resultadoLiquido,
    },
  };
}
