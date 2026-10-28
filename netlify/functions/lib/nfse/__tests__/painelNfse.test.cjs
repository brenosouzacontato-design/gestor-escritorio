// function painel-nfse.js: o cliente do painel só vê e baixa as próprias notas de produção; o
// escritório vê qualquer cliente e, se pedir, as de homologação.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// lib/autenticacao cria o cliente Supabase ao carregar; nos testes ele é substituído
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://supabase.invalido'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'chave-de-teste'

const funcao = require('../../../painel-nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfse_homologacao.xml'), 'utf8')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function nota(id, cliente, ambiente, competencia, extra = {}) {
  const xml = XML.replace('<tpAmb>2</tpAmb>', `<tpAmb>${ambiente === 'producao' ? 1 : 2}</tpAmb>`)
    .replace('<dCompet>2026-10-02</dCompet>', `<dCompet>${competencia}</dCompet>`)
  return {
    id, cliente_id: cliente, ambiente, estado: 'autorizada', numero_nfse: id.slice(-2), chave_acesso: `chave-${id}`,
    nome: 'Paciente de Teste', valor: 20, descricao: 'Consulta', data: competencia, competencia: null,
    criado_em: `${competencia}T12:00:00Z`, xml_retorno: xml, ...extra,
  }
}

function montar() {
  const supa = criarSupabaseFalso({
    tabelas: {
      nfse_notas: [
        nota('aaaaaaaa-0000-4000-8000-000000000001', A, 'producao', '2026-10-02'),
        nota('aaaaaaaa-0000-4000-8000-000000000002', A, 'producao', '2026-09-15'),
        nota('aaaaaaaa-0000-4000-8000-000000000003', A, 'homologacao', '2026-10-05'),
        nota('aaaaaaaa-0000-4000-8000-000000000004', A, 'producao', '2026-10-06', { estado: 'rejeitada', xml_retorno: null }),
        nota('bbbbbbbb-0000-4000-8000-000000000001', B, 'producao', '2026-10-02'),
      ],
    },
  })
  funcao._deps.supabase = supa
  funcao._deps.usuarioEscritorio = async (event) => (event.headers.authorization === 'Bearer escritorio' ? { id: 'u1' } : null)
  funcao._deps.clienteDoPainel = async (event) => ({ tokA: { id: A }, tokB: { id: B } }[event.headers['x-painel-token']] || null)
  return async (corpo, headers = {}) => {
    const r = await funcao.handler({ httpMethod: 'POST', headers, body: JSON.stringify(corpo) })
    const tipo = r.headers['content-type']
    return { status: r.statusCode, tipo, corpo: tipo === 'application/json' ? JSON.parse(r.body) : Buffer.from(r.body, 'base64') }
  }
}

test('cliente lista só as próprias notas autorizadas de produção, filtrando a competência', async () => {
  const chamar = montar()
  const r = await chamar({ acao: 'listar', competencia: '10/2026' }, { 'x-painel-token': 'tokA' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.corpo.notas.map((n) => n.id), ['aaaaaaaa-0000-4000-8000-000000000001'])
  assert.equal(r.corpo.notas[0].competencia, '10/2026')
  assert.equal(r.corpo.notas[0].emitidaEm, '2026-10-15T13:15:46-03:00')

  const todas = await chamar({ acao: 'listar' }, { 'x-painel-token': 'tokA' })
  assert.equal(todas.corpo.notas.length, 2) // sem homologação e sem a rejeitada
})

test('cliente não lista nem baixa nota de outro cliente, nem pedindo o cliente_id dele', async () => {
  const chamar = montar()
  const lista = await chamar({ acao: 'listar', cliente_id: B }, { 'x-painel-token': 'tokA' })
  assert.ok(lista.corpo.notas.every((n) => n.id.startsWith('aaaa')))
  const pdf = await chamar({ acao: 'pdf', nota_id: 'bbbbbbbb-0000-4000-8000-000000000001' }, { 'x-painel-token': 'tokA' })
  assert.equal(pdf.status, 404)
  const homolog = await chamar({ acao: 'pdf', nota_id: 'aaaaaaaa-0000-4000-8000-000000000003', incluir_homologacao: true }, { 'x-painel-token': 'tokA' })
  assert.equal(homolog.status, 404) // homologação não aparece pro cliente
})

test('cliente baixa o PDF e o XML da própria nota', async () => {
  const chamar = montar()
  const pdf = await chamar({ acao: 'pdf', nota_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { 'x-painel-token': 'tokA' })
  assert.equal(pdf.status, 200)
  assert.equal(pdf.tipo, 'application/pdf')
  assert.equal(pdf.corpo.subarray(0, 5).toString(), '%PDF-')
  const xml = await chamar({ acao: 'xml', nota_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { 'x-painel-token': 'tokA' })
  assert.equal(xml.tipo, 'application/xml')
  assert.match(xml.corpo.toString('utf8'), /<NFSe /)
})

test('escritório vê qualquer cliente e, quando pede, as de homologação', async () => {
  const chamar = montar()
  const semHomolog = await chamar({ acao: 'listar', cliente_id: A }, { authorization: 'Bearer escritorio' })
  assert.equal(semHomolog.corpo.notas.length, 2)
  const comHomolog = await chamar({ acao: 'listar', cliente_id: A, incluir_homologacao: true }, { authorization: 'Bearer escritorio' })
  assert.equal(comHomolog.corpo.notas.length, 3)
  const pdf = await chamar({ acao: 'pdf', cliente_id: A, nota_id: 'aaaaaaaa-0000-4000-8000-000000000003', incluir_homologacao: true }, { authorization: 'Bearer escritorio' })
  assert.equal(pdf.status, 200)
})

test('sem login nem token: 401', async () => {
  const chamar = montar()
  const r = await chamar({ acao: 'listar' })
  assert.equal(r.status, 401)
})

// --- notas pendentes: o cliente completa o que falta; link do PDF para mandar pelo WhatsApp ---

const CPF_FICTICIO = '52998224725' // CPF de exemplo (dígitos válidos), não é de ninguém

function montarComPendentes() {
  const chamar = montar()
  const supa = funcao._deps.supabase
  const pendente = (id, cliente, extra = {}) => ({
    id, cliente_id: cliente, lote_id: `lote-${cliente.slice(0, 1)}`, ambiente: 'producao', estado: 'importada',
    nome: 'Paciente Sem Cpf', cpf: null, data: '2026-09-10', valor: '150.00', descricao: 'consulta', endereco: '',
    status_validacao: 'pendente', pendencias: ['CPF'], erros: [], avisos: [], criado_em: '2026-09-10T12:00:00Z', ...extra,
  })
  return supa.from('nfse_empresas').insert([
    { cliente_id: A, ambiente: 'producao', campos_obrigatorios: ['nome', 'cpf', 'data', 'valor', 'descricao'] },
    { cliente_id: B, ambiente: 'producao', campos_obrigatorios: ['nome', 'cpf', 'data', 'valor', 'descricao'] },
  ]).then(() => supa.from('nfse_notas').insert([
    pendente('cccccccc-0000-4000-8000-000000000001', A),
    pendente('cccccccc-0000-4000-8000-000000000002', A, { ambiente: 'homologacao' }),
    pendente('dddddddd-0000-4000-8000-000000000001', B),
  ])).then(() => ({ chamar, supa }))
}

test('cliente vê as próprias notas pendentes de produção, com o que falta', async () => {
  const { chamar } = await montarComPendentes()
  const r = await chamar({ acao: 'pendentes' }, { 'x-painel-token': 'tokA' })
  assert.equal(r.status, 200)
  assert.deepEqual(r.corpo.notas.map((n) => n.id), ['cccccccc-0000-4000-8000-000000000001'])
  assert.deepEqual(r.corpo.notas[0].pendencias, ['CPF'])
  assert.equal(r.corpo.notas[0].pronta, false)
})

test('cliente completa o CPF: a nota fica pronta e o paciente entra no cadastro', async () => {
  const { chamar, supa } = await montarComPendentes()
  const r = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', cpf: '529.982.247-25' }, { 'x-painel-token': 'tokA' })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.nota.cpf, CPF_FICTICIO)
  assert.equal(r.corpo.nota.pronta, true)
  const { data: nota } = await supa.from('nfse_notas').select('*').eq('id', 'cccccccc-0000-4000-8000-000000000001').maybeSingle()
  assert.equal(nota.estado, 'validada')
  const { data: cadastro } = await supa.from('nfse_tomadores').select('*').eq('cliente_id', A)
  assert.deepEqual(cadastro.map((t) => [t.cpf, t.nome]), [[CPF_FICTICIO, 'Paciente Sem Cpf']])
})

test('CPF com dígito errado é recusado; nota de outro cliente ou já emitida não muda', async () => {
  const { chamar } = await montarComPendentes()
  const errado = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', cpf: '52998224700' }, { 'x-painel-token': 'tokA' })
  assert.equal(errado.status, 400)
  const outro = await chamar({ acao: 'completar', nota_id: 'dddddddd-0000-4000-8000-000000000001', cpf: CPF_FICTICIO }, { 'x-painel-token': 'tokA' })
  assert.equal(outro.status, 404)
  const emitida = await chamar({ acao: 'completar', nota_id: 'aaaaaaaa-0000-4000-8000-000000000001', nome: 'Outro' }, { 'x-painel-token': 'tokA' })
  assert.equal(emitida.status, 404)
})

test('link assinado abre o PDF sem login; adulterado ou vencido, não', async () => {
  const { chamar } = await montarComPendentes()
  const r = await chamar({ acao: 'link', nota_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { 'x-painel-token': 'tokA', host: 'gestor.exemplo' })
  assert.equal(r.status, 200)
  const url = new URL(r.corpo.url)
  assert.equal(url.host, 'gestor.exemplo')
  const abrir = (q) => funcao.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: q })
  const q = Object.fromEntries(url.searchParams)
  const ok = await abrir(q)
  assert.equal(ok.statusCode, 200)
  assert.equal(Buffer.from(ok.body, 'base64').subarray(0, 5).toString(), '%PDF-')
  assert.equal((await abrir({ ...q, nota: 'aaaaaaaa-0000-4000-8000-000000000002' })).statusCode, 403)
  assert.equal((await abrir({ ...q, exp: String(Number(q.exp) + 1) })).statusCode, 403)

  const vencido = new URL(funcao._linkAssinado({ headers: {} }, q.nota, Date.now() - 31 * 86400 * 1000), 'https://x')
  assert.equal((await abrir(Object.fromEntries(vencido.searchParams))).statusCode, 410)

  const alheia = await chamar({ acao: 'link', nota_id: 'bbbbbbbb-0000-4000-8000-000000000001' }, { 'x-painel-token': 'tokA' })
  assert.equal(alheia.status, 404)
})

test('cliente completa data e endereço; nota complementar é confirmada pela diferença', async () => {
  const { chamar, supa } = await montarComPendentes()
  const r = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', cpf: CPF_FICTICIO, data: '05/09/2026', endereco: 'Rua das Flores 10' }, { 'x-painel-token': 'tokA' })
  assert.equal(r.status, 200)
  assert.equal(r.corpo.nota.data, '2026-09-05')
  assert.equal(r.corpo.nota.endereco, 'Rua das Flores 10')
  assert.equal(r.corpo.nota.situacao, 'pronta')
  const ruim = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', data: '31/02/2026' }, { 'x-painel-token': 'tokA' })
  assert.equal(ruim.status, 400)

  // observação livre do cliente: salva sozinha, sem mexer nos outros campos
  const obs = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', observacao: '  Paciente pediu nota em nome da mãe  ' }, { 'x-painel-token': 'tokA' })
  assert.equal(obs.status, 200)
  assert.equal(obs.corpo.nota.observacao, 'Paciente pediu nota em nome da mãe')
  assert.equal(obs.corpo.nota.endereco, 'Rua das Flores 10')
  const lista = await chamar({ acao: 'pendentes' }, { 'x-painel-token': 'tokA' })
  assert.equal(lista.corpo.notas.find((n) => n.id === 'cccccccc-0000-4000-8000-000000000001').observacao, 'Paciente pediu nota em nome da mãe')

  // NFS-e de R$ 2.500 emitida fora do gestor; a lista pede R$ 3.500 para o mesmo paciente
  await supa.from('nfse_adn_notas').insert([{ cliente_id: A, chave_acesso: 'K1', numero_nfse: '12', tomador_doc: '11144477735', valor: 2500,
    emitida_em: '2026-05-30T10:00:00-03:00', ambiente: 'producao', situacao: 'autorizada' }])
  await supa.from('nfse_notas').insert([{ id: 'cccccccc-0000-4000-8000-000000000009', cliente_id: A, lote_id: 'lote-1', ambiente: 'producao', estado: 'importada',
    nome: 'Paciente Implante', cpf: '11144477735', data: '2026-04-01', valor: '3500.00', descricao: 'Implante', endereco: '',
    status_validacao: 'pendente', pendencias: [], erros: [], avisos: [], criado_em: '2026-09-11T12:00:00Z' }])
  const antes = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000009', descricao: 'Implante' }, { 'x-painel-token': 'tokA' })
  assert.equal(antes.corpo.nota.situacao, 'complementar')
  const conf = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000009', complementar: true }, { 'x-painel-token': 'tokA' })
  assert.equal(conf.status, 200)
  assert.equal(Number(conf.corpo.nota.valor), 1000)
  assert.equal(conf.corpo.nota.descricao, 'Complementar - Implante')
  assert.equal(conf.corpo.nota.situacao, 'pronta')
  const deNovo = await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000009', complementar: true }, { 'x-painel-token': 'tokA' })
  assert.equal(deNovo.status, 400) // já é a complementar: nada a confirmar
})

test('não é complementar: sai pelo valor cheio; já emitida: cliente fica ciente e ela sai do painel', async () => {
  const { chamar, supa } = await montarComPendentes()
  const tok = { 'x-painel-token': 'tokA' }
  await supa.from('nfse_adn_notas').insert([{ cliente_id: A, chave_acesso: 'K1', numero_nfse: '12', tomador_doc: '11144477735', valor: 2500,
    emitida_em: '2026-05-30T10:00:00-03:00', ambiente: 'producao', situacao: 'autorizada' }])
  const nota = (id, valor) => ({ id, cliente_id: A, lote_id: 'lote-1', ambiente: 'producao', estado: 'importada',
    nome: 'Paciente Implante', cpf: '11144477735', data: '2026-04-01', valor, descricao: 'Implante', endereco: 'Rua A 1',
    status_validacao: 'pendente', pendencias: [], erros: [], avisos: [], criado_em: '2026-09-11T12:00:00Z' })
  const COMP = 'cccccccc-0000-4000-8000-000000000009'
  const IGUAL = 'cccccccc-0000-4000-8000-000000000010'
  await supa.from('nfse_notas').insert([nota(COMP, '3500.00')])
  assert.equal((await chamar({ acao: 'completar', nota_id: COMP, descricao: 'Implante' }, tok)).corpo.nota.situacao, 'complementar')

  // ciência só vale para nota travada como já emitida/complementar
  assert.equal((await chamar({ acao: 'completar', nota_id: 'cccccccc-0000-4000-8000-000000000001', ciente: true }, tok)).status, 400)

  const cheio = await chamar({ acao: 'completar', nota_id: COMP, valor_cheio: true }, tok)
  assert.equal(cheio.status, 200)
  assert.equal(Number(cheio.corpo.nota.valor), 3500)
  assert.equal(cheio.corpo.nota.liberada, true)
  assert.notEqual(cheio.corpo.nota.situacao, 'complementar')

  await supa.from('nfse_notas').insert([nota(IGUAL, '2500.00')])
  assert.equal((await chamar({ acao: 'completar', nota_id: IGUAL, descricao: 'Implante' }, tok)).corpo.nota.situacao, 'ja_emitida')
  const ciente = await chamar({ acao: 'completar', nota_id: IGUAL, ciente: true }, tok)
  assert.equal(ciente.status, 200)
  assert.equal(ciente.corpo.nota.ciente, true)
  const lista = await chamar({ acao: 'pendentes' }, tok)
  assert.equal(lista.corpo.notas.some((n) => n.id === IGUAL), false)
  assert.equal(lista.corpo.notas.some((n) => n.id === COMP), true)
})
