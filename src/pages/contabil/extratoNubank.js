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

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MESES = { JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12' };
const RE_DATA = /^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (\d{4})$/;
const RE_VALOR = /^[+-]?\s*\d{1,3}(\.\d{3})*,\d{2}$/;
const X_VALOR = 440;
const X_CONTRAPARTE = 220;

function paraNumero(txt) {
  return Number(txt.replace(/[+\-\s.]/g, '').replace(',', '.'));
}

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

export function agruparEmLinhas(itens) {
  const linhas = [];
  for (const it of itens) {
    const s = (it.str || '').trim();
    if (!s) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let linha = linhas.find((l) => Math.abs(l.y - y) <= 2);
    if (!linha) { linha = { y, itens: [] }; linhas.push(linha); }
    linha.itens.push({ x, s });
  }
  linhas.forEach((l) => l.itens.sort((a, b) => a.x - b.x));
  return linhas.sort((a, b) => b.y - a.y);
}

export function pareceExtratoNubank(paginas) {
  const itens = paginas.flat().flatMap((l) => l.itens);
  return itens.some((i) => /nubank\.com\.br|Nu Pagamentos/i.test(i.s))
    && itens.some((i) => i.s === 'Movimentações')
    && itens.some((i) => /^Total de (entradas|saídas)$/.test(i.s));
}

// Junta os pedaços de texto da contraparte que o PDF quebrou em linhas —
// sem espaço quando a quebra cortou no meio de um CNPJ/CPF/sigla
// ("21.461.058" + "/0001-02", "CIELO IP S." + "A.", "331115-" + "5").
function juntarQuebra(anterior, proximo) {
  if (!anterior) return proximo;
  if (/^[/.]/.test(proximo) || /[.\-/]$/.test(anterior) && !/ -$/.test(anterior) && !/^-/.test(proximo)) return anterior + proximo;
  return `${anterior} ${proximo}`;
}

function finalizar(t) {
  const completo = t.partes.reduce(juntarQuebra, '').replace(/\s+/g, ' ').trim();
  // "99 FOOD LTDA - 60.112.920/0001-23 - BANCO BTG PACTUAL S.A. (0208) Agência: 30 Conta: 866429-3"
  //  -> nome "99 FOOD LTDA", documento "60.112.920/0001-23"
  const [nome, doc] = completo.split(' - ').map((s) => s.trim());
  const documento = doc && /\d/.test(doc) ? doc : null;
  return {
    data: t.data,
    descricao: nome ? `${t.tipoMov} - ${nome}` : t.tipoMov,
    identificador: null,
    valor: t.valor,
    tipo: t.tipo,
    // extras só pra conferência/regras (não fazem parte do contrato mínimo)
    contraparte_documento: documento,
    detalhe: completo || null,
  };
}

// Interpreta as linhas (de lerLinhasPdf) e devolve
//   { transacoes, totais: { entradas, saidas } | null, avisos: [] }
export function interpretarExtratoNubank(paginas) {
  const transacoes = [];
  const avisos = [];
  let totais = null;
  let dataAtual = null;
  let tipoAtual = null; // 'entrada' | 'saida' — vem do "Total de ..." do bloco
  let atual = null; // transação sendo montada (contraparte pode continuar nas linhas seguintes)
  let emMovimentacoes = false;

  const fechar = () => { if (atual) { transacoes.push(finalizar(atual)); atual = null; } };

  for (const linhas of paginas) {
    let corpo = false; // pula o cabeçalho repetido de cada página (até "VALORES EM R$")
    for (const linha of linhas) {
      const textos = linha.itens.map((i) => i.s);
      const juntos = textos.join(' ');
      if (!corpo) { if (/VALORES EM R\$/.test(juntos)) corpo = true; continue; }
      if (/^(Tem alguma dúvida|metropolitanas\)|Caso a solução|disponíveis em|Extrato gerado dia)/.test(juntos)) { corpo = false; continue; }

      // resumo do período (só na 1ª página, antes de "Movimentações")
      if (!emMovimentacoes) {
        if (juntos === 'Movimentações') { emMovimentacoes = true; continue; }
        const m = juntos.match(/Total de (entradas|saídas)\s+([+-]?[\d.]+,\d{2})/);
        if (m) {
          totais = totais || { entradas: null, saidas: null };
          totais[m[1] === 'entradas' ? 'entradas' : 'saidas'] = paraNumero(m[2]);
        }
        continue;
      }

      let itens = linha.itens;
      const md = itens[0] && itens[0].s.match(RE_DATA);
      if (md) {
        fechar();
        dataAtual = `${md[3]}-${MESES[md[2]]}-${md[1]}`;
        itens = itens.slice(1);
        if (itens.length === 0) continue;
      }

      const rotulo = itens.find((i) => i.x < X_CONTRAPARTE);
      const valorItem = itens.find((i) => i.x >= X_VALOR && RE_VALOR.test(i.s));
      const contraparte = itens.filter((i) => i.x >= X_CONTRAPARTE && i !== valorItem).map((i) => i.s).join(' ');

      if (rotulo && /^Total de entradas$/i.test(rotulo.s)) { fechar(); tipoAtual = 'entrada'; continue; }
      if (rotulo && /^Total de saídas$/i.test(rotulo.s)) { fechar(); tipoAtual = 'saida'; continue; }
      if (rotulo && /^Saldo (do dia|inicial|final)/i.test(rotulo.s)) { fechar(); continue; }

      if (rotulo && valorItem) {
        fechar();
        if (!dataAtual || !tipoAtual) {
          avisos.push(`Movimento sem data/bloco identificado: "${rotulo.s} ${contraparte}" (${valorItem.s}) — ignorado.`);
          continue;
        }
        atual = { data: dataAtual, tipo: tipoAtual, tipoMov: rotulo.s, valor: paraNumero(valorItem.s), partes: contraparte ? [contraparte] : [] };
        continue;
      }

      // continuação da contraparte da transação anterior (inclusive no topo
      // da página seguinte, ex: "Conta: 1288000000763536357-4")
      if (atual && !rotulo && contraparte && !valorItem) { atual.partes.push(contraparte); continue; }

      // rótulo sem valor logo depois de um movimento = marcação do mesmo
      // movimento, não um movimento novo (ex: "Saque" debaixo de um Pix
      // enviado = Pix Saque; a soma dos blocos só fecha assim)
      if (atual && rotulo && !valorItem && rotulo.s.length <= 40) {
        atual.tipoMov = `${atual.tipoMov} (${rotulo.s})`;
        if (contraparte) atual.partes.push(contraparte);
        continue;
      }

      // textos legais do fim do extrato etc. — só avisa se tinha valor
      if (valorItem) avisos.push(`Linha com valor não reconhecida no extrato: "${juntos}"`);
    }
  }
  fechar();
  return { transacoes, totais, avisos };
}
