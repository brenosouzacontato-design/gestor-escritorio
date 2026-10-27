// Todas as notas emitidas (ADN): leitura por NSU, só as emitidas pela empresa, eventos de
// cancelamento, e a function do link do cliente (quem vê o quê, PDF/XML, link assinado).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://supabase.invalido'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'chave-de-teste'

const { sincronizar, resumirNfse, lerEvento } = require('../adn')
const funcao = require('../../../nfse-emitidas')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')

const BASE = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfse_homologacao.xml'), 'utf8')
const CNPJ = '47619250000178' // emitente do XML de exemplo
const OUTRO = '11222333000181'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

// NFS-e de produção com número/chave/competência próprios; `emitente` troca o CNPJ do emit
function nfse(n, { emitente = CNPJ, competencia = '2026-10-02' } = {}) {
  const chave = `3154606224761925000017800000000000${String(n).padStart(16, '0')}`
  return {
    chave,
    xml: BASE.replace(/Id="NFS\d{50}"/, `Id="NFS${chave}"`)
      .replace('<nNFSe>1</nNFSe>', `<nNFSe>${n}</nNFSe>`)
      .replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')
      .replace('<dCompet>2026-10-02</dCompet>', `<dCompet>${competencia}</dCompet>`)
      .replace(`<emit><CNPJ>${CNPJ}</CNPJ>`, `<emit><CNPJ>${emitente}</CNPJ>`),
  }
}
const evento = (chave, codigo) => `<evento><infEvento><pedRegEvento><infPedReg><chNFSe>${chave}</chNFSe><e${codigo}><xDesc>x</xDesc></e${codigo}></infPedReg></pedRegEvento></infEvento></evento>`
const doc = (nsu, tipo, xml) => ({ NSU: nsu, TipoDocumento: tipo, ArquivoXml: zlib.gzipSync(Buffer.from(xml)).toString('base64') })

// ADN falso: documentos em ordem de NSU, devolvidos em lotes de `tam` a partir do NSU pedido
function adnFalso(docs, { tam = 50 } = {}) {
  const chamadas = []
  return {
    chamadas,
    lote: async (nsu) => {
      chamadas.push(nsu)
      const lote = docs.filter((d) => d.NSU > nsu).slice(0, tam)
      return lote.length ? { status: 200, dados: { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote } } : { status: 404, dados: {} }
    },
  }
}

const tabelas = () => ({ nfse_adn_notas: [], nfse_adn_controle: [] })

test('resumo da NFS-e e leitura do evento', () => {
  const { chave, xml } = nfse(7)
  const r = resumirNfse(xml)
  assert.equal(r.chave_acesso, chave)
  assert.equal(r.emitente_doc, CNPJ)
  assert.equal(r.numero_nfse, '7')
  assert.equal(r.competencia, '2026-10-02')
  assert.equal(r.tomador_nome, 'Paciente de Teste')
  assert.equal(r.valor, 20)
  assert.equal(r.ambiente, 'producao')
  assert.deepEqual(lerEvento(evento(chave, 101101)), { chave, codigo: 101101 })
})

test('sincroniza só as notas emitidas pela empresa, continua do último NSU e aplica cancelamento', async () => {
  const n1 = nfse(1); const n2 = nfse(2); const recebida = nfse(3, { emitente: OUTRO })
  const docs = [doc(1, 'NFSE', n1.xml), doc(2, 'NFSE', recebida.xml), doc(3, 'NFSE', n2.xml)]
  const supa = criarSupabaseFalso({ tabelas: tabelas() })
  const adn = adnFalso(docs)

  const r = await sincronizar({ db: supa, clienteId: A, cnpj: CNPJ, cliente: adn })
  assert.deepEqual(r, { novas: 2, eventos: 0, nsu: 3, completo: true })
  assert.deepEqual(adn.chamadas, [0]) // lote com menos de 50: não há mais nada
  let { data } = await supa.from('nfse_adn_notas').select('*')
  assert.deepEqual(data.map((n) => n.numero_nfse).sort(), ['1', '2'])
  assert.ok(data.every((n) => n.cliente_id === A && n.xml.includes('<NFSe')))

  // chega o cancelamento da nota 1; a próxima leitura começa do NSU 3
  docs.push(doc(4, 'EVENTO', evento(n1.chave, 101101)), doc(5, 'EVENTO', evento(n2.chave, 105102)))
  const r2 = await sincronizar({ db: supa, clienteId: A, cnpj: CNPJ, cliente: adn })
  assert.equal(r2.eventos, 2)
  assert.equal(adn.chamadas[1], 3)
  ;({ data } = await supa.from('nfse_adn_notas').select('*'))
  assert.equal(data.find((n) => n.numero_nfse === '1').situacao, 'cancelada')
  assert.equal(data.find((n) => n.numero_nfse === '2').situacao, 'substituida')
  const { data: controle } = await supa.from('nfse_adn_controle').select('*').eq('cliente_id', A).maybeSingle()
  assert.equal(controle.ultimo_nsu, 5)
})

test('erro do ADN fica registrado e o que já foi lido não se perde', async () => {
  const supa = criarSupabaseFalso({ tabelas: tabelas() })
  let primeira = true
  const adn = {
    lote: async (nsu) => {
      if (primeira) { primeira = false; return { status: 200, dados: { LoteDFe: Array.from({ length: 50 }, (_, i) => doc(i + 1, 'NFSE', nfse(i + 1).xml)) } } }
      return { status: 503, dados: { Erros: [{ Descricao: 'indisponível' }] } }
    },
  }
  await assert.rejects(sincronizar({ db: supa, clienteId: A, cnpj: CNPJ, cliente: adn }), /503: indisponível/)
  const { data: controle } = await supa.from('nfse_adn_controle').select('*').eq('cliente_id', A).maybeSingle()
  assert.equal(controle.ultimo_nsu, 50)
  assert.match(controle.ultimo_erro, /503/)
  const { data } = await supa.from('nfse_adn_notas').select('*')
  assert.equal(data.length, 50)
})

function montar({ docs = [], controle = [] } = {}) {
  const supa = criarSupabaseFalso({
    tabelas: {
      ...tabelas(),
      nfse_adn_controle: controle,
      nfse_empresas: [{ cliente_id: A, cnpj: CNPJ }, { cliente_id: B, cnpj: OUTRO }],
      clientes: [{ id: A, nome: 'Simple Care' }, { id: B, nome: 'Outra' }],
    },
  })
  const adn = adnFalso(docs)
  funcao._deps.supabase = supa
  funcao._deps.usuarioEscritorio = async (event) => (event.headers.authorization === 'Bearer escritorio' ? { id: 'u1' } : null)
  funcao._deps.clienteDoPainel = async (event) => ({ tokA: { id: A }, tokB: { id: B } }[event.headers['x-painel-token']] || null)
  funcao._deps.clienteAdn = async (_db, clienteId) => (clienteId === A ? adn : adnFalso([])) // cada empresa tem o seu ADN
  funcao._deps.agora = () => Date.parse('2026-10-27T12:00:00Z')
  const chamar = async (corpo, headers = {}) => {
    const r = await funcao.handler({ httpMethod: 'POST', headers: { host: 'gestor.test', ...headers }, body: JSON.stringify(corpo) })
    const tipo = r.headers['content-type']
    return { status: r.statusCode, tipo, headers: r.headers, corpo: tipo === 'application/json' ? JSON.parse(r.body) : Buffer.from(r.body, 'base64') }
  }
  return { chamar, adn, supa }
}

test('link do cliente: busca no ADN ao abrir, lista as notas dele e não chama de novo em 15 min', async () => {
  const { chamar, adn } = montar({ docs: [doc(1, 'NFSE', nfse(1, { competencia: '2026-09-10' }).xml), doc(2, 'NFSE', nfse(2).xml), doc(3, 'NFSE', nfse(3, { emitente: OUTRO }).xml)] })
  const r = await chamar({ acao: 'listar' }, { 'x-painel-token': 'tokA' })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.empresa, 'Simple Care')
  assert.equal(r.corpo.erro, null)
  assert.deepEqual(r.corpo.notas.map((n) => n.numero).sort(), ['1', '2'])
  assert.equal(r.corpo.notas.find((n) => n.numero === '1').competencia, '09/2026')
  assert.equal(adn.chamadas.length, 1)

  await chamar({ acao: 'listar' }, { 'x-painel-token': 'tokA' })
  assert.equal(adn.chamadas.length, 1) // leitura recente: não chama o ADN de novo

  const outro = await chamar({ acao: 'listar' }, { 'x-painel-token': 'tokB' })
  assert.equal(outro.status, 200)
  assert.equal(outro.corpo.notas.length, 0) // a nota do OUTRO CNPJ que veio no ADN da A não vira nota da B

  assert.equal((await chamar({ acao: 'listar' }, { 'x-painel-token': 'errado' })).status, 401)
})

test('PDF com QR Code, XML, marca de cancelada e link assinado; cliente não baixa nota de outro', async () => {
  const n1 = nfse(1)
  const { chamar, supa } = montar({ docs: [doc(1, 'NFSE', n1.xml), doc(2, 'EVENTO', evento(n1.chave, 101101))] })
  const lista = await chamar({ acao: 'listar' }, { 'x-painel-token': 'tokA' })
  const nota = lista.corpo.notas[0]
  assert.equal(nota.situacao, 'cancelada')

  const pdf = await chamar({ acao: 'pdf', nota_id: nota.id }, { 'x-painel-token': 'tokA' })
  assert.equal(pdf.status, 200)
  assert.equal(pdf.tipo, 'application/pdf')
  assert.equal(pdf.corpo.subarray(0, 5).toString(), '%PDF-')

  const xml = await chamar({ acao: 'xml', nota_id: nota.id }, { 'x-painel-token': 'tokA' })
  assert.ok(xml.corpo.toString().includes(n1.chave))

  assert.equal((await chamar({ acao: 'pdf', nota_id: nota.id }, { 'x-painel-token': 'tokB' })).status, 404)

  const link = await chamar({ acao: 'link', nota_id: nota.id }, { 'x-painel-token': 'tokA' })
  assert.match(link.corpo.url, /^https:\/\/gestor\.test\/\.netlify\/functions\/nfse-emitidas\?nota=/)
  const q = Object.fromEntries(new URL(link.corpo.url).searchParams)
  const aberto = await funcao.handler({ httpMethod: 'GET', queryStringParameters: q })
  assert.equal(aberto.statusCode, 200)
  assert.match(aberto.headers['content-disposition'], /^inline/)
  const adulterado = await funcao.handler({ httpMethod: 'GET', queryStringParameters: { ...q, exp: String(Number(q.exp) + 1) } })
  assert.equal(adulterado.statusCode, 403)
  void supa
})

test('escritório força a atualização; falha do ADN não derruba a lista', async () => {
  const { chamar } = montar({ controle: [{ cliente_id: A, ultimo_nsu: 0, sincronizado_em: '2026-10-27T11:59:00Z' }] })
  funcao._deps.clienteAdn = async () => ({ lote: async () => { throw new Error('ECONNRESET') } })
  const r = await chamar({ acao: 'listar', cliente_id: A, atualizar: true }, { authorization: 'Bearer escritorio' })
  assert.equal(r.status, 200)
  assert.match(r.corpo.erro, /Não foi possível buscar/)
  assert.deepEqual(r.corpo.notas, [])
})
