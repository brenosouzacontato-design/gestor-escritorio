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

// Grupo "Disponibilidades" (caixa, bancos, aplicações) no plano de contas
// padrão — mesmo prefixo já usado em LancamentosTab.jsx pra inferir a
// natureza (entrada/saída) de um lançamento.
const PREFIXO_DISPONIVEL = '1.1.01';

// Lista só as contas de banco/caixa — usada no seletor "conta bancária do
// extrato" da importação. Não aparece na tela de Plano de Contas (que agora
// só mostra Receita/Despesa), mas continua existindo pra sustentar a
// partida dobrada por baixo dos panos.
export async function listarContasBanco(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .eq('aceita_lancamento', true)
    .like('codigo', `${PREFIXO_DISPONIVEL}%`)
    .order('codigo');
  if (error) throw error;
  return data;
}

// Lista plana (sem hierarquia) das contas de Receita e Despesa — é o que a
// tela de Plano de Contas mostra agora, e o que alimenta os seletores de
// classificação da importação de extrato e a DRE.
export async function listarContasReceitaDespesa(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .in('tipo', ['receita', 'despesa'])
    .order('nome');
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

// Cria uma conta de Receita ou Despesa pra tela simplificada de Plano de
// Contas — nome + tipo é tudo que o usuário escolhe; código (só pra
// satisfazer o unique(empresa_id, codigo) que já existe), natureza, nível
// e "aceita_lancamento" são derivados automaticamente.
export async function criarContaReceitaDespesa(empresaId, nome, tipo) {
  const prefixo = tipo === 'receita' ? 'REC' : 'DESP';
  const { count, error: errCount } = await supabase
    .from('contas_contabeis')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .eq('tipo', tipo);
  if (errCount) throw errCount;
  const codigo = `${prefixo}-${String((count ?? 0) + 1).padStart(3, '0')}`;
  return criarConta({
    empresa_id: empresaId,
    codigo,
    nome,
    tipo,
    natureza: tipo === 'receita' ? 'credora' : 'devedora',
    nivel: 1,
    aceita_lancamento: true,
  });
}

// Uma conta só pode ser excluída de vez se nunca teve lançamento (senão
// quebraria o histórico) — nesse caso só desativa (soft delete via "ativo").
export async function excluirOuDesativarConta(id) {
  const { count, error: errCount } = await supabase
    .from('partidas_contabeis')
    .select('id', { count: 'exact', head: true })
    .eq('conta_id', id);
  if (errCount) throw errCount;
  if (count > 0) {
    await atualizarConta(id, { ativo: false });
    return { desativada: true };
  }
  const { error } = await supabase.from('contas_contabeis').delete().eq('id', id);
  if (error) throw error;
  return { desativada: false };
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

// DRE simplificada: uma linha por conta de Receita/Despesa (sem os 9 grupos
// fixos de antes) — cada conta já é a própria linha, "resultado" é só
// receitas menos despesas do período. Mesma lógica de "movimento do
// período" que calcularDRE já usa por grupo, só que por conta.
export async function calcularDREPorConta(empresaId, { dataInicio, dataFim }) {
  const [contas, { data: movimento, error: errMov }] = await Promise.all([
    listarContasReceitaDespesa(empresaId),
    supabase.from('vw_movimento_contas').select('*').eq('empresa_id', empresaId).gte('data', dataInicio).lte('data', dataFim),
  ]);
  if (errMov) throw errMov;

  const movPorConta = {};
  for (const m of movimento) {
    if (!movPorConta[m.conta_id]) movPorConta[m.conta_id] = { debito: 0, credito: 0 };
    movPorConta[m.conta_id].debito += Number(m.total_debito);
    movPorConta[m.conta_id].credito += Number(m.total_credito);
  }

  const linhas = contas
    .map((c) => {
      const mov = movPorConta[c.id] || { debito: 0, credito: 0 };
      const valor = c.natureza === 'credora' ? mov.credito - mov.debito : mov.debito - mov.credito;
      return { conta: c, valor };
    })
    .filter((l) => l.valor !== 0);

  const receitas = linhas.filter((l) => l.conta.tipo === 'receita').sort((a, b) => b.valor - a.valor);
  const despesas = linhas.filter((l) => l.conta.tipo === 'despesa').sort((a, b) => b.valor - a.valor);
  const totalReceitas = receitas.reduce((s, l) => s + l.valor, 0);
  const totalDespesas = despesas.reduce((s, l) => s + l.valor, 0);

  return { receitas, despesas, totalReceitas, totalDespesas, resultado: totalReceitas - totalDespesas };
}

// Lançamentos individuais que compõem o total de uma conta num período —
// alimenta o sidebar de drill-down ao clicar numa linha da DRE.
export async function listarLancamentosPorConta(empresaId, contaId, { dataInicio, dataFim }) {
  let query = supabase
    .from('partidas_contabeis')
    .select('id, tipo, valor, lancamentos_contabeis!inner(data, historico, numero_documento, origem, empresa_id)')
    .eq('conta_id', contaId)
    .eq('lancamentos_contabeis.empresa_id', empresaId);
  if (dataInicio) query = query.gte('lancamentos_contabeis.data', dataInicio);
  if (dataFim) query = query.lte('lancamentos_contabeis.data', dataFim);

  const { data, error } = await query;
  if (error) throw error;
  return data
    .map((p) => ({
      id: p.id,
      tipo: p.tipo,
      valor: Number(p.valor),
      data: p.lancamentos_contabeis.data,
      historico: p.lancamentos_contabeis.historico,
      numeroDocumento: p.lancamentos_contabeis.numero_documento,
      origem: p.lancamentos_contabeis.origem,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
}
