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

// Desconto em R$ ou "%": "10%" de 200 → 20. null quando vazio.
function lerDesconto(v, base) {
  if (v == null || v === '') return null
  if (typeof v === 'string' && v.trim().endsWith('%')) {
    const pct = numero(v.trim().slice(0, -1))
    return pct == null ? NaN : centavos(base * pct / 100)
  }
  const n = numero(v)
  return n == null ? NaN : centavos(n)
}

// Reparte o desconto da nota toda entre os itens, proporcional ao valor de
// cada um (a NF-e só tem desconto por item: vDesc). O último leva a sobra
// dos centavos.
function repartirDesconto(valores, desconto) {
  const total = valores.reduce((s, v) => s + v, 0)
  let resto = desconto
  return valores.map((v, n) => {
    if (n === valores.length - 1) return centavos(resto)
    const parte = total ? centavos(desconto * v / total) : 0
    resto -= parte
    return parte
  })
}

// Itens + desconto + frete → valores do pedido. Lança ErroPedido.
// Cada item: valor_total = quantidade × valor unitário (vProd) e desconto (vDesc).
// Total da nota = produtos − descontos + frete (como o vNF).
function normalizarPedido({ itens, desconto_geral, frete_modalidade, frete_valor, observacao } = {}) {
  if (!Array.isArray(itens) || !itens.length) throw new ErroPedido('Inclua pelo menos um produto.')
  if (itens.length > MAX_ITENS) throw new ErroPedido(`No máximo ${MAX_ITENS} produtos por nota.`)
  const limpos = itens.map((i, n) => {
    const prod = normalizarProduto(i)
    const quantidade = numero(i.quantidade)
    if (!quantidade || quantidade <= 0) throw new ErroPedido(`Quantidade do item ${n + 1} (${prod.descricao}) inválida.`)
    if (!prod.valor_unitario || prod.valor_unitario <= 0) throw new ErroPedido(`Informe o valor do item ${n + 1} (${prod.descricao}).`)
    const valorTotal = centavos(quantidade * prod.valor_unitario)
    const desconto = lerDesconto(i.desconto, valorTotal) ?? 0
    if (!Number.isFinite(desconto) || desconto < 0) throw new ErroPedido(`Desconto do item ${n + 1} (${prod.descricao}) inválido.`)
    if (desconto >= valorTotal) throw new ErroPedido(`O desconto do item ${n + 1} (${prod.descricao}) é maior que o valor dele.`)
    return {
      produto_id: typeof i.produto_id === 'string' ? i.produto_id : null,
      ...prod,
      quantidade,
      valor_total: valorTotal,
      desconto,
    }
  })

  const liquidos = limpos.map((i) => centavos(i.valor_total - i.desconto))
  const geral = lerDesconto(desconto_geral, liquidos.reduce((s, v) => s + v, 0)) ?? 0
  if (!Number.isFinite(geral) || geral < 0) throw new ErroPedido('Desconto da nota inválido.')
  if (geral > 0) {
    const partes = repartirDesconto(liquidos, geral)
    limpos.forEach((i, n) => { i.desconto = centavos(i.desconto + partes[n]) })
    if (limpos.some((i) => i.desconto >= i.valor_total)) throw new ErroPedido('O desconto é maior que o valor dos produtos.')
  }

  const modalidade = FRETES[frete_modalidade] ? frete_modalidade : 'sem_frete'
  const frete = modalidade === 'sem_frete' ? 0 : centavos(numero(frete_valor) || 0)
  if (frete < 0) throw new ErroPedido('Valor do frete inválido.')
  const valorProdutos = centavos(limpos.reduce((s, i) => s + i.valor_total, 0))
  const descontos = descontoDoPedido({ itens: limpos })
  return {
    itens: limpos,
    valor_produtos: valorProdutos,
    frete_modalidade: modalidade,
    // valor do frete destacado na nota (soma no total, como no vNF da NF-e)
    frete_valor: frete,
    valor_total: centavos(valorProdutos - descontos + frete),
    observacao: texto(observacao, 1000),
  }
}

// Soma dos descontos dos itens (fica dentro de itens: não tem coluna própria)
const descontoDoPedido = (ped) => centavos((ped?.itens || []).reduce((s, i) => s + (Number(i.desconto) || 0), 0))

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

// Texto do WhatsApp com o pedido inteiro (corrigido: o cliente editou um pedido com pendência)
function resumoWhatsapp(empresa, ped, { corrigido = false } = {}) {
  const d = ped.destinatario
  const linhas = [
    `🧾 *Pedido de NF-e de venda${corrigido ? ' (corrigido)' : ''}* — ${empresa}`,
    `Pedido ${numeroPedido(ped.id)}`,
    '',
    `*Destinatário:* ${d.nome}`,
    `${d.documento && d.documento.length === 11 ? 'CPF' : 'CNPJ'}: ${fmtDocumento(d.documento)}${d.ie ? ` · IE ${d.ie}` : ''}`,
    `📍 ${endereco(d)}`,
    '',
    '*Produtos:*',
    ...ped.itens.map((i, n) => `${n + 1}. ${i.descricao}${i.ncm ? ` (NCM ${i.ncm})` : ''} — ${qtd(i.quantidade)} ${i.unidade} × ${brl(i.valor_unitario)} = ${brl(i.valor_total)}${Number(i.desconto) > 0 ? ` (desconto ${brl(i.desconto)})` : ''}`),
    '',
    `Produtos: ${brl(ped.valor_produtos)}`,
  ]
  const desconto = descontoDoPedido(ped)
  if (desconto > 0) linhas.push(`Descontos: − ${brl(desconto)}`)
  if (ped.frete_modalidade === 'sem_frete') linhas.push('Frete: sem frete')
  else linhas.push(`Frete: ${brl(ped.frete_valor)} (${FRETES[ped.frete_modalidade].toLowerCase()})`)
  linhas.push(`*Total da nota: ${brl(ped.valor_total)}*`)
  if (ped.observacao) linhas.push('', `📝 ${ped.observacao}`)
  linhas.push('', 'Pedido recebido pelo escritório. Assim que a nota for emitida, enviamos o PDF e o XML por aqui.')
  return linhas.join('\n')
}

// Pedido que o cliente ainda pode mudar: antes de ir para emissão, ou devolvido com pendência
const PODE_EDITAR = ['recebida', 'erro']

// WhatsApp para o cliente quando o escritório devolve o pedido para corrigir
function avisoPendencia(ped, motivo, link) {
  return [
    `⚠️ *Pedido de NF-e ${numeroPedido(ped.id)} precisa de correção*`,
    `Para ${ped.destinatario?.nome || 'o destinatário'} · ${brl(ped.valor_total)}`,
    '',
    `O que falta: ${motivo}`,
    '',
    `Abra o app${link ? ` (${link})` : ''}, vá em *Meus pedidos* e toque em *Corrigir*. A nota só é emitida depois da correção.`,
  ].join('\n')
}

// Número, chave, valor e CNPJ do emitente do XML da NF-e autorizada (anexo manual / pelo Claude).
function dadosXmlNfe(xml) {
  const t = String(xml || '')
  const pega = (rx) => (t.match(rx) || [])[1] || null
  const emit = pega(/<emit>([\s\S]*?)<\/emit>/)
  return {
    numero: pega(/<nNF>(\d+)<\/nNF>/),
    chave: pega(/<chNFe>(\d{44})<\/chNFe>/) || pega(/Id="NFe(\d{44})"/),
    valor: Number(pega(/<vNF>([\d.]+)<\/vNF>/)) || null,
    cnpjEmitente: emit ? (emit.match(/<CNPJ>(\d{14})<\/CNPJ>/) || [])[1] || null : null,
    autorizada: /<cStat>100<\/cStat>/.test(t),
  }
}

module.exports = {
  PODE_EDITAR, avisoPendencia,
  FRETES, ErroPedido, numero, normalizarDestinatario, normalizarProduto, normalizarPedido,
  descontoDoPedido, resumoWhatsapp, numeroPedido, fmtDocumento, dadosXmlNfe,
}
