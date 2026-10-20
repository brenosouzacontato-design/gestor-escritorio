// Paridade do importador JS com o Python (emissor-nfse/scripts/gerar_golden_importador.py).
// fixtures/lote_whatsapp.txt = lote real de 26 atendimentos com nomes/CPFs/ruas fictícios.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { importarTextoWhatsapp, importarLinhas, importarCsv, parseValor } = require('../importador')
const { validar, cpfValido, chaveDuplicidade } = require('../validador')

const F = path.join(__dirname, 'fixtures')
const esperado = JSON.parse(fs.readFileSync(path.join(F, 'importador_python.json'), 'utf8'))

const comoPython = (r) => ({
  nome: r.nome, cpf: r.cpf, endereco: r.endereco, cep: r.cep, data: r.data, valor: r.valor,
  descricao: r.descricao, autor: r.autor, data_mensagem: r.dataMensagem, origem: r.origem,
  texto_original: r.textoOriginal, avisos: r.avisos,
})

for (const arquivo of Object.keys(esperado)) {
  test(`paridade com o Python: ${arquivo}`, () => {
    const regs = importarTextoWhatsapp(fs.readFileSync(path.join(F, arquivo), 'utf8'))
    assert.equal(regs.length, esperado[arquivo].length)
    regs.forEach((r, i) => assert.deepEqual(comoPython(r), esperado[arquivo][i], `registro ${i + 1}`))
  })
}

test('lote real: 20 prontos, 5 pendentes, 1 inválido', () => {
  const regs = importarTextoWhatsapp(fs.readFileSync(path.join(F, 'lote_whatsapp.txt'), 'utf8'))
  const campos = ['nome', 'cpf', 'data', 'valor', 'descricao', 'endereco']
  const status = regs.map((r) => validar({ ...r, camposObrigatorios: campos, hoje: '2026-10-15' }).status)
  const conta = (s) => status.filter((x) => x === s).length
  assert.deepEqual([conta('pronto'), conta('pendente'), conta('invalido')], [20, 5, 1])
  assert.equal(status[1], 'invalido') // CPF com dígito verificador errado
})

test('parseValor igual ao Decimal do Python', () => {
  assert.equal(parseValor('1.590,00'), '1590.00')
  assert.equal(parseValor('1590,00'), '1590.00')
  assert.equal(parseValor('R$ 900'), '900.00')
  assert.equal(parseValor('1.590'), '1590.00')
  assert.equal(parseValor('900.5'), '900.50')
  assert.equal(parseValor('0.125'), '125.00') // ponto = milhar, como no Python
  assert.equal(parseValor('0,125'), '0.12') // meio para o par
  assert.equal(parseValor('0,135'), '0.14')
  assert.equal(parseValor('abc'), null)
})

test('validador', () => {
  const base = { nome: 'Maria', cpf: '52998224725', data: '2026-01-01', valor: '100.00', descricao: 'Limpeza',
    endereco: 'Rua X', camposObrigatorios: ['nome', 'cpf', 'data', 'valor', 'descricao', 'endereco'], hoje: '2026-10-15' }
  assert.equal(validar(base).status, 'pronto')
  assert.deepEqual(validar({ ...base, cpf: '', descricao: '', endereco: '' }).pendencias, ['CPF', 'Descrição', 'Endereço'])
  assert.equal(validar({ ...base, cpf: '52998224726' }).status, 'invalido')
  assert.equal(validar({ ...base, valor: '0.00' }).status, 'invalido')
  assert.equal(validar({ ...base, data: '2026-10-16' }).status, 'invalido')
  assert.equal(validar({ ...base, competencia: '2026-11-01' }).status, 'invalido')
  assert.ok(cpfValido('01092815945') && !cpfValido('11111111111'))
  assert.equal(chaveDuplicidade('52998224725', '2026-01-01', '100'), '52998224725|2026-01-01|100.00')
  assert.equal(chaveDuplicidade('', '2026-01-01', '100'), null)
})

test('planilha: CPF sem zero à esquerda, CEP numérico, data do Excel e valor numérico', () => {
  const regs = importarLinhas([
    ['Data', 'Nome', 'CPF', 'Endereço', 'CEP', 'Descrição', 'Valor'],
    [new Date(Date.UTC(2026, 0, 22)), 'Renata', 1092815945, 'Rua X 1', 33900370, 'Peça', 900],
    ['', '', '', '', '', '', ''],
  ])
  assert.equal(regs.length, 1)
  const r = regs[0]
  assert.deepEqual([r.cpf, r.cep, r.data, r.valor], ['01092815945', '33900370', '2026-01-22', '900.00'])
  assert.match(r.avisos[0], /zeros à esquerda/)
  const csv = importarCsv('data;nome;cpf;endereco;cep;descricao;valor\n22/01/2026;"Silva; Maria";52998224725;Rua X 1;;Peça;"1.590,00"\n')
  assert.deepEqual([csv[0].nome, csv[0].valor, csv[0].data], ['Silva; Maria', '1590.00', '2026-01-22'])
  assert.throws(() => importarLinhas([['a', 'b']]), /cabeçalho/)
})
