// Emissão por extrato bancário: leitura do extrato (Itaú em PDF, genérico e OFX), quem pagou cada PIX
// (nome cortado pelo banco), PIX que já tem nota, e as ações da function (analisar e criar o lote).
// Nomes e CPFs fictícios.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

process.env.NFSE_CERT_KEY = process.env.NFSE_CERT_KEY || crypto.randomBytes(32).toString('base64')
delete process.env.NFSE_EMAILS_PERMITIDOS

const { lerExtrato, nomeDoPagador, montarPessoas, sugerirNotas } = require('../extrato')
const funcao = require('../../../nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')

// CPF válido a partir de 9 dígitos
function cpf(base) {
  const d = String(base).padStart(9, '0').split('').map(Number)
  for (const n of [9, 10]) {
    const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0)
    d.push(((soma * 10) % 11) % 10)
  }
  return d.join('')
}
const ANA = cpf(111222333)
const ANAB = cpf(111222334)
const BRUNO = cpf(222333444)
const CARLA = cpf(333444555)
const NOVO = cpf(444555666)

// Como o pdf.js entrega o extrato do Itaú (uma linha por lançamento)
const ITAU = [
  'extrato conta corrente',
  'data lançamentos valor (R$) saldo (R$)',
  '30/09/2026 SALDO ANTERIOR 12.426,45',
  '01/10/2026 COR DIVIDENDOS XPTO3 3,18',
  '01/10/2026 PIX TRANSF ANA PAU01/10 200,00',
  '01/10/2026 PIX TRANSF BRUNO 30/09 300,00',
  '01/10/2026 SALDO TOTAL DISPONÍVEL DIA 12.929,63',
  '03/10/2026 PIX TRANSF ANA BEA03/10 480,00',
  '03/10/2026 PIX TRANSF CARLA S03/10 1.000,00',
  '03/10/2026 PIX TRANSF FULANO 03/10 -50,00',
  '03/10/2026 PAGTO BOLETO LUZ -120,00',
  '05/10/2026 PIX TRANSF BRUNO 05/10 300,00',
  '05/10/2026 PIX TRANSF ZEZINHO05/10 90,00',
  '06/10/2026 REND PAGO APLIC AUT MAIS 0,70',
  '06/10/2026 PIX TRANSF ANA02/10 150,00',
].join('\n')

test('lê o extrato do Itaú: só créditos, sem saldo; nome cortado e data do PIX', () => {
  const l = lerExtrato(ITAU)
  assert.deepEqual(l.map((x) => [x.data, x.nomeExtrato, x.valor, x.tipo, x.receita]), [
    ['2026-10-01', 'COR DIVIDENDOS XPTO3', '3.18', 'outro', false],
    ['2026-10-01', 'ANA PAU', '200.00', 'pix', true],
    ['2026-10-01', 'BRUNO', '300.00', 'pix', true],
    ['2026-10-03', 'ANA BEA', '480.00', 'pix', true],
    ['2026-10-03', 'CARLA S', '1000.00', 'pix', true],
    ['2026-10-05', 'BRUNO', '300.00', 'pix', true],
    ['2026-10-05', 'ZEZINHO', '90.00', 'pix', true],
    ['2026-10-06', 'REND PAGO APLIC AUT MAIS', '0.70', 'outro', false],
    ['2026-10-06', 'ANA', '150.00', 'pix', true],
  ])
  assert.equal(l[2].dataPix, '2026-09-30') // PIX de 30/09 lançado em 01/10
  assert.equal(nomeDoPagador('Transferência recebida pelo Pix - FULANO DE TAL - •••.123.456-•• - BANCO X').nome, 'FULANO DE TAL')
})

test('OFX: créditos com nome de quem pagou', () => {
  const ofx = '<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261003120000<TRNAMT>480.00<NAME>PIX RECEBIDO<MEMO>ANA BEATRIZ</STMTTRN>'
    + '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261004<TRNAMT>-20.00<MEMO>TARIFA</STMTTRN></OFX>'
  const l = lerExtrato(ofx)
  assert.equal(l.length, 1)
  assert.equal(l[0].data, '2026-10-03')
  assert.equal(l[0].nomeExtrato, 'ANA BEATRIZ')
  assert.equal(l[0].valor, '480.00')
})

test('sugestão: identifica pelo começo do nome, desempata pelo valor das notas e marca o que já tem nota', () => {
  const pessoas = montarPessoas({
    tomadores: [
      { id: 't1', nome: 'Ana Paula Souza', cpf: ANA },
      { id: 't2', nome: 'Ana Beatriz Lima', cpf: ANAB },
      { id: 't3', nome: 'Bruno Alves', cpf: BRUNO },
      { id: 't4', nome: 'Carla Santos', cpf: CARLA },
    ],
    notasGestor: [
      { estado: 'autorizada', nome: 'Bruno Alves', cpf: BRUNO, valor: 300, data: '2026-10-02', numero_nfse: '7' },
      { estado: 'importada', nome: 'Carla Santos', cpf: CARLA, valor: 1000, data: '2026-10-03' }, // não emitida: não conta
      { estado: 'autorizada', nome: 'Ana Paula Souza', cpf: ANA, valor: 150, data: '2026-09-10', numero_nfse: '3' },
    ],
  })
  const s = sugerirNotas(lerExtrato(ITAU), pessoas)
  const por = (nome, valor) => s.find((x) => x.nomeExtrato === nome && x.valor === valor)

  assert.equal(por('COR DIVIDENDOS XPTO3', '3.18').situacao, 'nao_receita')
  assert.equal(por('ANA PAU', '200.00').situacao, 'identificado')
  assert.equal(por('ANA PAU', '200.00').sugerido.cpf, ANA)
  assert.equal(por('ANA BEA', '480.00').sugerido.cpf, ANAB)
  assert.equal(por('CARLA S', '1000.00').situacao, 'identificado')
  assert.equal(por('ZEZINHO', '90.00').situacao, 'sem_cadastro')
  // "ANA" (cortado, 3 letras) serve para as duas Anas; a Ana Paula já teve nota de 150
  const ana = por('ANA', '150.00')
  assert.equal(ana.situacao, 'provavel')
  assert.equal(ana.sugerido.cpf, ANA)
  assert.deepEqual(ana.candidatos.map((c) => c.cpf), [ANA, ANAB])
  // Bruno: dois PIX de 300 em outubro e uma nota de 300 em outubro → o primeiro já tem nota, o segundo não
  const brunos = s.filter((x) => x.nomeExtrato === 'BRUNO')
  const outubro = brunos.find((x) => x.dataPix === '2026-10-05')
  const setembro = brunos.find((x) => x.dataPix === '2026-09-30')
  assert.equal(setembro.situacao, 'identificado') // PIX de setembro: a nota de outubro não cobre
  assert.equal(outubro.situacao, 'ja_tem_nota')
  assert.equal(outubro.emitir, false)
  assert.match(outubro.motivo, /nº 7/)
})

test('"BRUNO" cortado com espaço não pega "Brunorio"; nome sem corte também não', () => {
  const pessoas = montarPessoas({ tomadores: [{ nome: 'Brunorio Dias', cpf: BRUNO }] })
  const s = sugerirNotas(lerExtrato('01/10/2026 PIX TRANSF BRUNO 01/10 300,00'), pessoas)
  assert.equal(s[0].situacao, 'sem_cadastro')
})

function montar() {
  const CLIENTE = '11111111-1111-4111-8111-111111111111'
  const supa = criarSupabaseFalso({
    usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Clínica Teste', cnpj: '47.619.250/0001-78' }] },
  })
  funcao._deps.supabase = () => supa
  const chamar = async (corpo) => {
    const r = await funcao.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ cliente_id: CLIENTE, ...corpo }) })
    return { status: r.statusCode, ...JSON.parse(r.body) }
  }
  return { supa, chamar }
}

test('function: analisa o extrato e cria o lote com os PIX conferidos (quem é novo entra no cadastro)', async () => {
  const { supa, chamar } = montar()
  const gabarito = fs.readFileSync(path.join(__dirname, 'golden', 'gabarito_dps.xml'), 'utf8')
  assert.equal((await chamar({ acao: 'salvar_empresa', gabarito_xml: gabarito })).status, 200)
  for (const t of [{ nome: 'Ana Paula Souza', cpf: ANA }, { nome: 'Bruno Alves', cpf: BRUNO }, { nome: 'Carla Santos', cpf: CARLA }]) {
    assert.equal((await chamar({ acao: 'tomador_salvar', tomador: t })).status, 200)
  }

  assert.equal((await chamar({ acao: 'extrato_analisar', texto: 'nada aqui' })).status, 422)
  const a = await chamar({ acao: 'extrato_analisar', texto: ITAU })
  assert.equal(a.status, 200)
  assert.equal(a.lancamentos.length, 9)
  assert.ok(a.pessoas.some((x) => x.cpf === BRUNO))
  const zezinho = a.lancamentos.find((x) => x.nomeExtrato === 'ZEZINHO')
  assert.equal(zezinho.situacao, 'sem_cadastro')

  const marcados = a.lancamentos.filter((x) => x.emitir).map((x) => ({
    nome: x.sugerido.nome, cpf: x.sugerido.cpf, data: x.dataPix, valor: x.valor, descricao_extrato: x.descricao, nome_extrato: x.nomeExtrato,
  }))
  marcados.push({ nome: 'José Zezinho', cpf: NOVO, data: zezinho.dataPix, valor: zezinho.valor, descricao_extrato: zezinho.descricao, nome_extrato: 'ZEZINHO', salvar_cadastro: true })
  marcados.push({ nome: 'Sem CPF', cpf: '', data: '2026-10-06', valor: '150.00', nome_extrato: 'ANA' })
  assert.equal((await chamar({ acao: 'extrato_criar_lote', itens: [] })).status, 400)
  const r = await chamar({ acao: 'extrato_criar_lote', arquivo: 'extrato.pdf', itens: marcados })
  assert.equal(r.status, 200)
  assert.equal(r.salvos, 1)

  const { data: lote } = await supa.from('nfse_lotes').select('*').eq('id', r.lote_id).maybeSingle()
  assert.equal(lote.origem, 'planilha')
  assert.equal(lote.descricao, 'Extrato bancário · extrato.pdf')
  const { data: notas } = await supa.from('nfse_notas').select('*').eq('lote_id', r.lote_id)
  assert.equal(notas.length, marcados.length)
  assert.ok(notas.every((n) => n.origem === 'extrato'))
  const z = notas.find((n) => n.cpf === NOVO)
  assert.equal(Number(z.valor), 90)
  assert.equal(z.data, '2026-10-05')
  assert.match(z.texto_original, /PIX TRANSF ZEZINHO/)
  assert.ok(notas.find((n) => n.nome === 'Sem CPF').avisos.some((x) => /sem CPF/.test(x)))
  const { data: cad } = await supa.from('nfse_tomadores').select('*')
  assert.ok(cad.some((t) => t.cpf === NOVO && t.nome === 'José Zezinho'))

  // na próxima análise o Zezinho já sai identificado
  const b = await chamar({ acao: 'extrato_analisar', texto: ITAU })
  assert.equal(b.lancamentos.find((x) => x.nomeExtrato === 'ZEZINHO').situacao, 'identificado')
})
