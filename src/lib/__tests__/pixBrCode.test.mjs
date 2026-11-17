import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, montarPixCopiaCola, normalizarChavePix, textoPix } from '../pixBrCode.js';

test('crc16: valor de referência do CRC-16/CCITT-FALSE', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('crc16: exemplo do manual do BR Code (Banco Central)', () => {
  const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000'
    + '5204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(semCrc), '1D3D');
});

test('normalizarChavePix: CPF, CNPJ, telefone, e-mail e aleatória', () => {
  assert.equal(normalizarChavePix('529.982.247-25'), '52998224725');
  assert.equal(normalizarChavePix('12.345.678/0001-95'), '12345678000195');
  assert.equal(normalizarChavePix('(11) 98765-4321'), '+5511987654321');
  assert.equal(normalizarChavePix('+55 11 98765-4321'), '+5511987654321');
  assert.equal(normalizarChavePix('Contato@Escritorio.com.br'), 'contato@escritorio.com.br');
  assert.equal(normalizarChavePix('123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
});

test('textoPix: tira acento e corta no limite', () => {
  assert.equal(textoPix('Escritório Contábil São João Ltda ME', 25), 'Escritorio Contabil Sao J');
});

test('montarPixCopiaCola: estrutura, valor somado e CRC fechando', () => {
  const pix = montarPixCopiaCola({
    chave: '12.345.678/0001-95', nome: 'Escritório Contábil', cidade: 'São Paulo',
    valor: 450 + 120.5, txid: 'HON-10/2026', descricao: 'Honorários 09 e 10/2026',
  });
  assert.ok(pix.startsWith('000201'));
  assert.ok(pix.includes('0014br.gov.bcb.pix011412345678000195'));
  assert.ok(pix.includes('5406570.50'));
  assert.ok(pix.includes('5919Escritorio Contabil'));
  assert.ok(pix.includes('6009Sao Paulo'));
  assert.ok(pix.includes('62130509HON102026'));
  assert.equal(pix.slice(-4), crc16(pix.slice(0, -4)));
});

test('montarPixCopiaCola: avisa o que falta configurar', () => {
  const base = { chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 10 };
  assert.throws(() => montarPixCopiaCola({ ...base, chave: '' }), /chave PIX/);
  assert.throws(() => montarPixCopiaCola({ ...base, nome: '' }), /favorecido/);
  assert.throws(() => montarPixCopiaCola({ ...base, cidade: '' }), /cidade/);
  assert.throws(() => montarPixCopiaCola({ ...base, valor: 0 }), /maior que zero/);
});
