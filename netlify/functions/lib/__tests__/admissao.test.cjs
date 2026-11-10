// Ficha de admissão (lib/admissao.js)
const test = require('node:test')
const assert = require('node:assert')
const A = require('../admissao')

const fichaCompleta = () => A.normalizarDados({
  nome: '  Maria  da Silva ', cpf: '529.982.247-25', data_nascimento: '1995-04-10', sexo: 'Feminino',
  raca_cor: 'Parda', estado_civil: 'Solteiro(a)', escolaridade: 'Médio completo', nacionalidade: 'Brasileira',
  municipio_nascimento: 'Recife', uf_nascimento: 'pe', nome_mae: 'Ana da Silva', deficiencia: 'Não', primeiro_emprego: 'Não',
  rg_numero: '1234567', rg_orgao: 'SDS', rg_uf: 'PE', pis: '120.5604.258-6',
  celular: '(81) 98888-7777', cep: '50000-000', logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Recife', uf: 'PE',
  vale_transporte: 'Não', reservista: '999', campo_estranho: 'x',
})
const docsObrigatorios = [{ tipo: 'foto' }, { tipo: 'identidade' }, { tipo: 'residencia' }]

test('CPF e PIS com dígito verificador', () => {
  assert.ok(A.cpfValido('529.982.247-25'))
  assert.ok(!A.cpfValido('529.982.247-24'))
  assert.ok(!A.cpfValido('111.111.111-11'))
  assert.ok(A.pisValido('120.5604.258-6'))
  assert.ok(!A.pisValido('120.5604.258-5'))
})

test('normaliza: limpa, tira chave desconhecida e campo condicional inativo', () => {
  const d = fichaCompleta()
  assert.strictEqual(d.nome, 'Maria da Silva')
  assert.strictEqual(d.cpf, '52998224725')
  assert.strictEqual(d.uf_nascimento, 'PE')
  assert.strictEqual(d.cep, '50000000')
  assert.strictEqual(d.campo_estranho, undefined)
  assert.strictEqual(d.reservista, '', 'reservista só vale para Masculino')
  assert.strictEqual(A.normalizarDados({ sexo: 'X' }).sexo, '', 'opção fora da lista vira vazio')
  assert.strictEqual(A.normalizarDados({ data_nascimento: '2023-02-30' }).data_nascimento, '')
})

test('ficha completa com anexos obrigatórios não tem pendência', () => {
  assert.deepStrictEqual(A.pendenciasFicha(fichaCompleta(), docsObrigatorios), [])
})

test('pendências: obrigatório, CPF inválido, anexo e condicional', () => {
  const d = { ...fichaCompleta(), cpf: '52998224724', nome_mae: '', vale_transporte: 'Sim' }
  const p = A.pendenciasFicha(d, [{ tipo: 'foto' }])
  assert.ok(p.some((x) => /CPF inválido/.test(x)))
  assert.ok(p.some((x) => /Nome da mãe/.test(x)))
  assert.ok(p.some((x) => /ônibus/.test(x)), 'detalhe do VT exigido quando usa VT')
  assert.ok(p.some((x) => /RG ou CNH/.test(x)))
  assert.ok(!p.some((x) => /Foto/.test(x)))
})

test('dependentes: normaliza e exige nome, nascimento e parentesco', () => {
  const d = A.normalizarDados({ ...fichaCompleta(), dependentes: [{ nome: 'João', cpf: '', data_nascimento: '2018-01-01', parentesco: 'Filho(a)', irrf: 1 }, { nome: '' }, { nome: 'Sem data' }] })
  assert.strictEqual(d.dependentes.length, 2, 'linha totalmente vazia sai')
  assert.strictEqual(d.dependentes[0].irrf, true)
  const p = A.pendenciasFicha(d, docsObrigatorios)
  assert.ok(p.some((x) => /Dependente 2: falta a data/.test(x)))
})

test('resumo do WhatsApp traz dados formatados e documentos', () => {
  const texto = A.resumoWhatsapp({ cargo: 'Vendedora', data_admissao: '2026-12-01', dados: fichaCompleta(), documentos: [{ tipo: 'identidade' }, { tipo: 'identidade' }] }, 'Loja X')
  assert.match(texto, /Loja X/)
  assert.match(texto, /CPF: 529\.982\.247-25/)
  assert.match(texto, /Admissão prevista: 01\/12\/2026/)
  assert.match(texto, /RG ou CNH — frente e verso \(2\)/)
  assert.doesNotMatch(texto, /Reservista/)
})

test('linha da planilha usa as colunas do JSON e dados do escritório', () => {
  const l = A.linhaPlanilha({ cargo: 'Vendedora', salario: '1800.5', data_admissao: '2026-12-01', dados: fichaCompleta() }, { nome: 'Loja X', cnpj: '12.345.678/0001-90' })
  assert.strictEqual(l['CNPJ Empregador'], '12345678000190')
  assert.strictEqual(l['Salário'], 1800.5)
  assert.strictEqual(l.CPF, '52998224725')
  assert.strictEqual(l['Data de Nascimento'], '10/04/1995')
  assert.strictEqual(l['Qtd. Dependentes'], 0)
})

test('token do link é longo e aleatório', () => {
  const a = A.gerarToken()
  assert.match(a, /^[A-Za-z0-9_-]{24}$/)
  assert.notStrictEqual(a, A.gerarToken())
})
