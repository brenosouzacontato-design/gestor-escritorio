import * as XLSX from 'xlsx';

// Extrai transações de uma planilha (.xlsx/.xls) de extrato bancário sem
// passar pelo Claude (diferente do PDF) — a maioria dos extratos em Excel já
// vem em colunas bem definidas, então um mapeamento de cabeçalho por nome
// (tolerante a acento/maiúscula) é suficiente, instantâneo e sem custo de API.

const SEM_ACENTO = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const ALIASES = {
  data: ['data', 'dt', 'data lancamento', 'data lanc', 'data movimento', 'data mov'],
  historico: ['historico', 'descricao', 'lancamento', 'operacao', 'detalhes', 'complemento', 'movimentacao'],
  valor: ['valor', 'valor (r$)', 'valor r$', 'montante'],
  debito: ['debito', 'saida', 'valor debito', 'debitos'],
  credito: ['credito', 'entrada', 'valor credito', 'creditos'],
  documento: ['documento', 'nº documento', 'no documento', 'numero documento', 'doc', 'identificador', 'n° doc', 'nº doc'],
};

function acharColuna(headerRow, aliases) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = SEM_ACENTO(headerRow[i]);
    if (!h) continue;
    if (aliases.some((a) => h === a || h.includes(a))) return i;
  }
  return -1;
}

// procura, nas primeiras linhas da planilha, a linha de cabeçalho que tem
// pelo menos "data" e ("valor" ou "débito"+"crédito") — extratos de banco
// costumam ter algumas linhas de título/logo antes da tabela de verdade
function acharCabecalho(linhas) {
  const limite = Math.min(linhas.length, 15);
  for (let i = 0; i < limite; i++) {
    const linha = linhas[i];
    if (!Array.isArray(linha) || linha.length === 0) continue;
    const colData = acharColuna(linha, ALIASES.data);
    const colValor = acharColuna(linha, ALIASES.valor);
    const colDebito = acharColuna(linha, ALIASES.debito);
    const colCredito = acharColuna(linha, ALIASES.credito);
    if (colData !== -1 && (colValor !== -1 || (colDebito !== -1 && colCredito !== -1))) {
      return {
        indiceLinha: i,
        colData,
        colHistorico: acharColuna(linha, ALIASES.historico),
        colValor,
        colDebito,
        colCredito,
        colDocumento: acharColuna(linha, ALIASES.documento),
      };
    }
  }
  return null;
}

function parseData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // dd/mm/aaaa ou dd-mm-aaaa
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // aaaa-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function parseValor(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/^R\$\s*/i, '');
  const negativoParenteses = /^\(.*\)$/.test(s);
  if (negativoParenteses) s = s.slice(1, -1);
  // formato BR: milhar com ponto, decimal com vírgula
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negativoParenteses ? -n : n;
}

export async function extrairTransacoesDeExcel(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const nomeAba = workbook.SheetNames[0];
  const planilha = workbook.Sheets[nomeAba];
  const linhas = XLSX.utils.sheet_to_json(planilha, { header: 1, raw: true, defval: '' });

  const cab = acharCabecalho(linhas);
  if (!cab) {
    throw new Error('Não consegui identificar as colunas dessa planilha. Confira se a primeira linha da tabela tem cabeçalhos como "Data", "Histórico"/"Descrição" e "Valor" (ou "Débito"/"Crédito").');
  }

  const transacoes = [];
  let linhasIgnoradas = 0;
  for (let i = cab.indiceLinha + 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!Array.isArray(linha) || linha.every((c) => c === '' || c == null)) continue;

    const data = parseData(linha[cab.colData]);
    if (!data) { linhasIgnoradas++; continue; }

    let valor = null;
    let tipo = null;
    if (cab.colDebito !== -1 && cab.colCredito !== -1) {
      const vDeb = parseValor(linha[cab.colDebito]);
      const vCred = parseValor(linha[cab.colCredito]);
      if (vDeb) { valor = Math.abs(vDeb); tipo = 'saida'; }
      else if (vCred) { valor = Math.abs(vCred); tipo = 'entrada'; }
    } else if (cab.colValor !== -1) {
      const v = parseValor(linha[cab.colValor]);
      if (v != null && v !== 0) { valor = Math.abs(v); tipo = v >= 0 ? 'entrada' : 'saida'; }
    }
    if (valor == null || !tipo) { linhasIgnoradas++; continue; }

    const descricao = cab.colHistorico !== -1 ? String(linha[cab.colHistorico] ?? '').trim() : '';
    const identificador = cab.colDocumento !== -1 ? (String(linha[cab.colDocumento] ?? '').trim() || null) : null;

    transacoes.push({ data, descricao: descricao || '(sem descrição)', identificador, valor, tipo });
  }

  return { transacoes, truncado: false, linhasIgnoradas: linhasIgnoradas > 0 ? linhasIgnoradas : undefined };
}
