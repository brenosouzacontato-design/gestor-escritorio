// leitorGuiaParcelamento.js
// Lê uma guia de parcelamento (PDF) direto no navegador e devolve os dados
// que o módulo Parcelamentos precisa pra cadastrar/atualizar o parcelamento
// sozinho: quem deve (CPF/CNPJ), de onde é (PARCMEI da Receita ou SISPAR da
// PGFN), número da conta, parcela X/Y, valor, vencimento e linha digitável.
//
// Formatos conhecidos (texto extraído pelo pdfjs — as guias trazem texto):
//   - DAS de PARCMEI ........ "DAS de PARCMEI", "Número do Parcelamento: 2",
//                              "Número da Parcela: 20/60"
//   - DAS/DARF PGFN-SISPAR .. "PGFN-SISPAR:014305206", período "Maio/2026"
// `interpretarTextoGuia` é pura (sem pdfjs) pra poder ser testada em Node.

let pdfjsPronto = null;
async function carregarPdfjs() {
  if (!pdfjsPronto) {
    pdfjsPronto = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([pdfjs, worker]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        return pdfjs;
      });
  }
  return pdfjsPronto;
}

export async function textoDoPdf(bytes) {
  const pdfjs = await carregarPdfjs();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const partes = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const pagina = await pdf.getPage(n);
    const { items } = await pagina.getTextContent();
    partes.push(items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(' '));
  }
  await pdf.destroy();
  return partes.join('\n');
}

const RE_CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const RE_LINHA = /(8\d{10})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)/;
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const brParaNumero = (s) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) : null);
const dataBrParaIso = (s) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "Maio/2026" → "05/2026" (formato de competência do Gestor)
function periodoParaCompetencia(periodo) {
  const m = /^([A-Za-zÀ-ú]+)\/(\d{4})$/.exec(periodo || '');
  if (!m) return null;
  const idx = MESES.indexOf(semAcento(m[1]));
  return idx >= 0 ? `${String(idx + 1).padStart(2, '0')}/${m[2]}` : null;
}

// Devolve null quando o texto não parece guia de parcelamento.
export function interpretarTextoGuia(texto) {
  const t = (texto || '').replace(/ /g, ' ');
  let origem = null;
  if (/PARCMEI/i.test(t)) origem = 'PARCMEI';
  else if (/SISPAR/i.test(t)) origem = 'PGFN';
  if (!origem) return null;

  // Documento do devedor: o primeiro CNPJ/CPF do cabeçalho
  const cnpj = RE_CNPJ.exec(t);
  const cpf = RE_CPF.exec(t);
  const doc = cnpj && (!cpf || cnpj.index < cpf.index) ? cnpj[0] : cpf?.[0] || null;

  // Nome: o que vem logo depois do documento, na mesma linha.
  // MEI costuma vir com o CPF colado no fim ("FULANO 12345678901").
  let nome = null;
  if (doc) {
    const linha = t.slice(t.indexOf(doc) + doc.length).split('\n')[0];
    nome = linha.replace(/\s+/g, ' ').trim()
      .replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '')
      .replace(/\s+\d{11}$/, '') || null;
  }

  const linhaM = RE_LINHA.exec(t);
  const numeroDoc = /Número:\s*(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/.exec(t)?.[1]
    || /\b(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)\b/.exec(t)?.[1] || null;
  const vencimento = dataBrParaIso(/Pagar até:\s*(\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1]);
  const valor = brParaNumero(/Valor:\s*([\d.]+,\d{2})/.exec(t)?.[1]
    || /Valor Total do Documento\s+([\d.]+,\d{2})/.exec(t)?.[1]);

  const parc = /Número da Parcela:\s*(\d+)\s*\/\s*(\d+)/.exec(t);
  const conta = origem === 'PGFN'
    ? /SISPAR:\s*(\d+)/.exec(t)?.[1] || null
    : /Número do Parcelamento:\s*(\d+)/.exec(t)?.[1] || null;
  const periodo = /\b([A-Za-zÀ-ú]+\/\d{4})\b/.exec(t)?.[1] || null;

  return {
    origem,                                   // 'PARCMEI' | 'PGFN'
    documento: doc,                           // formatado, como veio na guia
    documentoDigitos: soDigitos(doc),
    nome,
    conta,                                    // nº do PARCMEI (1, 2…) ou conta SISPAR
    parcela: parc ? Number(parc[1]) : null,
    totalParcelas: parc ? Number(parc[2]) : null,
    competencia: periodoParaCompetencia(periodo),   // só PGFN traz o mês da parcela
    vencimento,                               // ISO yyyy-mm-dd
    valor,
    linhaDigitavel: linhaM ? linhaM.slice(1).join('') : null,
    numeroDocumento: numeroDoc,
  };
}

// Aceita File/Blob ou bytes. Lança erro com mensagem amigável.
export async function lerGuiaParcelamento(arquivo) {
  const bytes = arquivo instanceof Uint8Array ? arquivo : new Uint8Array(await arquivo.arrayBuffer());
  const texto = await textoDoPdf(bytes);
  const dados = interpretarTextoGuia(texto);
  if (!dados) throw new Error('Não parece guia de parcelamento (PARCMEI ou PGFN-SISPAR).');
  if (!dados.documentoDigitos || !dados.conta) throw new Error('Não achei CPF/CNPJ ou número do parcelamento na guia.');
  return dados;
}
