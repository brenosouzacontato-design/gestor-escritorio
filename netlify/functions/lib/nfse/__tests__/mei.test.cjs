const { test } = require('node:test')
const assert = require('node:assert')
const { senhaDasObservacoes, ErroMei, dvOk, descricaoDoMes, numero, codigoTributacao, normalizarModelo, normalizarNota, notaRepetida } = require('../mei')

// documentos fictícios com DV válido
const CPF = '52998224725'
const CNPJ = '11222333000181'

test('DV de CPF e CNPJ', () => {
  assert.ok(dvOk(CPF))
  assert.ok(dvOk('11.222.333/0001-81'))
  assert.ok(!dvOk('52998224724'))
  assert.ok(!dvOk('11111111111'))
})

test('valor em formato brasileiro', () => {
  assert.strictEqual(numero('1.234,56'), 1234.56)
  assert.strictEqual(numero('R$ 150,00'), 150)
  assert.strictEqual(numero('80.5'), 80.5)
  assert.strictEqual(numero(''), null)
  assert.throws(() => numero('abc'), ErroMei)
})

test('código de tributação nacional', () => {
  assert.strictEqual(codigoTributacao('01.07.01'), '010701')
  assert.strictEqual(codigoTributacao('1.07.01'), '010701')
  assert.strictEqual(codigoTributacao('140101'), '140101')
  assert.throws(() => codigoTributacao('0107'), /6 dígitos/)
})

test('modelo: tomador opcional, CPF exige nome, DV conferido', () => {
  const m = normalizarModelo({ descricao: ' Manutenção ', codigo_tributacao: '14.01.01', valor: '' })
  assert.deepStrictEqual(m, { tomador_nome: '', tomador_doc: null, codigo_tributacao: '140101', municipio_prestacao: '', descricao: 'Manutenção', valor: null, ativo: true })
  assert.strictEqual(normalizarModelo({ descricao: 'x', codigo_tributacao: '010701', tomador_doc: '11.222.333/0001-81' }).tomador_doc, CNPJ)
  assert.throws(() => normalizarModelo({ descricao: 'x', codigo_tributacao: '010701', tomador_doc: CPF }), /nome/)
  assert.throws(() => normalizarModelo({ descricao: 'x', codigo_tributacao: '010701', tomador_doc: '11222333000182', tomador_nome: 'A' }), /verificador/)
  assert.throws(() => normalizarModelo({ codigo_tributacao: '010701' }), /descrição/)
})

test('nota: valor obrigatório e competência não futura', () => {
  const hoje = new Date('2026-11-09T12:00:00')
  const n = normalizarNota({ descricao: 'Serviço', codigo_tributacao: '010701', valor: '250,00', competencia: '2026-11-09', tomador_doc: CPF, tomador_nome: 'Maria' }, hoje)
  assert.strictEqual(n.valor, 250)
  assert.strictEqual(n.competencia, '2026-11-09')
  assert.ok(!('ativo' in n))
  assert.throws(() => normalizarNota({ descricao: 'S', codigo_tributacao: '010701', competencia: '2026-11-09' }, hoje), /valor/)
  assert.throws(() => normalizarNota({ descricao: 'S', codigo_tributacao: '010701', valor: 1, competencia: '2026-11-10' }, hoje), /futura/)
})

test('nota repetida: mesmo tomador, valor e mês; erro/cancelada não contam', () => {
  const nova = { tomador_doc: CNPJ, valor: 300, competencia: '2026-11-09' }
  const base = { tomador_doc: CNPJ, valor: '300.00', competencia: '2026-11-02', status: 'emitida' }
  assert.ok(notaRepetida(nova, [base]))
  assert.strictEqual(notaRepetida(nova, [{ ...base, status: 'erro' }]), null)
  assert.strictEqual(notaRepetida(nova, [{ ...base, competencia: '2026-10-30' }]), null)
  assert.strictEqual(notaRepetida(nova, [{ ...base, valor: 301 }]), null)
})

test('{mes} na descrição vira o mês da competência', () => {
  assert.strictEqual(descricaoDoMes('Serviços prestados em {mes}.', '2026-11-09'), 'Serviços prestados em novembro de 2026.')
  assert.strictEqual(descricaoDoMes('Sem data', '2026-03-01'), 'Sem data')
  const n = normalizarNota({ descricao: 'Serviços prestados no mês de {mes}. PIX: x', codigo_tributacao: '170201', valor: 7000, competencia: '2026-03-31' }, new Date('2026-11-09T12:00:00'))
  assert.strictEqual(n.descricao, 'Serviços prestados no mês de março de 2026. PIX: x')
})

test('senha do portal nas observações do cadastro', () => {
  assert.strictEqual(senhaDasObservacoes('CPF 000\nSenha gov: Abc#1\nSenha portal nacional nfse: Teste@123'), 'Teste@123')
  assert.strictEqual(senhaDasObservacoes('Senha nfse: Xy9\r\ncpf: 1'), 'Xy9')
  assert.strictEqual(senhaDasObservacoes('Senha gov: Abc'), null)
  assert.strictEqual(senhaDasObservacoes('nfse: a\nnfse: b'), null)
  assert.strictEqual(senhaDasObservacoes(null), null)
})
