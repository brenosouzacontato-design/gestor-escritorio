// extratoNubank.js
//
// Leitura por REGRA (sem IA) do extrato PDF da conta Nubank (PF/PJ).
//
// Por que não vai pela IA como os outros bancos: o Nubank não põe sinal nos
// valores — o que diz se é entrada ou saída é o cabeçalho do bloco do dia
// ("02 SET 2026  Total de entradas + 51.476,22" / "Total de saídas -
// 23.232,86"), e esse bloco continua na(s) página(s) seguinte(s) SEM repetir
// nem o cabeçalho nem a data. A extração por IA manda uma página por vez
// (limite de ~29s do Netlify), então a página do meio de um bloco chegava
// sem nenhuma pista de direção/data e a IA chutava — e ainda confundia
// "Depósito recebido 99 FOOD * Débito" (modalidade do cartão) com saída.
// Aqui o texto do PDF inteiro é lido em ordem e a data/direção atuais são
// carregadas de uma página pra outra.
//
// Layout (medido em extratos reais, coordenada x do pdf.js):
//   x ~57      data do bloco ("02 SET 2026") / textos do cabeçalho
//   x ~120     "Total de entradas|saídas", tipo do movimento ("Transferência
//              enviada pelo Pix"), "Saldo do dia"
//   x ~258     contraparte (quebra em várias linhas: nome - doc - banco...)
//   x >= 440   valor ("42.880,01", "+ 51.476,22")

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { agruparEmLinhas } from '../../lib/extratoNubankRegras';

// regras de leitura (sem pdf.js) — compartilhadas com o servidor
export { agruparEmLinhas, pareceExtratoNubank, interpretarExtratoNubank } from '../../lib/extratoNubankRegras';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Lê o PDF e devolve as linhas de cada página: [[{ y, itens: [{ x, s }] }]],
// de cima pra baixo, itens da esquerda pra direita.
export async function lerLinhasPdf(bytes) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), password: '' }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    paginas.push(agruparEmLinhas(tc.items));
  }
  return paginas;
}
