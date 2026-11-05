// netlify/functions/lib/pedidoNfe.js
//
// Pedido de NF-e de venda (app ?pedido=, src/pages/pedidonfe): confere o que
// o cliente mandou e monta o resumo que vai pelo WhatsApp. Funções puras,
// sem banco — testadas em __tests__/pedidoNfe.test.cjs. Quem grava é
// netlify/functions/nfe-solicitacao.js.

const { cpfValido, cnpjValido } = require('./nfse/validador')

const FRETES = {
  sem_frete: 'Sem frete',
  emitente: 'Por conta de quem vende',
  destinatario: 'Por conta de quem compra',
  terceiros: 'Por conta de terceiros',
}

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '))
const MAX_ITENS = 100

class ErroPedido extends Error {}

const texto = (v, max = 200) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
const digitos = (v) => String(v ?? '').replace(/\D/g, '')

// "1.234,56" | "1234.56" | 1234.56 → 1234.56 (null quando não é número)
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const centavos = (n) => Math.round(n * 100) / 100

function documentoValido(doc) {
  if (doc.length === 11) return cpfValido(doc)
  if (doc.length === 14) return cnpjValido(doc)
  return false
}

// Destinatário do pedido/cadastro, limpo. Lança ErroPedido com o que falta.
function normalizarDestinatario(d = {}) {
  const dest = {
    documento: digitos(d.documento) || null,
    nome: texto(d.nome, 120),
    ie: texto(d.ie, 20),
    email: texto(d.email, 120),
    telefone: texto(d.telefone, 30),
    cep: digitos(d.cep) || null,
    logradouro: texto(d.logradouro, 120),
    numero: texto(d.numero, 20),
    complemento: texto(d.complemento, 60),
    bairro: texto(d.bairro, 60),
    municipio: texto(d.municipio, 60),
    uf: (texto(d.uf, 2) || '').toUpperCase() || null,
  }
  if (!dest.nome) throw new ErroPedido('Informe o nome de quem vai receber a nota.')
  if (!dest.documento || !documentoValido(dest.documento)) throw new ErroPedido(`CPF/CNPJ inválido para ${dest.nome}.`)
  const falta = []
  if (!dest.cep || dest.cep.length !== 8) falta.push('CEP')
  if (!dest.logradouro) falta.push('rua')
  if (!dest.numero) falta.push('número')
  if (!dest.bairro) falta.push('bairro')
  if (!dest.municipio) falta.push('cidade')
  if (!dest.uf || !UFS.has(dest.uf)) falta.push('UF')
  if (falta.length) throw new ErroPedido(`Endereço de ${dest.nome} incompleto: falta ${falta.join(', ')}.`)
  return dest
}

// Produto do cadastro, limpo (valor é opcional no cadastro)
function normalizarProduto(p = {}) {
  const prod = {
    descricao: texto(p.descricao, 120),
    codigo: texto(p.codigo, 60),
    ncm: digitos(p.ncm) || null,
    unidade: (texto(p.unidade, 6) || 'UN').toUpperCase(),
    valor_unitario: numero(p.valor_unitario),
  }
  if (!prod.descricao) throw new ErroPedido('Informe a descrição do produto.')
  if (prod.ncm && prod.ncm.length !== 8) throw new ErroPedido(`NCM de "${prod.descricao}" deve ter 8 dígitos.`)
  if (prod.valor_unitario != null && prod.valor_unitario < 0) throw new ErroPedido(`Valor de "${prod.descricao}" não pode ser negativo.`)
  return prod
}

// Itens + frete → valores do pedido. Lança ErroPedido.
function normalizarPedido({ itens, frete_modalidade, frete_valor, observacao } = {}) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroPedido('Inclua pelo menos um produto.')
  if (itens.length > MAX_ITENS) throw new ErroPedido(`No máximo ${MAX_ITENS} produtos por nota.`)
  const limpos = itens.map((i, n) => {
    const prod = normalizarProduto(i)
    const quantidade = numero(i.quantidade)
    if (!quantidade || quantidade <= 0) throw new ErroPedido(`Quantidade do item ${n + 1} (${prod.descricao}) inválida.`)
    if (!prod.valor_unitario || prod.valor_unitario <= 0) throw new ErroPedido(`Informe o valor do item ${n + 1} (${prod.descricao}).`)
    return {
      produto_id: typeof i.produto_id === 'string' ? i.produto_id : null,
      ...prod,
      quantidade,
      valor_total: centavos(quantidade * prod.valor_unitario),
    }
  })
  const modalidade = FRETES[frete_modalidade] ? frete_modalidade : 'sem_frete'
  const frete = modalidade === 'sem_frete' ? 0 : centavos(numero(frete_valor) || 0)
  if (frete < 0) throw new ErroPedido('Valor do frete inválido.')
  const valorProdutos = centavos(limpos.reduce((s, i) => s + i.valor_total, 0))
  return {
    itens: limpos,
    valor_produtos: valorProdutos,
    frete_modalidade: modalidade,
    // valor do frete destacado na nota (soma no total, como no vNF da NF-e)
    frete_valor: frete,
    valor_total: centavos(valorProdutos + frete),
    observacao: texto(observacao, 1000),
  }
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 })

function fmtDocumento(doc) {
  const d = digitos(doc)
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc || ''
}

function endereco(d) {
  const cep = d.cep ? `CEP ${String(d.cep).replace(/(\d{5})(\d{3})/, '$1-$2')}` : null
  return [
    [d.logradouro, d.numero].filter(Boolean).join(', '),
    d.complemento, d.bairro,
    [d.municipio, d.uf].filter(Boolean).join('/'), cep,
  ].filter(Boolean).join(' – ')
}

const numeroPedido = (id) => String(id || '').slice(0, 8).toUpperCase()

// Texto do WhatsApp com o pedido inteiro
function resumoWhatsapp(empresa, ped) {
  const d = ped.destinatario
  const linhas = [
    `🧾 *Pedido de NF-e de venda* — ${empresa}`,
    `Pedido ${numeroPedido(ped.id)}`,
    '',
    `*Destinatário:* ${d.nome}`,
    `${d.documento && d.documento.length === 11 ? 'CPF' : 'CNPJ'}: ${fmtDocumento(d.documento)}${d.ie ? ` · IE ${d.ie}` : ''}`,
    `📍 ${endereco(d)}`,
    '',
    '*Produtos:*',
    ...ped.itens.map((i, n) => `${n + 1}. ${i.descricao}${i.ncm ? ` (NCM ${i.ncm})` : ''} — ${qtd(i.quantidade)} ${i.unidade} × ${brl(i.valor_unitario)} = ${brl(i.valor_total)}`),
    '',
    `Produtos: ${brl(ped.valor_produtos)}`,
  ]
  if (ped.frete_modalidade === 'sem_frete') linhas.push('Frete: sem frete')
  else linhas.push(`Frete: ${brl(ped.frete_valor)} (${FRETES[ped.frete_modalidade].toLowerCase()})`)
  linhas.push(`*Total da nota: ${brl(ped.valor_total)}*`)
  if (ped.observacao) linhas.push('', `📝 ${ped.observacao}`)
  linhas.push('', 'Pedido recebido pelo escritório. Assim que a nota for emitida, enviamos o PDF e o XML por aqui.')
  return linhas.join('\n')
}

module.exports = {
  FRETES, ErroPedido, numero, normalizarDestinatario, normalizarProduto, normalizarPedido,
  resumoWhatsapp, numeroPedido, fmtDocumento,
}
