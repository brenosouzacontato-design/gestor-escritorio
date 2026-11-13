// Exporta os lançamentos do Gestor no layout de importação do OneFlow
// ("Planilha de Lançamentos — partidas simples", versão 1.0.0 do modelo).
//
// No OneFlow: Contábil > Lançamentos > Importar lançamentos > Planilha de
// Lançamentos > partidas simples. Cada linha = 1 débito + 1 crédito.
//
// Layout (igual ao modelo baixado do OneFlow):
//   aba "OneFlow_Lancamento_Contabil", cabeçalho na linha 6, dados a partir
//   da linha 7, colunas B Data | C Conta Devedora | D Conta Credora |
//   E Histórico (máx. 60) | F Valor; aba "Config" com nome/versão/range.
// A conta pode ir como classificação (1.1.01.002) — é o que mandamos — ou,
// pra cliente/fornecedor, como CNPJ.
//
// Divisão de trabalho com o OneFlow:
//  - Fiscal do OneFlow lança as notas: vendas (D Clientes Diversos — conta
//    agrupada / C Receita) e compras/serviços tomados (D Despesa / C conta
//    INDIVIDUAL do fornecedor, criada pelo próprio OneFlow).
//  - Gestor manda o extrato: recebimentos (D Banco / C Clientes Diversos) e
//    pagamentos — a BAIXA do fornecedor vai com o CNPJ dele, pra cair na
//    conta individual que o Fiscal criou.
// Por isso lançamentos gerados no Gestor a partir de nota fiscal (aba Notas
// Fiscais) NÃO são exportados: o OneFlow já tem a provisão pelo Fiscal.
import * as XLSX from 'xlsx';
import PLANO_ENXUTO from './planos/plano_contas_enxuto.json';
import DEPARA_PADRAO_ENXUTO from './planos/depara_padrao_para_enxuto.json';
import { ehContaPendente } from './planoContasConstantes';

const CODIGOS_ENXUTO = new Set(PLANO_ENXUTO.filter((c) => !c.sintetica).map((c) => c.codigo));
const LIMITE_HISTORICO = 60;

// Converte o código da conta do Gestor pro código do plano usado no OneFlow.
//  - 'enxuto': empresa usa o Plano Enxuto no OneFlow. Conta que já é do
//    enxuto vai direto; conta do plano padrão antigo passa pelo de-para.
//  - 'mesmo': OneFlow usa o mesmo plano do Gestor (ex.: padrão OneFlow) —
//    manda o código como está.
// Sub-contas de fornecedor do Gestor (grupo "Fornecedores", criadas pela aba
// Notas Fiscais): no OneFlow cada fornecedor tem conta individual criada pelo
// Fiscal, que a planilha localiza pelo CNPJ.
//  - Plano Enxuto: filhas de 2.1.01 (menos 2.1.01.001 Fornecedores Diversos);
//  - plano padrão: filhas do grupo "Fornecedores" 2.1.06.001.NNN (6+ níveis).
export function ehContaFornecedorIndividual(conta) {
  const codigo = conta?.codigo || '';
  if (conta?.cnpj) return true;
  if (codigo.startsWith('2.1.01.') && codigo !== '2.1.01.001') return true;
  return codigo.startsWith('2.1.06.001.') && codigo.split('.').length >= 6;
}

export function converterCodigo(codigo, modo) {
  if (!codigo) return null;
  if (modo === 'mesmo') return codigo;
  if (CODIGOS_ENXUTO.has(codigo)) return codigo;
  return DEPARA_PADRAO_ENXUTO[codigo] ?? null;
}

// Conta da partida no formato da planilha: CNPJ pra fornecedor individual,
// senão o código (convertido pelo plano escolhido).
function contaParaOneflow(conta, modo) {
  if (ehContaFornecedorIndividual(conta)) return conta.cnpj ? conta.cnpj.replace(/\D/g, '') : null;
  return converterCodigo(conta?.codigo, modo);
}

// Quebra um lançamento de N débitos x M créditos em pares débito/crédito
// (partidas simples), casando os valores em centavos. Lançamento 1x1 vira
// uma linha; 1xN vira N linhas; NxM é casado em ordem.
export function quebrarEmPartidasSimples(partidas) {
  const centavos = (v) => Math.round(Number(v) * 100);
  const deb = partidas.filter((p) => p.tipo === 'debito').map((p) => ({ p, resto: centavos(p.valor) }));
  const cre = partidas.filter((p) => p.tipo === 'credito').map((p) => ({ p, resto: centavos(p.valor) }));
  const pares = [];
  let i = 0;
  let j = 0;
  while (i < deb.length && j < cre.length) {
    const v = Math.min(deb[i].resto, cre[j].resto);
    if (v > 0) pares.push({ debito: deb[i].p, credito: cre[j].p, valor: v / 100 });
    deb[i].resto -= v;
    cre[j].resto -= v;
    if (deb[i].resto === 0) i += 1;
    if (cre[j].resto === 0) j += 1;
  }
  return pares;
}

function historicoOneflow(l) {
  const base = (l.historico || '').replace(/\s+/g, ' ').trim();
  const doc = l.numero_documento ? ` Doc ${l.numero_documento}` : '';
  const texto = base.length + doc.length <= LIMITE_HISTORICO ? base + doc : base;
  return texto.slice(0, LIMITE_HISTORICO) || 'Lancamento';
}

// Monta as linhas + o relatório do que não deu pra converter.
// idsDoFiscal: ids de lançamentos gerados a partir de nota fiscal — ficam de
// fora (o OneFlow já recebe a provisão pelo Fiscal).
export function montarLinhasOneflow(lancamentos, modo, idsDoFiscal = new Set()) {
  const linhas = [];
  const semConta = new Map(); // código Gestor -> nome, contas sem correspondência
  const fornecedoresSemCnpj = new Map();
  let pendentes = 0;
  let ignoradosFiscal = 0;
  const ordenados = [...lancamentos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  for (const l of ordenados) {
    if (idsDoFiscal.has(l.id)) { ignoradosFiscal += 1; continue; }
    const partidas = l.partidas_contabeis ?? [];
    if (partidas.some((p) => ehContaPendente(p.contas_contabeis?.codigo))) pendentes += 1;
    for (const par of quebrarEmPartidasSimples(partidas)) {
      const contaD = par.debito.contas_contabeis;
      const contaC = par.credito.contas_contabeis;
      const d = contaParaOneflow(contaD, modo);
      const c = contaParaOneflow(contaC, modo);
      for (const [conta, convertida] of [[contaD, d], [contaC, c]]) {
        if (convertida) continue;
        if (ehContaFornecedorIndividual(conta)) fornecedoresSemCnpj.set(conta?.codigo, conta?.nome);
        else semConta.set(conta?.codigo, conta?.nome);
      }
      if (!d || !c) continue;
      linhas.push({ data: l.data, debito: d, credito: c, historico: historicoOneflow(l), valor: par.valor });
    }
  }
  const lista = (m) => [...m].map(([codigo, nome]) => ({ codigo, nome }));
  return { linhas, semConta: lista(semConta), fornecedoresSemCnpj: lista(fornecedoresSemCnpj), pendentes, ignoradosFiscal };
}

export function gerarPlanilhaOneflow(linhas) {
  const aoa = [
    [], [], [], [],
    [null, '(obrigatório) DD/MM/AAAA', '(obrigatório) Cód. Reduzido ou Classificação', '(obrigatório) Cód. Reduzido ou Classificação', '(obrigatório) texto', '(obrigatório) número'],
    [null, 'Data do lançamento *', 'Conta Contábil Devedora *', 'Conta Contábil Credora *', 'Histórico *', 'Valor *'],
    ...linhas.map((l) => {
      // data como número serial do Excel (dia inteiro, sem hora/fuso)
      const [a, m, d] = l.data.split('-').map(Number);
      const serial = (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
      return [null, serial, l.debito, l.credito, l.historico, l.valor];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 7; r < 7 + linhas.length; r += 1) {
    const cel = ws[`B${r}`];
    if (cel) cel.z = 'dd/mm/yyyy';
    const val = ws[`F${r}`];
    if (val) val.z = '#,##0.00';
  }
  ws['!cols'] = [{ wch: 2 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 62 }, { wch: 14 }];

  const config = XLSX.utils.aoa_to_sheet([
    ['Configurações'],
    ['Planilha', 'OneFlow_Lancamento_Contabil'],
    ['Versão', '1.0.0'],
    ['Range', 'B7:Z10006'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OneFlow_Lancamento_Contabil');
  XLSX.utils.book_append_sheet(wb, config, 'Config');
  return wb;
}

export function baixarPlanilhaOneflow(wb, nomeArquivo) {
  // bookSST: strings na tabela compartilhada — o importador do OneFlow não lê
  // células com texto inline (planilha importada vinha vazia)
  XLSX.writeFile(wb, nomeArquivo, { compression: true, bookSST: true });
}

// Plano que a empresa usa no OneFlow, lembrado por empresa neste navegador:
// "enxuto" (padrão; contas do plano padrão antigo passam pelo de-para) ou
// "mesmo" (manda o código do Gestor como está).
const chaveModo = (empresaId) => `oneflow_plano_${empresaId}`;
export function lerModoOneflow(empresaId) {
  try { return localStorage.getItem(chaveModo(empresaId)) || 'enxuto'; } catch { return 'enxuto'; }
}
export function gravarModoOneflow(empresaId, modo) {
  try { localStorage.setItem(chaveModo(empresaId), modo); } catch { /* sem storage: só não lembra */ }
}

export function nomeArquivoOneflow(empresaNome, dataInicio, dataFim) {
  const slug = (empresaNome || 'empresa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  return `OneFlow_Lancamentos_${slug}_${dataInicio}_a_${dataFim}.xlsx`;
}
