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
// A conta pode ir como classificação (1.1.01.002) — é o que mandamos.
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
// Sub-contas de fornecedor criadas pelo Gestor (tela de Notas Fiscais) não
// existem no OneFlow — lá o plano agrupa todos os fornecedores numa conta só.
const PREFIXOS_AGRUPADOS = [
  ['2.1.01.', '2.1.01.001'], // grupo Fornecedores do Plano Enxuto
  ['2.1.06.001.', '2.1.01.001'], // grupo Fornecedores criado sobre o plano padrão
];

export function converterCodigo(codigo, modo) {
  if (!codigo) return null;
  if (modo === 'mesmo') return codigo;
  if (CODIGOS_ENXUTO.has(codigo)) return codigo;
  if (DEPARA_PADRAO_ENXUTO[codigo]) return DEPARA_PADRAO_ENXUTO[codigo];
  const agrupado = PREFIXOS_AGRUPADOS.find(([prefixo]) => codigo.startsWith(prefixo));
  return agrupado ? agrupado[1] : null;
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
export function montarLinhasOneflow(lancamentos, modo) {
  const linhas = [];
  const semConta = new Map(); // código Gestor -> nome, contas sem correspondência
  let pendentes = 0;
  const ordenados = [...lancamentos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  for (const l of ordenados) {
    const partidas = l.partidas_contabeis ?? [];
    if (partidas.some((p) => ehContaPendente(p.contas_contabeis?.codigo))) pendentes += 1;
    for (const par of quebrarEmPartidasSimples(partidas)) {
      const cd = par.debito.contas_contabeis?.codigo;
      const cc = par.credito.contas_contabeis?.codigo;
      const d = converterCodigo(cd, modo);
      const c = converterCodigo(cc, modo);
      if (!d) semConta.set(cd, par.debito.contas_contabeis?.nome);
      if (!c) semConta.set(cc, par.credito.contas_contabeis?.nome);
      if (!d || !c) continue;
      linhas.push({ data: l.data, debito: d, credito: c, historico: historicoOneflow(l), valor: par.valor });
    }
  }
  return { linhas, semConta: [...semConta].map(([codigo, nome]) => ({ codigo, nome })), pendentes };
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
  XLSX.writeFile(wb, nomeArquivo, { compression: true });
}
