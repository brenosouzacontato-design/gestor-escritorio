// node --test netlify/functions/lib/__tests__/pedidoNfe.test.cjs
const test = require('node:test')
const assert = require('node:assert')
const {
  ErroPedido, numero, normalizarDestinatario, normalizarPedido, resumoWhatsapp,
} = require('../pedidoNfe')

// dados fictícios (CNPJ de exemplo com dígitos válidos)
const DEST = {
  documento: '11.222.333/0001-81', nome: 'Loja Exemplo', cep: '01001-000', logradouro: 'Praça da Sé',
  numero: '1', bairro: 'Sé', municipio: 'São Paulo', uf: 'sp',
}

test('numero aceita formato brasileiro e com ponto', () => {
  assert.strictEqual(numero('1.234,56'), 1234.56)
  assert.strictEqual(numero('R$ 10,5'), 10.5)
  assert.strictEqual(numero('3.5'), 3.5)
  assert.strictEqual(numero(''), null)
  assert.strictEqual(numero('abc'), null)
})

test('destinatário: limpa e exige documento válido e endereço', () => {
  const d = normalizarDestinatario(DEST)
  assert.strictEqual(d.documento, '11222333000181')
  assert.strictEqual(d.cep, '01001000')
  assert.strictEqual(d.uf, 'SP')
  assert.throws(() => normalizarDestinatario({ ...DEST, documento: '11222333000100' }), ErroPedido)
  assert.throws(() => normalizarDestinatario({ ...DEST, bairro: '' }), /falta bairro/)
})

test('pedido: soma itens e frete', () => {
  const p = normalizarPedido({
    itens: [
      { descricao: 'Caixa', quantidade: '2', valor_unitario: '10,50', unidade: 'cx' },
      { descricao: 'Fita', quantidade: 3, valor_unitario: 1.333 },
    ],
    frete_modalidade: 'destinatario', frete_valor: '15',
  })
  assert.strictEqual(p.itens[0].valor_total, 21)
  assert.strictEqual(p.itens[0].unidade, 'CX')
  assert.strictEqual(p.itens[1].valor_total, 4)
  assert.strictEqual(p.valor_produtos, 25)
  assert.strictEqual(p.valor_total, 40)
})

test('pedido: sem frete zera o valor do frete; recusa item sem valor', () => {
  const p = normalizarPedido({ itens: [{ descricao: 'A', quantidade: 1, valor_unitario: 5 }], frete_modalidade: 'sem_frete', frete_valor: 9 })
  assert.strictEqual(p.frete_valor, 0)
  assert.strictEqual(p.valor_total, 5)
  assert.throws(() => normalizarPedido({ itens: [] }), /pelo menos um/)
  assert.throws(() => normalizarPedido({ itens: [{ descricao: 'A', quantidade: 1 }] }), /valor do item 1/)
  assert.throws(() => normalizarPedido({ itens: [{ descricao: 'A', quantidade: 0, valor_unitario: 1 }] }), /Quantidade/)
})

test('resumo do WhatsApp traz destinatário, itens e total', () => {
  const p = normalizarPedido({ itens: [{ descricao: 'Caixa', quantidade: 2, valor_unitario: 10 }], observacao: 'entregar cedo' })
  const txt = resumoWhatsapp('Empresa Teste', { id: 'abcdef12-0000', destinatario: normalizarDestinatario(DEST), ...p })
  assert.match(txt, /Pedido ABCDEF12/)
  assert.match(txt, /CNPJ: 11\.222\.333\/0001-81/)
  assert.match(txt, /1\. Caixa — 2 UN × R\$\s?10,00 = R\$\s?20,00/)
  assert.match(txt, /\*Total da nota: R\$\s?20,00\*/)
  assert.match(txt, /entregar cedo/)
})
