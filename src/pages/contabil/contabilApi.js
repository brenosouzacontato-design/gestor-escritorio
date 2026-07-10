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
