// src/lib/dreGerencial.js
//
// DRE gerencial mensal no modelo "DRE mensal — Amanda Lima Gonçalves":
// colunas por mês + Total + % da receita, receita bruta pelo PGDAS-D (ou pelos
// lançamentos quando o mês não tem PGDAS), DAS da competência, CMV, despesas
// operacionais, resultado operacional, "saídas fora do resultado" (retiradas,
// aplicações, empréstimos, guias pagas...), o que ainda está em "Valores a
// Identificar" e a conciliação com o extrato. Cada linha detalha por
// contraparte (quem pagou/recebeu). Também calcula os indicadores
// financeiros e os pontos de atenção.
//
// Puro (sem Supabase): os dados vêm de carregarDadosDreGerencialCom, logo
// abaixo, que recebe o client — usado pela aba DRE e pelo link público.

import { PREFIXO_DISPONIVEL, ehContaPendente } from '../pages/contabil/planoContasConstantes.js';

const r2 = (v) => Math.round(v * 100) / 100;

// ---------- período ----------

export function mesesDoPeriodo(dataInicio, dataFim) {
  if (!dataInicio || !dataFim || dataFim < dataInicio) return [];
  const meses = [];
  let [a, m] = dataInicio.slice(0, 7).split('-').map(Number);
  const fim = dataFim.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const chave = `${a}-${String(m).padStart(2, '0')}`;
    meses.push(chave);
    if (chave >= fim) break;
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return meses;
}

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function rotuloMes(chave) {
  const [a, m] = chave.split('-');
  return `${NOMES_MES[Number(m) - 1]}/${a.slice(2)}`;
}

// "09/2026" (competência do PGDAS / NF) -> "2026-09"
export function mesDaCompetencia(competencia) {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(String(competencia ?? '').trim());
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}

// ---------- contas ----------

// disponível de verdade = caixa e bancos (1.1.01.*), menos a transitória
// "Valores a Identificar" e menos aplicações financeiras (dinheiro que saiu
// do caixa pra investir é saída "fora do resultado", não transferência)
export function ehDisponivel(codigo) {
  if (!codigo?.startsWith(PREFIXO_DISPONIVEL)) return false;
  if (ehContaPendente(codigo)) return false;
  if (codigo.startsWith('1.1.01.005')) return false; // aplicações (plano OneFlow)
  return true;
}

// contraparte do lançamento a partir do histórico do extrato
// ("Pix enviado - 99 TECNOLOGIA LTDA" -> "99 TECNOLOGIA LTDA")
export function contraparteDoHistorico(historico) {
  const h = String(historico ?? '').trim();
  const i = h.indexOf(' - ');
  const resto = (i >= 0 ? h.slice(i + 3) : h).trim();
  return resto.replace(/\s+/g, ' ') || 'Sem descrição';
}

function grupoDaConta(conta, porCodigo, niveis) {
  const partes = conta.codigo.split('.');
  for (let n = Math.min(niveis, partes.length - 1); n >= 2; n--) {
    const pai = porCodigo.get(partes.slice(0, n).join('.'));
    if (pai) return pai;
  }
  return conta;
}

// Em que linha da DRE uma conta (contrapartida do lançamento) cai.
// Devolve { secao, chave, rotulo, ordem }.
export function linhaDaConta(conta, porCodigo = new Map()) {
  const c = conta.codigo ?? '';
  const tipo = conta.tipo;
  if (ehContaPendente(c)) return { secao: 'identificar', chave: 'identificar', rotulo: 'Valores a identificar', ordem: 0 };

  if (tipo === 'receita' || c.startsWith('3')) {
    if (c.startsWith('3.3')) return { secao: 'deducoes', chave: 'deducoes', rotulo: 'Deduções da receita (lançamentos)', ordem: 0 };
    if (c.startsWith('3.1.02') || c.startsWith('3.2')) return { secao: 'outras', chave: `orec:${c.slice(0, 6)}`, rotulo: c.startsWith('3.1.02') ? 'Receitas financeiras' : 'Receitas não operacionais', ordem: 1 };
    return { secao: 'receita', chave: 'receita', rotulo: 'Receita nos lançamentos', ordem: 0 };
  }
  if (tipo === 'custo' || c.startsWith('4')) {
    const g = grupoDaConta(conta, porCodigo, 4);
    return { secao: 'custos', chave: `custo:${g.codigo}`, rotulo: g.nome, ordem: g.codigo };
  }
  if (tipo === 'despesa' || c.startsWith('5') || c.startsWith('6')) {
    if (c.startsWith('6')) return { secao: 'outras', chave: 'ir', rotulo: 'IRPJ e CSLL', ordem: 3 };
    if (c.startsWith('5.9') || c.startsWith('5.2')) {
      const g = grupoDaConta(conta, porCodigo, 3);
      return { secao: 'outras', chave: `odesp:${g.codigo}`, rotulo: g.nome, ordem: 2 };
    }
    const g = grupoDaConta(conta, porCodigo, 4);
    return { secao: 'despesas', chave: `desp:${g.codigo}`, rotulo: g.nome, ordem: g.codigo };
  }
  // ativo (não disponível), passivo, PL: dinheiro que sai (ou entra) sem ser
  // receita/despesa — retirada, aplicação, empréstimo, guia, fornecedor...
  const g = grupoDaConta(conta, porCodigo, 4);
  return { secao: 'fora', chave: `fora:${g.codigo}`, rotulo: g.nome, ordem: g.codigo };
}

// ---------- montagem ----------

function novoAcumulador() {
  return { valores: {}, detalhe: new Map() };
}

function somar(acc, mes, valor, contraparte, lancamentoId) {
  acc.valores[mes] = (acc.valores[mes] ?? 0) + valor;
  // mesma contraparte escrita com maiúsculas/acentos diferentes = um grupo só
  const chave = contraparte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  let d = acc.detalhe.get(chave);
  if (!d) { d = { contraparte, valores: {}, total: 0, qtd: 0, lancamentoIds: [] }; acc.detalhe.set(chave, d); }
  d.valores[mes] = (d.valores[mes] ?? 0) + valor;
  d.total += valor;
  d.qtd += 1;
  if (lancamentoId && !d.lancamentoIds.includes(lancamentoId)) d.lancamentoIds.push(lancamentoId);
}

/**
 * @param {object} p
 * @param {Array} p.contas        contas_contabeis da empresa (id, codigo, nome, tipo)
 * @param {Array} p.lancamentos   lançamentos do período com partidas_contabeis (conta_id, tipo, valor)
 * @param {Array} p.pgdas         dados_gerenciais_simples (competencia, faturamento_periodo, valor_das)
 * @param {string} p.dataInicio
 * @param {string} p.dataFim
 * @param {number} [p.saldoAnterior]  saldo de caixa+bancos antes de dataInicio
 */
export function montarDreGerencial({ contas = [], lancamentos = [], pgdas = [], dataInicio, dataFim, saldoAnterior = 0 }) {
  const meses = mesesDoPeriodo(dataInicio, dataFim);
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const porCodigo = new Map(contas.map((c) => [c.codigo, c]));

  const acc = new Map(); // chave -> { meta, valores, detalhe }
  const pegar = (meta) => {
    let a = acc.get(meta.chave);
    if (!a) { a = { meta, ...novoAcumulador() }; acc.set(meta.chave, a); }
    return a;
  };
  const caixa = { entradas: novoAcumulador(), saidas: novoAcumulador() };
  const identificar = { entradas: novoAcumulador(), saidas: novoAcumulador() };
  let qtdLanc = 0;
  let qtdIdentificar = 0;

  for (const l of lancamentos) {
    const mes = String(l.data).slice(0, 7);
    if (!meses.includes(mes)) continue;
    qtdLanc += 1;
    const contraparte = contraparteDoHistorico(l.historico);
    const partidas = (l.partidas_contabeis ?? []).map((p) => ({
      ...p,
      valor: Number(p.valor) || 0,
      conta: p.contas_contabeis ?? contaPorId.get(p.conta_id) ?? { codigo: '', nome: 'Conta removida', tipo: null },
    }));
    const disp = partidas.filter((p) => ehDisponivel(p.conta.codigo));
    const outras = partidas.filter((p) => !ehDisponivel(p.conta.codigo));

    // movimento de caixa (transferência entre contas próprias se anula)
    const entrouCaixa = disp.filter((p) => p.tipo === 'debito').reduce((s, p) => s + p.valor, 0);
    const saiuCaixa = disp.filter((p) => p.tipo === 'credito').reduce((s, p) => s + p.valor, 0);
    const liquido = entrouCaixa - saiuCaixa;
    if (outras.length > 0 && liquido > 0) somar(caixa.entradas, mes, liquido, contraparte, l.id);
    if (outras.length > 0 && liquido < 0) somar(caixa.saidas, mes, -liquido, contraparte, l.id);

    let tocouPendente = false;
    for (const p of outras) {
      const meta = linhaDaConta(p.conta, porCodigo);
      if (meta.secao === 'identificar') {
        tocouPendente = true;
        if (p.tipo === 'debito') somar(identificar.saidas, mes, p.valor, contraparte, l.id);
        else somar(identificar.entradas, mes, p.valor, contraparte, l.id);
        continue;
      }
      // receitas: crédito soma; resto: débito soma (saída de dinheiro positiva)
      const ehReceita = meta.secao === 'receita' || meta.chave.startsWith('orec:');
      const v = ehReceita ? (p.tipo === 'credito' ? p.valor : -p.valor) : (p.tipo === 'debito' ? p.valor : -p.valor);
      somar(pegar(meta), mes, v, contraparte, l.id);
    }
    if (tocouPendente) qtdIdentificar += 1;
  }

  // ---- PGDAS por mês
  const pgdasPorMes = new Map();
  for (const p of pgdas) {
    const mes = mesDaCompetencia(p.competencia);
    if (mes) pgdasPorMes.set(mes, p);
  }

  const vazio = () => Object.fromEntries(meses.map((m) => [m, 0]));
  const valoresDe = (chave) => ({ ...vazio(), ...(acc.get(chave)?.valores ?? {}) });

  const receitaLanc = valoresDe('receita');
  const receitaBruta = vazio();
  const fonteReceita = {};
  const das = vazio();
  const fonteDas = {};
  const deducoesLanc = valoresDe('deducoes');
  for (const m of meses) {
    const p = pgdasPorMes.get(m);
    const fat = Number(p?.faturamento_periodo);
    if (p && Number.isFinite(fat) && fat > 0) { receitaBruta[m] = fat; fonteReceita[m] = 'pgdas'; }
    else { receitaBruta[m] = receitaLanc[m]; fonteReceita[m] = receitaLanc[m] ? 'lancamentos' : 'sem dados'; }
    const vDas = Number(p?.valor_das);
    if (p && Number.isFinite(vDas) && vDas > 0) { das[m] = vDas; fonteDas[m] = 'pgdas'; }
    else { das[m] = 0; fonteDas[m] = p ? 'pgdas sem DAS' : 'sem PGDAS'; }
    das[m] += deducoesLanc[m];
  }

  const somaGrupo = (secao) => {
    const out = vazio();
    for (const a of acc.values()) if (a.meta.secao === secao) for (const m of meses) out[m] += a.valores[m] ?? 0;
    return out;
  };
  const op = (a, b, f) => Object.fromEntries(meses.map((m) => [m, f(a[m] ?? 0, b[m] ?? 0)]));

  const receitaLiquida = op(receitaBruta, das, (x, y) => x - y);
  const custos = somaGrupo('custos');
  const lucroBruto = op(receitaLiquida, custos, (x, y) => x - y);
  const despesas = somaGrupo('despesas');
  const resultadoOperacional = op(lucroBruto, despesas, (x, y) => x - y);
  const outrasLiq = vazio();
  for (const a of acc.values()) {
    if (a.meta.secao !== 'outras') continue;
    const sinal = a.meta.chave.startsWith('orec:') ? 1 : -1;
    for (const m of meses) outrasLiq[m] += sinal * (a.valores[m] ?? 0);
  }
  const resultadoPeriodo = op(resultadoOperacional, outrasLiq, (x, y) => x + y);
  const fora = somaGrupo('fora');
  const entradas = { ...vazio(), ...caixa.entradas.valores };
  const saidas = { ...vazio(), ...caixa.saidas.valores };
  const variacao = op(entradas, saidas, (x, y) => x - y);
  const saldoFim = vazio();
  let saldo = Number(saldoAnterior) || 0;
  for (const m of meses) { saldo += variacao[m]; saldoFim[m] = saldo; }
  const idSaidas = { ...vazio(), ...identificar.saidas.valores };
  const idEntradas = { ...vazio(), ...identificar.entradas.valores };

  // ---- linhas (ordem do modelo)
  const linhas = [];
  const total = (v) => meses.reduce((s, m) => s + (v[m] ?? 0), 0);
  const detalheDe = (a) => (a ? [...a.detalhe.values()].filter((d) => Math.abs(d.total) >= 0.005).sort((x, y) => Math.abs(y.total) - Math.abs(x.total)) : null);
  const add = (id, rotulo, valores, extra = {}) => linhas.push({ id, rotulo, valores, total: total(valores), ...extra });
  const itensDe = (secao, prefixo) => [...acc.values()]
    .filter((a) => a.meta.secao === secao)
    .sort((x, y) => String(x.meta.ordem).localeCompare(String(y.meta.ordem), 'pt-BR', { numeric: true }))
    .forEach((a) => add(a.meta.chave, `${prefixo}${a.meta.rotulo}`, { ...vazio(), ...a.valores }, { tipo: 'item', detalhe: detalheDe(a) }));

  add('receita_bruta', 'Receita bruta', receitaBruta, { tipo: 'destaque', fonte: fonteReceita, detalhe: detalheDe(acc.get('receita')) });
  add('das', '(−) Simples Nacional — DAS da competência', das, { tipo: 'item', fonte: fonteDas, detalhe: detalheDe(acc.get('deducoes')) });
  add('receita_liquida', '(=) Receita líquida', receitaLiquida, { tipo: 'total' });
  const custosTodos = [...acc.values()].filter((a) => a.meta.secao === 'custos');
  if (custosTodos.length > 1) {
    add('custos', '(−) Custos — CMV / CPV / CSP', custos, { tipo: 'item' });
    itensDe('custos', '    ');
  } else {
    add('custos', '(−) Custos — CMV, insumos e mercadorias', custos, { tipo: 'item', detalhe: detalheDe(custosTodos[0]) });
  }
  add('lucro_bruto', '(=) Lucro bruto', lucroBruto, { tipo: 'total' });
  linhas.push({ id: 'sec_desp', rotulo: 'Despesas operacionais', tipo: 'secao' });
  itensDe('despesas', '');
  add('despesas', '(=) Total de despesas operacionais', despesas, { tipo: 'subtotal' });
  add('resultado_operacional', '(=) Resultado operacional', resultadoOperacional, { tipo: 'total' });
  if ([...acc.values()].some((a) => a.meta.secao === 'outras')) {
    linhas.push({ id: 'sec_outras', rotulo: 'Outras receitas e despesas', tipo: 'secao' });
    itensDe('outras', '');
    add('resultado_periodo', '(=) Resultado do período', resultadoPeriodo, { tipo: 'total' });
  }
  linhas.push({ id: 'sec_fora', rotulo: 'Saídas fora do resultado (não são despesa da empresa)', tipo: 'secao' });
  itensDe('fora', '');
  add('fora', '(=) Total fora do resultado', fora, { tipo: 'subtotal' });
  linhas.push({ id: 'sec_ident', rotulo: 'Ainda não identificados (Valores a Identificar)', tipo: 'secao' });
  add('identificar_saidas', 'Saídas a identificar', idSaidas, { tipo: 'item', alerta: true, detalhe: detalheDe(identificar.saidas.detalhe.size ? identificar.saidas : null) });
  add('identificar_entradas', 'Entradas a identificar', idEntradas, { tipo: 'item', alerta: true, detalhe: detalheDe(identificar.entradas.detalhe.size ? identificar.entradas : null) });
  add('resultado_pior_caso', '(=) Resultado operacional se as saídas a identificar forem custo/despesa', op(op(resultadoOperacional, idSaidas, (x, y) => x - y), idEntradas, (x, y) => x + y), { tipo: 'subtotal', alerta: true });
  linhas.push({ id: 'sec_conc', rotulo: 'Conciliação com o extrato', tipo: 'secao' });
  add('receita_lancamentos', 'Receita nos lançamentos', receitaLanc, { tipo: 'item', detalhe: detalheDe(acc.get('receita')) });
  add('dif_receita', 'Receita bruta − receita nos lançamentos', op(receitaBruta, receitaLanc, (x, y) => x - y), { tipo: 'item' });
  add('entradas', 'Entradas no banco (todas)', entradas, { tipo: 'item', detalhe: detalheDe(caixa.entradas) });
  add('saidas', '(−) Saídas no banco (todas)', saidas, { tipo: 'item', detalhe: detalheDe(caixa.saidas) });
  add('variacao', '(=) Variação do caixa no mês', variacao, { tipo: 'total' });
  add('saldo', 'Saldo em conta no fim do mês', saldoFim, { tipo: 'item', semTotal: true, totalExibido: saldoFim[meses.at(-1)] ?? 0 });

  const receitaTotal = total(receitaBruta);
  for (const l of linhas) {
    if (l.tipo === 'secao') continue;
    l.pctReceita = receitaTotal && !l.semTotal ? (l.total / receitaTotal) * 100 : null;
  }

  const serie = {
    receitaBruta, das, receitaLiquida, custos, lucroBruto, despesas, resultadoOperacional,
    resultadoPeriodo, fora, entradas, saidas, variacao, saldoFim, idSaidas, idEntradas, receitaLanc,
  };
  const indicadores = calcularIndicadores({ meses, serie, qtdLanc, qtdIdentificar, fonteReceita, fonteDas });
  const pontos = gerarPontosDeAtencao({ meses, serie, indicadores, fonteReceita, fonteDas });

  return { meses, linhas, serie, indicadores, pontos, fonteReceita, fonteDas, qtdLancamentos: qtdLanc, qtdAIdentificar: qtdIdentificar };
}

// ---------- indicadores ----------

const pct = (a, b) => (b ? (a / b) * 100 : null);
const varPct = (atual, anterior) => (anterior ? ((atual - anterior) / Math.abs(anterior)) * 100 : null);

export function calcularIndicadores({ meses, serie, qtdLanc = 0, qtdIdentificar = 0 }) {
  const ult = meses.at(-1);
  const ant = meses.length > 1 ? meses.at(-2) : null;
  const s = (k, m) => (m ? serie[k][m] ?? 0 : null);
  const tot = (k) => meses.reduce((acc, m) => acc + (serie[k][m] ?? 0), 0);

  const receita = tot('receitaBruta');
  const custos = tot('custos');
  const despesas = tot('despesas');
  const lucroBruto = tot('lucroBruto');
  const resultadoOp = tot('resultadoOperacional');
  const das = tot('das');
  const saidasBanco = tot('saidas');
  const idSaidas = tot('idSaidas');
  const margemContribuicao = pct(lucroBruto, receita);

  const margemOp = (m) => pct(s('resultadoOperacional', m), s('receitaBruta', m));
  const margemOpUlt = margemOp(ult);
  const margemOpAnt = ant ? margemOp(ant) : null;

  return {
    mesReferencia: ult,
    mesAnterior: ant,
    receitaBruta: { periodo: receita, ultimo: s('receitaBruta', ult), variacao: ant ? varPct(s('receitaBruta', ult), s('receitaBruta', ant)) : null },
    resultadoOperacional: { periodo: resultadoOp, ultimo: s('resultadoOperacional', ult), variacao: ant ? varPct(s('resultadoOperacional', ult), s('resultadoOperacional', ant)) : null },
    margemOperacional: { periodo: pct(resultadoOp, receita), ultimo: margemOpUlt, variacaoPp: margemOpUlt != null && margemOpAnt != null ? margemOpUlt - margemOpAnt : null },
    margemBruta: { periodo: pct(lucroBruto, receita) },
    cmvSobreReceita: { periodo: pct(custos, receita) },
    despesasSobreReceita: { periodo: pct(despesas, receita) },
    cargaTributaria: { periodo: pct(das, receita) },
    foraDoResultado: { periodo: tot('fora'), ultimo: s('fora', ult), variacao: ant ? varPct(s('fora', ult), s('fora', ant)) : null },
    saldoEmConta: { ultimo: s('saldoFim', ult), variacaoCaixaPeriodo: tot('variacao') },
    pontoEquilibrio: { mensal: despesas > 0 && margemContribuicao && margemContribuicao > 0 ? (despesas / meses.length) / (margemContribuicao / 100) : null },
    identificacao: {
      pctSaidasIdentificadas: saidasBanco ? Math.max(0, 100 - (idSaidas / saidasBanco) * 100) : null,
      valorAIdentificar: idSaidas + tot('idEntradas'),
      qtdAIdentificar: qtdIdentificar,
      qtdLancamentos: qtdLanc,
    },
  };
}

// ---------- pontos de atenção ----------

const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const p1 = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function gerarPontosDeAtencao({ meses, serie, indicadores, fonteReceita = {}, fonteDas = {} }) {
  const pontos = [];
  const ind = indicadores;
  const ult = ind.mesReferencia;
  if (!ult) return pontos;

  const pctIdent = ind.identificacao.pctSaidasIdentificadas;
  if (pctIdent != null && pctIdent < 80) {
    pontos.push({
      id: 'identificar', severidade: pctIdent < 50 ? 'Alta' : 'Média', status: 'Aberto',
      titulo: 'Saídas sem identificação',
      achado: `Só ${p1(pctIdent)} das saídas do banco estão classificadas; ${brl(ind.identificacao.valorAIdentificar)} seguem em "Valores a Identificar" (${ind.identificacao.qtdAIdentificar} lançamentos).`,
      impacto: 'Custos e despesas ficam subavaliados e o resultado aparece maior do que é.',
      acao: 'Rodar "Identificar com NFs e IA" na aba Lançamentos e revisar as sugestões; criar regras para as contrapartes recorrentes.',
      responsavel: 'Escritório', prazo: 'Antes de fechar o mês',
    });
  }

  const resUlt = serie.resultadoOperacional[ult] ?? 0;
  if (resUlt < 0) {
    pontos.push({
      id: 'prejuizo', severidade: 'Alta', status: 'Aberto', titulo: 'Resultado operacional negativo',
      achado: `Em ${rotuloMes(ult)} o resultado operacional foi ${brl(resUlt)}.`,
      impacto: 'A operação consumiu caixa no mês.',
      acao: 'Revisar custos e despesas que mais cresceram e a precificação dos produtos.', responsavel: 'Empresa + escritório', prazo: '30 dias',
    });
  }

  const semPgdas = meses.filter((m) => fonteReceita[m] !== 'pgdas');
  if (semPgdas.length) {
    pontos.push({
      id: 'pgdas', severidade: 'Média', status: 'Aberto', titulo: 'Meses sem PGDAS-D',
      achado: `Sem faturamento do PGDAS em ${semPgdas.map(rotuloMes).join(', ')} — a receita desses meses veio dos lançamentos.`,
      impacto: 'A receita bruta pode não bater com a declarada.',
      acao: 'Importar a declaração do Simples (PGDAS-D) desses meses.', responsavel: 'Escritório', prazo: 'Próxima apuração',
    });
  }
  const semDas = meses.filter((m) => fonteReceita[m] === 'pgdas' && fonteDas[m] !== 'pgdas');
  if (semDas.length) {
    pontos.push({
      id: 'das', severidade: 'Média', status: 'Aberto', titulo: 'DAS não informado',
      achado: `O PGDAS de ${semDas.map(rotuloMes).join(', ')} está sem valor do DAS.`,
      impacto: 'A receita líquida desses meses fica sem o imposto.',
      acao: 'Conferir a declaração e reimportar com o valor do DAS.', responsavel: 'Escritório', prazo: 'Próxima apuração',
    });
  }

  const rb = serie.receitaBruta[ult] ?? 0;
  const rl = serie.receitaLanc[ult] ?? 0;
  if (fonteReceita[ult] === 'pgdas' && rb > 0 && rl > 0 && Math.abs(rb - rl) / rb > 0.1) {
    pontos.push({
      id: 'conciliacao_receita', severidade: 'Média', status: 'Aberto', titulo: 'Receita declarada × recebida',
      achado: `Em ${rotuloMes(ult)} o PGDAS declara ${brl(rb)} e os lançamentos de receita somam ${brl(rl)} (${p1(((rl - rb) / rb) * 100)}).`,
      impacto: 'Pode haver receita fora do banco (cartão, iFood, dinheiro) ou entrada classificada errada.',
      acao: 'Conferir repasses de marketplaces/maquininhas e as entradas a identificar.', responsavel: 'Escritório', prazo: '15 dias',
    });
  }

  const foraPct = ind.receitaBruta.periodo ? (ind.foraDoResultado.periodo / ind.receitaBruta.periodo) * 100 : 0;
  if (foraPct > 20) {
    pontos.push({
      id: 'fora', severidade: 'Média', status: 'Aberto', titulo: 'Muito dinheiro saindo fora do resultado',
      achado: `Saídas fora do resultado somam ${brl(ind.foraDoResultado.periodo)} (${p1(foraPct)} da receita).`,
      impacto: 'Retiradas e gastos pessoais pela conta da empresa reduzem o caixa sem aparecer como despesa.',
      acao: 'Definir pró-labore/retirada fixa e separar gastos pessoais da conta PJ.', responsavel: 'Empresa', prazo: 'Planejamento',
    });
  }

  const cmv = ind.cmvSobreReceita.periodo;
  if (cmv != null && cmv > 60) {
    pontos.push({
      id: 'cmv', severidade: 'Média', status: 'Aberto', titulo: 'CMV alto',
      achado: `Custos representam ${p1(cmv)} da receita.`,
      impacto: 'Pouca margem pra pagar despesas fixas.',
      acao: 'Revisar precificação (aba Precificação) e negociar com fornecedores das NFs de entrada.', responsavel: 'Empresa', prazo: '60 dias',
    });
  }

  const vpp = ind.margemOperacional.variacaoPp;
  if (vpp != null && vpp < -5) {
    pontos.push({
      id: 'margem', severidade: 'Planejamento', status: 'Aberto', titulo: 'Margem operacional caiu',
      achado: `A margem operacional caiu ${p1(-vpp).replace('%', ' p.p.')} de ${rotuloMes(ind.mesAnterior)} para ${rotuloMes(ult)}.`,
      impacto: 'Tendência de piora do resultado se repetir.',
      acao: 'Acompanhar as linhas de despesa que mais subiram no detalhamento.', responsavel: 'Escritório', prazo: 'Próximo fechamento',
    });
  }

  if ((serie.saldoFim[ult] ?? 0) < 0) {
    pontos.push({
      id: 'saldo', severidade: 'Planejamento', status: 'Aberto', titulo: 'Saldo contábil negativo',
      achado: `O saldo de caixa e bancos no fim de ${rotuloMes(ult)} ficou em ${brl(serie.saldoFim[ult])}.`,
      impacto: 'Falta o saldo inicial do extrato ou algum extrato não foi importado.',
      acao: 'Lançar o saldo de abertura e conferir se todos os extratos do período foram importados.', responsavel: 'Escritório', prazo: 'Próximo fechamento',
    });
  }

  const ordem = { Alta: 0, 'Média': 1, Planejamento: 2 };
  return pontos.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}

// frase-resumo do último mês, como no modelo
export function fraseResumo(dre) {
  const ind = dre.indicadores;
  const m = ind.mesReferencia;
  if (!m) return '';
  const rb = dre.serie.receitaBruta[m] ?? 0;
  const ro = dre.serie.resultadoOperacional[m] ?? 0;
  const mo = ind.margemOperacional.ultimo;
  const fora = dre.serie.fora[m] ?? 0;
  const partes = [`Em ${rotuloMes(m)} a receita bruta foi ${brl(rb)}`];
  if (ind.receitaBruta.variacao != null) partes[0] += ` (${ind.receitaBruta.variacao >= 0 ? '+' : ''}${p1(ind.receitaBruta.variacao)} sobre o mês anterior)`;
  partes.push(`o resultado operacional ficou em ${brl(ro)}${mo != null ? ` (margem de ${p1(mo)})` : ''}`);
  if (fora > 0) partes.push(`${brl(fora)} saíram fora do resultado`);
  const idv = dre.serie.idSaidas[m] ?? 0;
  if (idv > 0) partes.push(`e ${brl(idv)} em saídas ainda aguardam identificação`);
  return partes.join(', ').replace(/, e /, ' e ') + '.';
}

// ---------- dados (Supabase) ----------

async function paginar(montarQuery) {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montarQuery().range(de, de + 999);
    if (error) throw error;
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

export async function carregarDadosDreGerencialCom(supabase, empresaId, { dataInicio, dataFim }) {
  const [contas, lancamentos, pgdasResp] = await Promise.all([
    paginar(() => supabase.from('contas_contabeis').select('id, codigo, nome, tipo, aceita_lancamento, ativo').eq('empresa_id', empresaId).order('codigo')),
    paginar(() => supabase
      .from('lancamentos_contabeis')
      .select('id, data, historico, conciliado, partidas_contabeis(id, conta_id, tipo, valor)')
      .eq('empresa_id', empresaId)
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .order('data')
      .order('id')),
    supabase.from('dados_gerenciais_simples').select('competencia, faturamento_periodo, valor_das').eq('cliente_id', empresaId),
  ]);
  // PGDAS é opcional: sem permissão/tabela, a DRE sai só pelos lançamentos
  const pgdas = pgdasResp.error ? [] : (pgdasResp.data ?? []);

  const idsDisponiveis = contas.filter((c) => ehDisponivel(c.codigo)).map((c) => c.id);
  let saldoAnterior = 0;
  if (idsDisponiveis.length) {
    const mov = await paginar(() => supabase
      .from('vw_movimento_contas')
      .select('conta_id, data, total_debito, total_credito')
      .eq('empresa_id', empresaId)
      .in('conta_id', idsDisponiveis)
      .lt('data', dataInicio)
      .order('data'));
    saldoAnterior = r2(mov.reduce((s, m) => s + Number(m.total_debito || 0) - Number(m.total_credito || 0), 0));
  }
  return { contas, lancamentos, pgdas, saldoAnterior, dataInicio, dataFim };
}
