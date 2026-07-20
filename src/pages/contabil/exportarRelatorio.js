// Exporta os lançamentos de uma conta (o mesmo conteúdo do
// ContaLancamentosSidebar) em PDF ou Excel — chamado a partir do sidebar
// aberto pela DRE ou pelo Balancete.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

function fmtMoeda(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function nomeArquivoBase(conta, periodo) {
  return `lancamentos_${conta.nome.replace(/[^\w-]+/g, '_')}_${periodo.dataInicio}_a_${periodo.dataFim}`;
}

function baixarBlob(conteudo, nomeArquivo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportarLancamentosExcel({ conta, lancamentos, periodo, empresaNome }) {
  const cabecalho = ['Data', 'Histórico', 'Tipo', 'Valor', 'Documento'];
  const linhas = lancamentos.map((l) => [
    fmtData(l.data),
    l.historico ?? '',
    l.tipo === 'debito' ? 'Débito' : 'Crédito',
    l.valor.toFixed(2).replace('.', ','),
    l.numeroDocumento ?? '',
  ]);
  const escapar = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const cabecalhoRelatorio = [
    [`Lançamentos — ${conta.nome}`],
    [empresaNome || ''],
    [`Período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`],
    [],
  ];
  const csv = [...cabecalhoRelatorio, cabecalho, ...linhas]
    .map((linha) => linha.map(escapar).join(';'))
    .join('\r\n');
  baixarBlob('﻿' + csv, `${nomeArquivoBase(conta, periodo)}.csv`, 'text/csv;charset=utf-8;');
}

export async function exportarLancamentosPDF({ conta, lancamentos, periodo, empresaNome }) {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonteMono = await doc.embedFont(StandardFonts.Courier);
  const fonteMonoBold = await doc.embedFont(StandardFonts.CourierBold);

  const largura = 595.28;
  const altura = 841.89;
  const margem = 40;
  let pagina = doc.addPage([largura, altura]);
  let y = altura - margem;

  function novaPagina() {
    pagina = doc.addPage([largura, altura]);
    y = altura - margem;
  }

  function linha(texto, { tamanho = 9, fonte: f = fonteMono, cor = rgb(0.13, 0.15, 0.2) } = {}) {
    if (y < margem + 24) novaPagina();
    pagina.drawText(texto, { x: margem, y, size: tamanho, font: f, color: cor });
    y -= tamanho + 6;
  }

  linha(`Lançamentos — ${conta.nome}`, { tamanho: 15, fonte: fonteBold });
  if (empresaNome) linha(empresaNome, { tamanho: 10, fonte });
  linha(`Período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`, { tamanho: 9, fonte, cor: rgb(0.45, 0.45, 0.5) });
  y -= 8;

  const colData = 0, colHist = 11, colDC = 56, colValor = 61;
  function montarLinhaTabela(dataStr, hist, dc, valorStr) {
    return dataStr.padEnd(colHist - colData)
      + hist.slice(0, colDC - colHist - 1).padEnd(colDC - colHist)
      + dc.padEnd(colValor - colDC)
      + valorStr;
  }

  linha(montarLinhaTabela('Data', 'Histórico', 'D/C', 'Valor'), { fonte: fonteMonoBold, tamanho: 8.5 });
  y -= 2;

  if (lancamentos.length === 0) {
    linha('Nenhum lançamento nesse período.', { fonte, tamanho: 9, cor: rgb(0.5, 0.5, 0.55) });
  }

  for (const l of lancamentos) {
    const dc = l.tipo === 'debito' ? 'D' : 'C';
    const texto = montarLinhaTabela(fmtData(l.data), l.historico ?? '', dc, fmtMoeda(l.valor));
    linha(texto, { tamanho: 8, fonte: fonteMono });
  }

  const bytes = await doc.save();
  baixarBlob(bytes, `${nomeArquivoBase(conta, periodo)}.pdf`, 'application/pdf');
}
