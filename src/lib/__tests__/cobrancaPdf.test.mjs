import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import QRCode from 'qrcode';
import { gerarCobrancaPdf, quebrarTexto } from '../cobrancaPdf.js';
import { montarPixCopiaCola } from '../pixBrCode.js';

test('quebrarTexto: quebra por palavra e corta palavra maior que a linha', async () => {
  const pdf = await PDFDocument.create();
  const f = await pdf.embedFont(StandardFonts.Courier);
  const linhas = quebrarTexto('abc ' + 'x'.repeat(50), f, 10, f.widthOfTextAtSize('x'.repeat(20), 10));
  assert.deepEqual(linhas.map((l) => l.length), [3, 20, 20, 10]);
});

test('gerarCobrancaPdf: PDF de uma página com acentos, QR e vários honorários', async () => {
  const pix = montarPixCopiaCola({ chave: '12.345.678/0001-95', nome: 'Escritório Contábil', cidade: 'São Paulo', valor: 1200, txid: 'HON092026' });
  const bytes = await gerarCobrancaPdf({
    favorecido: 'Escritório Contábil Exemplo', chavePix: '12.345.678/0001-95', cliente: 'Psicologia M Lopes',
    referencia: 'Referente aos honorários contábeis de 09/2026 e 11/2026 e à alteração contratual.',
    pagarAte: '2026-11-25', total: 1200, pixCopiaCola: pix,
    qrPng: await QRCode.toDataURL(pix, { width: 320, margin: 2 }),
    itens: [
      { descricao: 'Honorário 09/2026', vencimento: '2026-09-10', valor: 450 },
      { descricao: 'Honorário 11/2026', vencimento: '2026-11-10', valor: 450 },
      { descricao: 'Alteração contratual (11/2026)', vencimento: '2026-11-20', valor: 300 },
    ],
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-');
  const lido = await PDFDocument.load(bytes);
  assert.equal(lido.getPageCount(), 1);
  if (process.env.SALVAR_PDF) writeFileSync(process.env.SALVAR_PDF, bytes);
});
