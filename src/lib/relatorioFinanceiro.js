// src/lib/relatorioFinanceiro.js
//
// Relatório financeiro (aba Relatório do Financeiro,
// src/pages/contabil/RelatorioFinanceiroTab.jsx): o dinheiro que entrou e
// saiu do banco no período, separado pelo que ele foi — receitas,
// adiantamentos, pagamentos a fornecedores (um a um), despesas, impostos,
// sócios, empréstimos... — olhando a contrapartida de cada lançamento.
// Puro, sem Supabase — testado em src/lib/__tests__/relatorioFinanceiro.test.mjs.
// Entrada: lançamentos de listarLancamentos (partidas_contabeis com
// contas_contabeis aninhadas).

import { classificarLancamento } from './resumoFinanceiro.js';
import { contraparteDoHistorico } from './dreGerencial.js';

// Conta individual de fornecedor — mesma regra de ehContaFornecedorIndividual
// (src/pages/contabil/exportarOneflow.js), repetida aqui porque aquele módulo
// importa JSON e xlsx e não roda nos testes em Node.
//  - Plano Enxuto: filhas de 2.1.01 (menos 2.1.01.001 Fornecedores Diversos);
//  - plano padrão: filhas do grupo "Fornecedores" 2.1.06.001.NNN (6+ níveis).
export function ehContaFornecedorIndividual(conta) {
  const codigo = conta?.codigo || '';
  if (conta?.cnpj) return true;
  if (codigo.startsWith('2.1.01.') && codigo !== '2.1.01.001') return true;
  return codigo.startsWith('2.1.06.001.') && codigo.split('.').length >= 6;
}

const r2 = (v) => Math.round(v * 100) / 100;
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Categorias na ordem em que aparecem no relatório. `porContraparte`: o
// detalhe agrupa por quem pagou/recebeu (cliente, fornecedor); senão por conta.
export const CATEGORIAS = {
  entrada: [
    { id: 'receitas', rotulo: 'Receitas', desc: 'Vendas, serviços e recebimentos de clientes', porContraparte: true },
    { id: 'adiantamentos', rotulo: 'Adiantamentos recebidos', desc: 'Adiantamentos de clientes e devoluções de adiantamentos', porContraparte: true },
    { id: 'emprestimos', rotulo: 'Empréstimos e financiamentos', desc: 'Crédito tomado' },
    { id: 'socios', rotulo: 'Sócios', desc: 'Aportes e capital' },
    { id: 'aplicacoes', rotulo: 'Resgate de aplicações', desc: '' },
    { id: 'outros', rotulo: 'Outras entradas', desc: '' },
    { id: 'identificar', rotulo: 'A identificar', desc: 'Ainda sem classificação', porContraparte: true },
  ],
  saida: [
    { id: 'fornecedores', rotulo: 'Pagamentos a fornecedores', desc: 'Por fornecedor', porContraparte: true },
    { id: 'adiantamentos', rotulo: 'Adiantamentos concedidos', desc: 'A fornecedores, funcionários e outros', porContraparte: true },
    { id: 'despesas', rotulo: 'Despesas e custos', desc: 'Por conta de despesa' },
    { id: 'impostos', rotulo: 'Impostos e encargos', desc: 'Guias, tributos e obrigações trabalhistas' },
    { id: 'socios', rotulo: 'Sócios', desc: 'Retiradas, pró-labore e lucros distribuídos' },
    { id: 'emprestimos', rotulo: 'Empréstimos e cartão', desc: 'Parcelas, financiamentos e fatura do cartão' },
    { id: 'aplicacoes', rotulo: 'Aplicações financeiras', desc: '' },
    { id: 'outros', rotulo: 'Outras saídas', desc: '' },
    { id: 'identificar', rotulo: 'A identificar', desc: 'Ainda sem classificação', porContraparte: true },
  ],
};

// Em que categoria cai a contrapartida de uma entrada/saída de banco.
export function categoriaDaConta(conta, natureza) {
  if (!conta) return 'outros';
  const codigo = conta.codigo ?? '';
  const nome = semAcento(conta.nome);
  const tipo = conta.tipo;

  if (/adiant/.test(nome)) return 'adiantamentos';
  if (natureza === 'saida' && (ehContaFornecedorIndividual(conta) || /fornecedor/.test(nome))) return 'fornecedores';
  if (tipo === 'receita' || codigo.startsWith('3')) {
    // dedução da receita paga (Simples sobre faturamento, devolução) é saída de imposto
    return natureza === 'entrada' ? 'receitas' : (/simples|imposto|tribut|das\b/.test(nome) ? 'impostos' : 'despesas');
  }
  if (natureza === 'entrada' && /cliente|a receber|adquirente|duplicatas/.test(nome)) return 'receitas';
  if (/aplica|investimento|cdb|poupanca/.test(nome)) return 'aplicacoes';
  if (tipo === 'despesa' || tipo === 'custo' || /^[456]/.test(codigo)) return 'despesas';
  if (tipo === 'patrimonio_liquido' || /socio|lucro|capital|pro-?labore/.test(nome)) return 'socios';
  if (/emprestimo|financiamento|cartao de credito|consorcio/.test(nome)) return 'emprestimos';
  if (/simples|inss|fgts|irrf|irpj|csll|pis|cofins|icms|iss|tribut|imposto|parcelamento|recolher|salario|ferias|13/.test(nome)) return 'impostos';
  return 'outros';
}

const chaveTexto = (s) => semAcento(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * @param {Array} lancamentos  de listarLancamentos
 * @returns {{ totais, entradas: Array, saidas: Array, fornecedores: Array, porMes: Array }}
 *   entradas/saidas: [{ id, rotulo, desc, total, qtd, pct, itens: [{ chave, nome, codigo, cnpj, total, qtd, ultimaData, lancamentos }] }]
 */
export function montarRelatorioFinanceiro(lancamentos) {
  const grupos = { entrada: new Map(), saida: new Map() };
  const totais = { entradas: 0, saidas: 0, transferencias: 0, qtd: 0 };
  const porMes = new Map();

  for (const l of lancamentos) {
    const c = classificarLancamento(l);
    if (c.natureza === 'transferencia') { totais.transferencias += c.valor; continue; }
    if (c.natureza !== 'entrada' && c.natureza !== 'saida') continue;
    totais.qtd += 1;
    const ent = c.natureza === 'entrada';
    if (ent) totais.entradas += c.valor; else totais.saidas += c.valor;

    const cat = c.pendente ? 'identificar' : categoriaDaConta(c.contrapartida, c.natureza);
    const def = CATEGORIAS[c.natureza].find((x) => x.id === cat);

    const mes = String(l.data).slice(0, 7);
    const m = porMes.get(mes) ?? { mes, entradas: {}, saidas: {} };
    const ladoMes = ent ? m.entradas : m.saidas;
    ladoMes[cat] = (ladoMes[cat] ?? 0) + c.valor;
    porMes.set(mes, m);

    // detalhe: por contraparte (cliente/fornecedor) ou por conta
    const conta = c.contrapartida;
    let chave; let nome; let cnpj = null; let codigo = '';
    const individual = cat === 'fornecedores' && conta && ehContaFornecedorIndividual(conta);
    if (individual) {
      chave = `conta:${conta.codigo}`; nome = conta.nome; cnpj = conta.cnpj ?? null; codigo = conta.codigo;
    } else if (def.porContraparte) {
      nome = contraparteDoHistorico(l.historico);
      chave = `txt:${chaveTexto(nome)}`;
    } else {
      chave = `conta:${conta?.codigo ?? '?'}`; nome = conta?.nome ?? 'Sem conta'; codigo = conta?.codigo ?? '';
    }

    const mapa = grupos[c.natureza];
    const g = mapa.get(cat) ?? { ...def, total: 0, qtd: 0, itens: new Map() };
    g.total += c.valor;
    g.qtd += 1;
    const it = g.itens.get(chave) ?? { chave, nome, codigo, cnpj, total: 0, qtd: 0, ultimaData: null, contas: new Set(), lancamentos: [] };
    it.total += c.valor;
    it.qtd += 1;
    if (!it.ultimaData || l.data > it.ultimaData) it.ultimaData = l.data;
    if (conta?.nome && !c.pendente) it.contas.add(conta.nome);
    it.lancamentos.push({ id: l.id, data: l.data, historico: l.historico ?? '', valor: c.valor, conta: c.pendente ? 'A identificar' : (conta?.nome ?? '') });
    g.itens.set(chave, it);
    mapa.set(cat, g);
  }

  const fechar = (natureza, totalLado) => CATEGORIAS[natureza]
    .map((def) => grupos[natureza].get(def.id))
    .filter(Boolean)
    .map((g) => ({
      ...g,
      total: r2(g.total),
      pct: totalLado ? Math.round((g.total / totalLado) * 1000) / 10 : 0,
      itens: [...g.itens.values()]
        .map((it) => ({
          ...it,
          total: r2(it.total),
          contas: [...it.contas],
          lancamentos: it.lancamentos.sort((a, b) => String(a.data).localeCompare(String(b.data))),
        }))
        .sort((a, b) => b.total - a.total),
    }));

  const entradas = fechar('entrada', totais.entradas);
  const saidas = fechar('saida', totais.saidas);
  totais.entradas = r2(totais.entradas);
  totais.saidas = r2(totais.saidas);
  totais.transferencias = r2(totais.transferencias);
  totais.saldo = r2(totais.entradas - totais.saidas);

  const total = (lado, id) => lado.find((g) => g.id === id)?.total ?? 0;
  const destaques = {
    receitas: total(entradas, 'receitas'),
    adiantamentosRecebidos: total(entradas, 'adiantamentos'),
    adiantamentosConcedidos: total(saidas, 'adiantamentos'),
    fornecedores: total(saidas, 'fornecedores'),
    qtdFornecedores: saidas.find((g) => g.id === 'fornecedores')?.itens.length ?? 0,
    despesas: total(saidas, 'despesas'),
    identificar: r2(total(entradas, 'identificar') + total(saidas, 'identificar')),
  };

  return {
    totais,
    destaques,
    entradas,
    saidas,
    porMes: [...porMes.values()]
      .map((m) => {
        const soma = (o) => r2(Object.values(o).reduce((s, v) => s + v, 0));
        const arred = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]));
        const ent = soma(m.entradas); const sai = soma(m.saidas);
        return { mes: m.mes, entradas: arred(m.entradas), saidas: arred(m.saidas), totalEntradas: ent, totalSaidas: sai, saldo: r2(ent - sai) };
      })
      .sort((a, b) => a.mes.localeCompare(b.mes)),
  };
}
