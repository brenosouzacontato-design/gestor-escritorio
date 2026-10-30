// Leitura das guias de parcelamento (src/pages/parcelamentos/leitorGuiaParcelamento.js)
// com o texto que o pdfjs extrai de guias reais (PGFN-SISPAR e PARCMEI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarTextoGuia } from '../../pages/parcelamentos/leitorGuiaParcelamento.js';

const SISPAR = "Documento de Arrecadação\n do Simples Nacional \n 123.456.789-09   FULANO DE TAL \n Período de Apuração   Data de Vencimento   Número do Documento \n 07.17.26212.4945112-0   Pagar este documento até \n 31/07/2026 Observações \n PGFN-SISPAR:014305206.PAGAR COM CODIGO DE BARRAS.\n PAGAR ATE O VENCIMENTO.   Valor Total do Documento \n 328,87 \n CPF   Nome \n Maio/2026   31/07/2026 \n Código   Principal Denominação   Total Multa   Juros\n Composição do Documento de Arrecadação \n 1550   R   D   ATIVA   -   INSS - SIMPLES NACIONAL - MEI   91,66   18,33   63,86   173,85\n 1550   R   D   ATIVA   -   INSS - SIMPLES NACIONAL - MEI   84,97   16,99   53,06   155,02 \n Totais   176,63   116,92 35,32   328,87 \n SENDA (Versão:5.2.10)   31/07/2026 16:51:59 1   1 Página:   / \n 85810000003 0   28870328262 6   12071726212 0   49451120901 4   AUTENTICAÇÃO MECÂNICA \n Documento de Arrecadação do Simples Nacional \n 85810000003 0   28870328262 6   12071726212 0   123.456.789-09\n Número:   07.17.26212.4945112-0\n Pagar até:   31/07/2026\n Valor:   328,87\n 49451120901 4   CPF: \n Pague com o PIX\nWarning: UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided.\n";
const PARCMEI = "Documento de Arrecadação\n do Simples Nacional \n 11.222.333/0001-81   BELTRANO DA SILVA 98765432100 \n Período de Apuração   Data de Vencimento   Número do Documento \n 07.18.26243.6471855-8   Pagar este documento até \n 31/08/2026 Observações \n DAS de PARCMEI (Versão: 2.2.4)\n Número do Parcelamento: 2\n Número da Parcela: 20/60 \n Valor Total do Documento \n 93,30 \n CNPJ   Razão Social \n Diversos \n Código   Principal Denominação   Total Multa   Juros\n Composição do Documento de Arrecadação \n 0083   ICMS   -   SIMPLES NACIONAL - MEI   0,08   0,01   0,04   0,13\n MG   -   11/2020\n 0151   INSS   -   SIMPLES NACIONAL - MEI   3,94   0,78   2,40   7,12\n 11/2020\n 0125   ISS   -   SIMPLES NACIONAL - MEI   0,38   0,07   0,23   0,68\n BELO   HORIZONTE (MG) - 11/2020\n 0083   ICMS   -   SIMPLES NACIONAL - MEI   0,81   0,16   0,49   1,46\n MG   -   12/2020\n 0151   INSS   -   SIMPLES NACIONAL - MEI   42,33   8,46   25,80   76,59\n 12/2020\n 0125   ISS   -   SIMPLES NACIONAL - MEI   4,05   0,81   2,46   7,32\n BELO   HORIZONTE (MG) - 12/2020 \n Totais   51,59   31,42 10,29   93,30 \n SENDA (Versão:1.5.10)   31/08/2026 11:00:55 1   1 Página:   / \n 85820000000 7   93300328262 0   43071826243 0   64718558500 5   AUTENTICAÇÃO MECÂNICA \n Documento de Arrecadação do Simples Nacional \n 85820000000 7   93300328262 0   43071826243 0   11.222.333/0001-81\n Número:   07.18.26243.6471855-8\n Pagar até:   31/08/2026\n Valor:   93,30\n 64718558500 5   CNPJ: \n Pague com o PIX\n";

test('guia PGFN-SISPAR (MEI no CPF) — dados pessoais trocados', () => {
  const d = interpretarTextoGuia(SISPAR);
  assert.equal(d.origem, 'PGFN');
  assert.equal(d.documentoDigitos, '12345678909');
  assert.equal(d.nome, 'FULANO DE TAL');
  assert.equal(d.conta, '014305206');
  assert.equal(d.competencia, '05/2026');
  assert.equal(d.vencimento, '2026-07-31');
  assert.equal(d.valor, 328.87);
  assert.equal(d.parcela, null);
  assert.equal(d.linhaDigitavel, '858100000030288703282626120717262120494511209014');
});

test('guia PARCMEI', () => {
  const d = interpretarTextoGuia(PARCMEI);
  assert.equal(d.origem, 'PARCMEI');
  assert.equal(d.documentoDigitos, '11222333000181');
  assert.equal(d.nome, 'BELTRANO DA SILVA');
  assert.equal(d.conta, '2');
  assert.equal(d.parcela, 20);
  assert.equal(d.totalParcelas, 60);
  assert.equal(d.vencimento, '2026-08-31');
  assert.equal(d.valor, 93.3);
  assert.equal(d.linhaDigitavel.length, 48);
});

test('texto que não é guia de parcelamento', () => {
  assert.equal(interpretarTextoGuia('Documento de Arrecadação do Simples Nacional — PGDAS'), null);
});
