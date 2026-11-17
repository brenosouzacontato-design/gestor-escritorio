import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularPessoaFisica, irTabelaMensal } from '../carneLeao.js'

test('tabela mensal: faixa isenta e última faixa', () => {
  assert.equal(irTabelaMensal(2000), 0)
  assert.equal(Math.round(irTabelaMensal(8000) * 100) / 100, 1291.27)
})

test('até R$ 5.000 no mês: IR zera pela Lei 15.270, sobra só o INSS', () => {
  const r = calcularPessoaFisica(5000)
  assert.equal(r.inss, 1000)
  assert.equal(r.irpf, 0)
  assert.equal(r.total, 1000)
})

test('faixa de transição (R$ 6.000): redução parcial', () => {
  const r = calcularPessoaFisica(6000)
  assert.equal(r.inss, 1200)
  assert.equal(r.irTabela, 411.27)
  assert.equal(r.reducao, 179.75)
  assert.equal(r.irpf, 231.52)
  assert.equal(r.total, 1431.52)
})

test('R$ 8.000: sem redução, INSS 20%', () => {
  const r = calcularPessoaFisica(8000)
  assert.equal(r.inss, 1600)
  assert.equal(r.irpf, 851.27) // (8000 - 1600) * 27,5% - 908,73
  assert.equal(r.total, 2451.27)
})

test('INSS limitado ao teto', () => {
  const r = calcularPessoaFisica(20000)
  assert.equal(r.inss, 1695.11)
  assert.equal(r.irpf, 4125.11)
})

test('receita baixa usa o desconto simplificado e INSS sobre o mínimo', () => {
  const r = calcularPessoaFisica(1000)
  assert.equal(r.inss, 324.2)
  assert.equal(r.usouSimplificado, true)
  assert.equal(r.irpf, 0)
})

test('sem receita: null', () => {
  assert.equal(calcularPessoaFisica(0), null)
})
