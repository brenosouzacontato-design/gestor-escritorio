// Exporta o relatório financeiro (aba Relatório, RelatorioFinanceiroTab.jsx)
// em PDF ou Excel (CSV). Cálculo em src/lib/relatorioFinanceiro.js.
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '');
const nomeArquivo = (empresaNome, periodo, ext) =>
  `relatorio_financeiro_${String(empresaNome || 'empresa').replace(/[^\w-]+/g, '_')}_${periodo.dataInicio}_a_${periodo.dataFim}.${ext}`;

function baixarBlob(conteudo, nome, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportarRelatorioFinanceiroExcel({ relatorio: r, periodo, empresaNome }) {
  const num = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
  const linhas = [
    ['Relatório financeiro'],
    [empresaNome || ''],
    [`Período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)}`],
    [],
    ['Resumo'],
    ['Entradas', num(r.totais.entradas)],
    ['Saídas', num(r.totais.saidas)],
    ['Saldo do período', num(r.totais.saldo)],
    ['Transferências entre contas (fora do saldo)', num(r.totais.transferencias)],
    [],
  ];
  for (const [titulo, lado] of [['ENTRADAS', r.entradas], ['SAÍDAS', r.saidas]]) {
    linhas.push([titulo], ['Categoria', 'Nome', 'CNPJ', 'Qtd', 'Total', 'Último'], []);
    for (const g of lado) {
      linhas.push([g.rotulo, '', '', g.qtd, num(g.total), '']);
      for (const it of g.itens) linhas.push(['', it.nome, it.cnpj ?? '', it.qtd, num(it.total), fmtData(it.ultimaData)]);
    }
    linhas.push([]);
  }
  linhas.push(['LANÇAMENTOS'], ['Data', 'Tipo', 'Categoria', 'Nome', 'Histórico', 'Conta', 'Valor']);
  const todos = [];
  for (const [tipo, lado] of [['Entrada', r.entradas], ['Saída', r.saidas]]) {
    for (const g of lado) for (const it of g.itens) for (const l of it.lancamentos) todos.push([l.data, tipo, g.rotulo, it.nome, l.historico, l.conta, l.valor]);
  }
  todos.sort((a, b) => a[0].localeCompare(b[0]));
  for (const t of todos) linhas.push([fmtData(t[0]), t[1], t[2], t[3], t[4], t[5], num(t[6])]);

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = linhas.map((l) => l.map(esc).join(';')).join('\r\n');
  baixarBlob('﻿' + csv, nomeArquivo(empresaNome, periodo, 'csv'), 'text/csv;charset=utf-8;');
}

// fontes padrão do PDF só têm WinAnsi: troca o que não couber
const limpar = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ–—•]/g, '');

export async function exportarRelatorioFinanceiroPDF({ relatorio: r, periodo, empresaNome }) {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 595.28; const A = 841.89; const M = 40;
  const cinza = rgb(0.45, 0.45, 0.5); const escuro = rgb(0.13, 0.15, 0.2);
  const verde = rgb(0.1, 0.5, 0.25); const vermelho = rgb(0.7, 0.15, 0.15);
  let pag = doc.addPage([L, A]);
  let y = A - M;

  const espaco = (h) => { if (y - h < M) { pag = doc.addPage([L, A]); y = A - M; } };
  const texto = (t, x, { tam = 9, f = fonte, cor = escuro, max } = {}) => {
    let s = limpar(t);
    if (max) while (s.length > 1 && f.widthOfTextAtSize(s, tam) > max) s = s.slice(0, -2) + '…';
    pag.drawText(s, { x, y, size: tam, font: f, color: cor });
  };
  const direita = (t, xFim, opts = {}) => {
    const f = opts.f ?? fonte; const tam = opts.tam ?? 9;
    texto(t, xFim - f.widthOfTextAtSize(limpar(t), tam), opts);
  };
  const regua = () => { pag.drawLine({ start: { x: M, y: y + 4 }, end: { x: L - M, y: y + 4 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) }); };

  texto('Relatório financeiro', M, { tam: 16, f: negrito }); y -= 18;
  if (empresaNome) { texto(empresaNome, M, { tam: 10 }); y -= 14; }
  texto(`Período de ${fmtData(periodo.dataInicio)} a ${fmtData(periodo.dataFim)} · movimento bancário`, M, { tam: 9, cor: cinza }); y -= 22;

  // resumo
  const kpis = [
    ['Entradas', r.totais.entradas, verde], ['Saídas', r.totais.saidas, vermelho], ['Saldo', r.totais.saldo, r.totais.saldo < 0 ? vermelho : escuro],
  ];
  const w = (L - 2 * M) / kpis.length;
  kpis.forEach(([rot, v, cor], i) => { texto(rot, M + i * w, { tam: 8, cor: cinza }); });
  y -= 14;
  kpis.forEach(([, v, cor], i) => { texto(fmt(v), M + i * w, { tam: 13, f: negrito, cor }); });
  y -= 18;
  const d = r.destaques;
  const linhaDestaques = [
    `Receitas ${fmt(d.receitas)}`,
    `Fornecedores ${fmt(d.fornecedores)} (${d.qtdFornecedores})`,
    `Adiant. concedidos ${fmt(d.adiantamentosConcedidos)}`,
    `Adiant. recebidos ${fmt(d.adiantamentosRecebidos)}`,
  ].join('   ·   ');
  texto(linhaDestaques, M, { tam: 8, cor: cinza, max: L - 2 * M }); y -= 12;
  if (r.totais.transferencias) { texto(`Transferências entre contas (fora do saldo): ${fmt(r.totais.transferencias)}`, M, { tam: 8, cor: cinza }); y -= 12; }
  y -= 10;

  const xNome = M + 14; const xQtd = L - M - 170; const xTot = L - M - 70; const xPct = L - M;
  for (const [titulo, lado, total, cor] of [['Entradas', r.entradas, r.totais.entradas, verde], ['Saídas', r.saidas, r.totais.saidas, vermelho]]) {
    espaco(40);
    texto(titulo, M, { tam: 12, f: negrito, cor }); direita(fmt(total), xPct, { tam: 12, f: negrito, cor }); y -= 18;
    if (!lado.length) { texto('Nada no período.', M, { cor: cinza }); y -= 16; }
    for (const g of lado) {
      espaco(34);
      regua();
      texto(g.rotulo, M, { tam: 10, f: negrito });
      direita(`${g.qtd}×`, xQtd, { tam: 9, cor: cinza });
      direita(fmt(g.total), xTot + 50, { tam: 10, f: negrito });
      direita(`${String(g.pct).replace('.', ',')}%`, xPct, { tam: 8, cor: cinza });
      y -= 14;
      const itens = g.itens.slice(0, g.id === 'fornecedores' ? 60 : 15);
      for (const it of itens) {
        espaco(12);
        const nome = it.cnpj ? `${it.nome}  (${it.cnpj})` : it.nome;
        texto(nome, xNome, { tam: 8.5, max: xQtd - xNome - 40 });
        direita(`${it.qtd}×`, xQtd, { tam: 8, cor: cinza });
        direita(fmt(it.total), xTot + 50, { tam: 8.5 });
        y -= 11;
      }
      if (g.itens.length > itens.length) {
        espaco(12);
        const resto = g.itens.slice(itens.length);
        texto(`+ ${resto.length} outro(s)`, xNome, { tam: 8, cor: cinza });
        direita(fmt(resto.reduce((s, it) => s + it.total, 0)), xTot + 50, { tam: 8, cor: cinza });
        y -= 11;
      }
      y -= 6;
    }
    y -= 10;
  }

  // por mês
  if (r.porMes.length > 1) {
    espaco(40 + r.porMes.length * 12);
    texto('Por mês', M, { tam: 12, f: negrito }); y -= 16;
    const cols = [['Mês', M], ['Entradas', M + 200], ['Saídas', M + 320], ['Saldo', L - M]];
    cols.forEach(([t, x], i) => (i ? direita(t, x, { tam: 8, f: negrito, cor: cinza }) : texto(t, x, { tam: 8, f: negrito, cor: cinza }))); y -= 12;
    for (const m of r.porMes) {
      const [a, mm] = m.mes.split('-');
      texto(`${mm}/${a}`, M, { tam: 8.5 });
      direita(fmt(m.totalEntradas), M + 200, { tam: 8.5 });
      direita(fmt(m.totalSaidas), M + 320, { tam: 8.5 });
      direita(fmt(m.saldo), L - M, { tam: 8.5, cor: m.saldo < 0 ? vermelho : escuro });
      y -= 12;
    }
  }

  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    p.drawText(limpar(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · página ${i + 1} de ${paginas.length}`), { x: M, y: 20, size: 7, font: fonte, color: cinza });
  });

  baixarBlob(await doc.save(), nomeArquivo(empresaNome, periodo, 'pdf'), 'application/pdf');
}
