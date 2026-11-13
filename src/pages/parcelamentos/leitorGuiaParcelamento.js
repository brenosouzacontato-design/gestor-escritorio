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
// `interpretarTextoGuia` é pura (sem pdfjs) e mora em src/lib/guiaParcelamento.js,
// junto com o cadastro do parcelamento: o grupo "Documentos" do WhatsApp usa o
// mesmo código no servidor (netlify/functions/documento-processar-background.mjs).
import { interpretarTextoGuia } from '../../lib/guiaParcelamento.js';

export { interpretarTextoGuia };

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

// Aceita File/Blob ou bytes. Lança erro com mensagem amigável.
export async function lerGuiaParcelamento(arquivo) {
  const bytes = arquivo instanceof Uint8Array ? arquivo : new Uint8Array(await arquivo.arrayBuffer());
  const texto = await textoDoPdf(bytes);
  const dados = interpretarTextoGuia(texto);
  if (!dados) throw new Error('Não parece guia de parcelamento (PARCMEI ou PGFN-SISPAR).');
  if (!dados.documentoDigitos || !dados.conta) throw new Error('Não achei CPF/CNPJ ou número do parcelamento na guia.');
  return dados;
}
