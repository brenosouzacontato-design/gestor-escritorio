// node --test netlify/functions/lib/__tests__/pedidoNfe.test.cjs
const test = require('node:test')
const assert = require('node:assert')
const {
  ErroPedido, numero, normalizarDestinatario, normalizarPedido, descontoDoPedido, resumoWhatsapp, dadosXmlNfe,
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

test('desconto por item (R$ ou %) e na nota toda, repartido entre os itens', () => {
  const p = normalizarPedido({
    itens: [
      { descricao: 'A', quantidade: 2, valor_unitario: 50, desconto: '10,00' }, // 100 − 10 = 90
      { descricao: 'B', quantidade: 1, valor_unitario: 100, desconto: '5%' },   // 100 − 5 = 95
    ],
    desconto_geral: '18,50', frete_modalidade: 'emitente', frete_valor: 10,
  })
  // 18,50 repartido por 90 e 95: 9,00 e 9,50
  assert.deepStrictEqual(p.itens.map((i) => i.desconto), [19, 14.5])
  assert.strictEqual(descontoDoPedido(p), 33.5)
  assert.strictEqual(p.valor_produtos, 200)
  assert.strictEqual(p.valor_total, 176.5) // 200 − 33,50 + 10

  const pct = normalizarPedido({ itens: [{ descricao: 'A', quantidade: 3, valor_unitario: 10 }], desconto_geral: '10%' })
  assert.strictEqual(pct.itens[0].desconto, 3)
  assert.strictEqual(pct.valor_total, 27)

  // repartição fecha nos centavos
  const tres = normalizarPedido({ itens: [1, 2, 3].map((n) => ({ descricao: `I${n}`, quantidade: 1, valor_unitario: 10 })), desconto_geral: 1 })
  assert.strictEqual(descontoDoPedido(tres), 1)

  assert.throws(() => normalizarPedido({ itens: [{ descricao: 'A', quantidade: 1, valor_unitario: 5, desconto: 5 }] }), /maior que o valor/)
  assert.throws(() => normalizarPedido({ itens: [{ descricao: 'A', quantidade: 1, valor_unitario: 5, desconto: 'x' }] }), /Desconto do item 1/)
  assert.throws(() => normalizarPedido({ itens: [{ descricao: 'A', quantidade: 1, valor_unitario: 5 }], desconto_geral: 6 }), /maior que o valor/)

  const txt = resumoWhatsapp('Empresa Teste', { id: 'abcdef12', destinatario: normalizarDestinatario(DEST), ...p })
  assert.match(txt, /desconto R\$\s?19,00/)
  assert.match(txt, /Descontos: − R\$\s?33,50/)
  assert.match(txt, /\*Total da nota: R\$\s?176,50\*/)
})

test('dadosXmlNfe lê número, chave, valor e emitente do XML autorizado', () => {
  const chave = '31261111222333000181550010000001231000001234'
  const xml = `<nfeProc><NFe><infNFe Id="NFe${chave}"><ide><nNF>123</nNF></ide>
    <emit><CNPJ>11222333000181</CNPJ></emit><dest><CNPJ>99888777000166</CNPJ></dest>
    <total><ICMSTot><vNF>1242.00</vNF></ICMSTot></total></infNFe></NFe>
    <protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`
  assert.deepStrictEqual(dadosXmlNfe(xml), { numero: '123', chave, valor: 1242, cnpjEmitente: '11222333000181', autorizada: true })
  assert.strictEqual(dadosXmlNfe('<x/>').numero, null)
})
