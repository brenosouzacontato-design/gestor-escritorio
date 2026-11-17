// cobrancaPdf.js
//
// PDF de cobrança "estilo boleto" dos honorários, pago por PIX: favorecido,
// pagador, mensagem de referência, honorários agrupados, total, data pra
// pagar, QR Code, chave e PIX copia e cola, e o canhoto "recibo do pagador".
// NÃO é boleto bancário registrado (isso exige convênio com banco) — o
// pagamento é o PIX do QR Code (ver pixBrCode.js e ModalQrCodePix em
// HonorariosPage.jsx).

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

const A4 = [595.28, 841.89];
const M = 40; // margem
const COR = {
  texto: rgb(0.12, 0.14, 0.18),
  suave: rgb(0.42, 0.45, 0.5),
  borda: rgb(0.8, 0.82, 0.86),
  faixa: rgb(0.13, 0.55, 0.38),
  fundo: rgb(0.95, 0.97, 0.96),
  branco: rgb(1, 1, 1),
};

const fmtValor = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

// quebra o texto em linhas que caibam na largura (por palavra; palavra
// maior que a linha — ex.: o copia e cola — é cortada por caractere)
export function quebrarTexto(texto, fonte, tamanho, largura) {
  const linhas = [];
  for (const paragrafo of String(texto || '').split('\n')) {
    let atual = '';
    for (const palavra of paragrafo.split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) { atual = tentativa; continue; }
      if (atual) linhas.push(atual);
      let resto = palavra;
      while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
        let n = resto.length;
        while (n > 1 && fonte.widthOfTextAtSize(resto.slice(0, n), tamanho) > largura) n--;
        linhas.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      atual = resto;
    }
    linhas.push(atual);
  }
  return linhas;
}

function dataUrlParaBytes(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

// {
//   favorecido, chavePix, cliente, referencia, pagarAte (YYYY-MM-DD),
//   itens: [{ descricao, vencimento, valor }], total, pixCopiaCola,
//   qrPng (data URL PNG do QR Code), emitidoEm? (Date)
// } → Uint8Array do PDF
export async function gerarCobrancaPdf(d) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cobrança de honorários — ${d.cliente || ''}`.trim());
  pdf.setCreator('Gestor Escritório');
  const pagina = pdf.addPage(A4);
  const [W, H] = A4;
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const larg = W - 2 * M;

  const texto = (t, x, y, { fonte = reg, tam = 10, cor = COR.texto } = {}) =>
    pagina.drawText(String(t ?? ''), { x, y, size: tam, font: fonte, color: cor });
  const direita = (t, xDir, y, op = {}) => {
    const fonte = op.fonte || reg; const tam = op.tam || 10;
    texto(t, xDir - fonte.widthOfTextAtSize(String(t), tam), y, op);
  };
  const caixa = (x, y, w, h, { fundo = null, borda = COR.borda, esp = 0.8 } = {}) =>
    pagina.drawRectangle({ x, y, width: w, height: h, color: fundo || undefined, borderColor: borda || undefined, borderWidth: borda ? esp : 0 });
  const rotulo = (t, x, y) => texto(t.toUpperCase(), x, y, { fonte: neg, tam: 7, cor: COR.suave });

  // ── faixa do topo
  let y = H - M;
  caixa(M, y - 54, larg, 54, { fundo: COR.faixa, borda: null });
  texto('COBRANÇA DE HONORÁRIOS', M + 16, y - 24, { fonte: neg, tam: 16, cor: COR.branco });
  texto('Pagamento via PIX', M + 16, y - 41, { tam: 9.5, cor: COR.branco });
  direita('Total a pagar', W - M - 16, y - 20, { tam: 8.5, cor: COR.branco });
  direita(fmtValor(d.total), W - M - 16, y - 40, { fonte: neg, tam: 17, cor: COR.branco });
  y -= 54;

  // ── favorecido / pagador / pagar até
  const linhaCampos = (campos, altura = 38) => {
    let x = M;
    for (const [rot, valor, w, destaque] of campos) {
      caixa(x, y - altura, w, altura, { fundo: destaque ? COR.fundo : null });
      rotulo(rot, x + 8, y - 12);
      const linhas = quebrarTexto(valor, neg, 10.5, w - 16).slice(0, 2);
      linhas.forEach((l, i) => texto(l, x + 8, y - 26 - i * 12, { fonte: neg, tam: 10.5 }));
      x += w;
    }
    y -= altura;
  };
  linhaCampos([['Favorecido (quem recebe)', d.favorecido, larg * 0.62], ['Chave PIX', d.chavePix, larg * 0.38]]);
  linhaCampos([['Pagador (cliente)', d.cliente, larg * 0.62], ['Pagar até', fmtData(d.pagarAte), larg * 0.38, true]]);

  // ── mensagem de referência
  if (d.referencia) {
    const linhas = quebrarTexto(d.referencia, reg, 10, larg - 16).slice(0, 6);
    const h = 22 + linhas.length * 13;
    caixa(M, y - h, larg, h);
    rotulo('Referência', M + 8, y - 12);
    linhas.forEach((l, i) => texto(l, M + 8, y - 26 - i * 13, { tam: 10 }));
    y -= h;
  }

  // ── honorários
  y -= 18;
  texto('Honorários incluídos', M, y, { fonte: neg, tam: 11 });
  y -= 8;
  const colVenc = M + larg * 0.62;
  caixa(M, y - 18, larg, 18, { fundo: COR.fundo });
  rotulo('Descrição', M + 8, y - 12);
  rotulo('Vencimento', colVenc, y - 12);
  direita('VALOR', W - M - 8, y - 12, { fonte: neg, tam: 7, cor: COR.suave });
  y -= 18;
  for (const it of d.itens || []) {
    caixa(M, y - 20, larg, 20);
    const desc = quebrarTexto(it.descricao, reg, 10, larg * 0.6 - 8)[0];
    texto(desc, M + 8, y - 14, { tam: 10 });
    texto(fmtData(it.vencimento), colVenc, y - 14, { tam: 10 });
    direita(fmtValor(it.valor), W - M - 8, y - 14, { tam: 10 });
    y -= 20;
  }
  caixa(M, y - 24, larg, 24, { fundo: COR.fundo });
  texto('Total', M + 8, y - 16, { fonte: neg, tam: 11 });
  direita(fmtValor(d.total), W - M - 8, y - 16, { fonte: neg, tam: 12 });
  y -= 24;

  // ── PIX: QR Code + instruções + copia e cola
  y -= 22;
  const ladoQr = 150;
  const altPix = 196;
  caixa(M, y - altPix, larg, altPix);
  if (d.qrPng) {
    const img = await pdf.embedPng(dataUrlParaBytes(d.qrPng));
    pagina.drawImage(img, { x: M + 12, y: y - 12 - ladoQr, width: ladoQr, height: ladoQr });
  }
  texto('Escaneie o QR Code com o app do banco', M + 12 + 4, y - altPix + 18, { tam: 7.5, cor: COR.suave });
  const xPix = M + 12 + ladoQr + 18;
  const largPix = W - M - 12 - xPix;
  let yp = y - 18;
  texto('Como pagar', xPix, yp, { fonte: neg, tam: 11 });
  yp -= 16;
  for (const passo of [
    '1. Abra o app do seu banco e entre na área PIX.',
    '2. Escolha "Ler QR Code" e aponte para o código ao lado,',
    '    ou "PIX Copia e Cola" e cole o código abaixo.',
    `3. Confira o favorecido e o valor de ${fmtValor(d.total)} e confirme.`,
  ]) { texto(passo, xPix, yp, { tam: 9 }); yp -= 13; }
  yp -= 6;
  rotulo('PIX copia e cola', xPix, yp);
  yp -= 4;
  const linhasPix = quebrarTexto(d.pixCopiaCola, mono, 7.2, largPix - 12).slice(0, 8);
  const altCodigo = linhasPix.length * 9 + 10;
  caixa(xPix, yp - altCodigo, largPix, altCodigo, { fundo: COR.fundo });
  linhasPix.forEach((l, i) => texto(l, xPix + 6, yp - 11 - i * 9, { fonte: mono, tam: 7.2 }));
  y -= altPix;

  // ── canhoto: recibo do pagador
  y -= 30;
  pagina.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: COR.suave, dashArray: [4, 3] });
  texto('corte aqui', W / 2 - 18, y + 4, { tam: 7, cor: COR.suave });
  y -= 14;
  texto('RECIBO DO PAGADOR', M, y - 10, { fonte: neg, tam: 9 });
  y -= 18;
  linhaCampos([
    ['Pagador', d.cliente, larg * 0.33],
    ['Favorecido', d.favorecido, larg * 0.31],
    ['Pagar até', fmtData(d.pagarAte), larg * 0.17],
    ['Valor', fmtValor(d.total), larg * 0.19, true],
  ], 40);

  // ── rodapé
  const emitido = (d.emitidoEm || new Date()).toLocaleDateString('pt-BR');
  texto(`Emitido em ${emitido}. Documento de cobrança pago por PIX; não é boleto bancário.`, M, M - 8, { tam: 7.5, cor: COR.suave });

  return pdf.save();
}
