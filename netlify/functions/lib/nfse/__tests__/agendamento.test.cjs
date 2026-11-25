// Emissão agendada de NFS-e (lib/nfse/agendamentos.js): agendar pelo gestor a partir de um modelo
// recorrente, o robô emite na hora com as mesmas regras da tela, cancelar, travas; e o comando
// "agendar nfse ..." do grupo do WhatsApp (lib/nfseWhatsapp.js). CNPJs fictícios.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

process.env.NFSE_CERT_KEY = process.env.NFSE_CERT_KEY || crypto.randomBytes(32).toString('base64')
delete process.env.NFSE_EMAILS_PERMITIDOS

const funcao = require('../../../nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')
const { criarCliente, comprimir } = require('../sefin')
const { hojeBrasilia } = require('../validador')
const { segundaDa, somarDias } = require('../recorrentes')
const ag = require('../agendamentos')
const nfseWpp = require('../../nfseWhatsapp')
const nfseMeiLib = require('../mei')

const G = path.join(__dirname, 'golden')
const CLIENTE = '11111111-1111-4111-8111-111111111111'

function cnpj(base) {
  let c = String(base)
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const resto = c.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11
    c += resto < 2 ? 0 : 11 - resto
  }
  return c
}
const MARKET = cnpj('112223330001')

// 'AAAA-MM-DDTHH:mm' em Brasília, daqui a n minutos
const emBrasilia = (min) => new Date(Date.now() + min * 60000 - 3 * 3600000).toISOString().slice(0, 16)

test('quando: hora de Brasília, ISO com fuso, inválidos', () => {
  assert.equal(ag.quando('2026-11-30T14:00').toISOString(), '2026-11-30T17:00:00.000Z')
  assert.equal(ag.quando('2026-11-30T14:00:00Z').toISOString(), '2026-11-30T14:00:00.000Z')
  assert.equal(ag.quando('30/11/2026 14:00'), null)
  assert.equal(ag.quando(''), null)
  assert.equal(ag.quandoBR('2026-11-30T17:00:00.000Z'), '30/11/2026 às 14:00')
  assert.deepEqual(['1.234,56', '150', 99.9, '0', 'abc'].map(ag.lerValor), [1234.56, 150, 99.9, null, null])
})

test('validarAgendamento: horário, valor, data do serviço, período do modelo', () => {
  const modelo = { id: 'm', cliente_id: 'c', periodicidade: 'semanal', inicio: '2026-11-02', ativo: true }
  const agora = new Date('2026-11-25T13:00:00Z') // 10h em Brasília, quarta
  const v = (p) => ag.validarAgendamento(p, { modelo, ambiente: 'homologacao', agora })
  assert.match(v({ valor: '10' }).erro, /dia e a hora/)
  assert.match(v({ executar_em: '2026-11-25T09:00', valor: '10' }).erro, /já passou/)
  assert.match(v({ executar_em: '2026-11-25T11:00', valor: '' }).erro, /valor/)
  assert.match(v({ executar_em: '2026-11-25T11:00', valor: '10', data_servico: '2026-11-26' }).erro, /depois do dia/)
  assert.match(v({ executar_em: '2026-11-25T11:00', valor: '10', data_servico: '2026-10-30' }).erro, /avulsa/)
  assert.ok(v({ executar_em: '2026-11-25T11:00', valor: '10', data_servico: '2026-10-30', tipo: 'avulsa' }).campos)
  const { campos } = v({ executar_em: '2026-11-30T14:00', valor: '1.250,00' })
  // sem data do serviço: o dia da emissão (segunda 30/11 → semana 30/11 a 06/12)
  assert.deepEqual([campos.data_servico, campos.periodo, campos.valor, campos.executar_em, campos.tipo, campos.enviar_whatsapp],
    ['2026-11-30', '2026-11-30', 1250, '2026-11-30T17:00:00.000Z', 'periodo', true])
})

test('WhatsApp: "agendar nfse ..." lê dia, hora e o resto do pedido', () => {
  const agora = { dia: '2026-11-25', hora: '10:00' }
  const q = (t) => nfseWpp.extrairQuando(nfseWpp.lerComandoAgendar(t).resto, agora)
  assert.equal(nfseWpp.lerComandoAgendar('nfse Shopee 10'), null)
  assert.equal(nfseWpp.lerComandoAgendar('agendamento da reunião'), null)
  assert.deepEqual(q('agendar nfse Simple Care Shopee 1.250,00 30/11 14:00'), { dia: '2026-11-30', hora: '14:00', horaPadrao: false, resto: 'Simple Care Shopee 1.250,00' })
  assert.deepEqual(q('agendar nota Shopee 500 14h30'), { dia: '2026-11-25', hora: '14:30', horaPadrao: false, resto: 'Shopee 500' })
  // hora que já passou hoje, sem data: amanhã
  assert.equal(q('agendar nfse Shopee 500 às 9').dia, '2026-11-26')
  // sem hora: 9h; dia que já passou no ano: o ano que vem
  assert.deepEqual(q('agendar: Shopee 500 02/01'), { dia: '2027-01-02', hora: '09:00', horaPadrao: true, resto: 'Shopee 500' })
  assert.match(q('agendar nfse Shopee 500 25/11 09:00').erro, /já passou/)
  assert.match(q('agendar nfse Shopee 500 30/11 25:00').erro, /Hora inválida/)
  const p = nfseWpp.previaAgendamento({ empresa_nome: 'Lanchonete', nome: 'Market', cpf: MARKET, valor: '1250.00', data: '2026-11-30',
    ambiente: 'producao', semana: '2026-11-30', semana_fim: '2026-12-06', agendar: { dia: '2026-11-30', hora: '14:00' } })
  assert.match(p, /Agendar NFS-e\?/)
  assert.match(p, /30\/11\/2026 às 14:00/)
  assert.match(p, /\*sim\*/)
})

function montar() {
  const supa = criarSupabaseFalso({
    usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Lanchonete Teste', cnpj: '47.619.250/0001-78' }] },
  })
  const enviados = []
  let numero = 40
  funcao._deps.supabase = () => supa
  funcao._deps.criarCliente = ({ ambiente }) => criarCliente({
    tls: null, ambiente, transporte: async (metodo, caminho, corpo) => {
      if (metodo !== 'POST') return { status: 404, dados: { erro: { codigo: 'E2404' } }, texto: '' }
      enviados.push(corpo)
      numero += 1
      const chave = `3154606224761925000017800000000000${String(numero).padStart(16, '0')}`
      return { status: 201, dados: { chaveAcesso: chave, nfseXmlGZipB64: comprimir(`<NFSe><infNFSe><nNFSe>${numero}</nNFSe></infNFSe></NFSe>`) }, texto: '' }
    },
  })
  const chamar = async (corpo) => {
    const r = await funcao.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ cliente_id: CLIENTE, ...corpo }) })
    return { status: r.statusCode, ...JSON.parse(r.body) }
  }
  return { supa, chamar, enviados }
}

globalThis.fetch = async () => ({ ok: false, json: async () => ({}) })

test('function: agenda pelo gestor, o robô emite na hora, cancela e não repete', async () => {
  const { supa, chamar, enviados } = montar()
  const gabarito = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
  const simples = { regApIBSCBSSN: '1', cAtvSN: '7', cNBS: '123012300', cIndOp: '030101', CST: '200', cClassTrib: '200028' }
  assert.equal((await chamar({ acao: 'salvar_empresa', gabarito_xml: gabarito, servico_padrao: simples })).status, 200)
  const pfx = fs.readFileSync(path.join(G, 'teste.pfx')).toString('base64')
  assert.equal((await chamar({ acao: 'salvar_certificado', pfx_base64: pfx, senha: 'teste' })).status, 200)
  const hoje = hojeBrasilia()
  const semanaPassada = somarDias(segundaDa(hoje), -7)
  const salvo = await chamar({ acao: 'recorrente_salvar', recorrente: {
    nome: 'Market Ltda', cpf: MARKET, endereco: 'Av. Teste, 100 - Centro', cep: '30000-000', descricao: 'Coleta de {inicio} a {fim}', inicio: semanaPassada } })
  assert.equal(salvo.status, 200)
  const id = salvo.id

  // travas na hora de agendar: ambiente, horário passado, valor
  const base = { acao: 'agendamento_criar', recorrente_id: id, ambiente: 'homologacao', valor: '300,00' }
  assert.equal((await chamar({ ...base, ambiente: 'producao', executar_em: emBrasilia(10) })).status, 409)
  assert.equal((await chamar({ ...base, executar_em: emBrasilia(-30) })).status, 400)
  assert.equal((await chamar({ ...base, valor: '', executar_em: emBrasilia(10) })).status, 400)

  // semana passada, para daqui a 10 minutos; a mesma semana não pode ter dois agendamentos
  const a1 = await chamar({ ...base, executar_em: emBrasilia(10), data_servico: somarDias(semanaPassada, 2) })
  assert.equal(a1.status, 200, JSON.stringify(a1))
  const dup = await chamar({ ...base, executar_em: emBrasilia(20), data_servico: semanaPassada })
  assert.equal(dup.status, 400)
  assert.match(dup.erro, /já tem emissão agendada/)

  // a semana aparece com o agendamento; a lista do modelo também
  let lista = await chamar({ acao: 'recorrentes_listar' })
  const [m] = lista.recorrentes
  assert.equal(m.semanas[0].agendamento.id, a1.id)
  assert.deepEqual(m.agendamentos.map((x) => x.situacao), ['agendada'])
  const hojeTela = await chamar({ acao: 'recorrentes_hoje' })
  assert.equal(hojeTela.semanas.find((s) => s.inicio === semanaPassada).agendamento.id, a1.id)

  // antes da hora, o robô não faz nada
  assert.deepEqual(await funcao.executarAgendamentos({}), { executados: 0, emitidos: 0, erros: 0, travados: 0 })
  assert.equal(enviados.length, 0)

  // chegou a hora: emite a nota da semana com o valor agendado e avisa quem agendou
  supa.db.nfse_agendamentos.find((x) => x.id === a1.id).executar_em = new Date(Date.now() - 60000).toISOString()
  supa.db.nfse_agendamentos.find((x) => x.id === a1.id).avisar_jid = 'grupo@g.us'
  const avisos = []
  const r = await funcao.executarAgendamentos({ avisar: async (a, fim) => avisos.push([a.avisar_jid, fim.situacao]) })
  assert.deepEqual(r, { executados: 1, emitidos: 1, erros: 0, travados: 0 })
  assert.equal(enviados.length, 1)
  const feito = supa.db.nfse_agendamentos.find((x) => x.id === a1.id)
  assert.equal(feito.situacao, 'emitida')
  assert.match(feito.mensagem, /NFS-e nº \d+ emitida/)
  assert.equal(feito.envio, undefined) // homologação: não vai no WhatsApp
  const nota = supa.db.nfse_notas.find((n) => n.id === feito.nota_id)
  assert.deepEqual([nota.estado, Number(nota.valor)], ['autorizada', 300])
  assert.equal(nota.data, somarDias(semanaPassada, 2))
  assert.deepEqual(avisos, [['grupo@g.us', 'emitida']])
  // de novo: nada (cada agendamento sai uma vez)
  assert.equal((await funcao.executarAgendamentos({})).executados, 0)

  lista = await chamar({ acao: 'recorrentes_listar' })
  assert.equal(lista.recorrentes[0].semanas[0].situacao, 'emitida')
  // a semana já tem nota: agendar de novo como nota do período é recusado; avulsa pode
  const ja = await chamar({ ...base, executar_em: emBrasilia(10), data_servico: semanaPassada })
  assert.equal(ja.status, 400)
  assert.match(ja.erro, /já tem nota emitida/)

  // cancelar: só enquanto está agendada
  const a2 = await chamar({ ...base, executar_em: emBrasilia(30), data_servico: hoje })
  assert.equal(a2.status, 200)
  assert.equal((await chamar({ acao: 'agendamento_cancelar', id: a2.id })).status, 200)
  assert.equal((await chamar({ acao: 'agendamento_cancelar', id: a2.id })).status, 409)
  assert.equal((await chamar({ acao: 'agendamento_cancelar', id: a1.id })).status, 409)

  // avulsa na semana que já tem nota: sai e não muda a semana
  const a3 = await chamar({ ...base, tipo: 'avulsa', valor: '75', executar_em: emBrasilia(5), data_servico: somarDias(semanaPassada, 3) })
  assert.equal(a3.status, 200, JSON.stringify(a3))
  supa.db.nfse_agendamentos.find((x) => x.id === a3.id).executar_em = new Date(Date.now() - 1000).toISOString()
  assert.equal((await funcao.executarAgendamentos({})).emitidos, 1)
  assert.equal(enviados.length, 2)

  // agendamento cuja semana ganhou nota depois (emitida pela tela): não sai outra, fica com o erro
  supa.db.nfse_agendamentos.push({ ...supa.db.nfse_agendamentos.find((x) => x.id === a1.id), id: 'aaaaaaaa-0000-4000-8000-000000000001',
    situacao: 'agendada', nota_id: null, mensagem: null, executar_em: new Date(Date.now() - 1000).toISOString(), avisar_jid: null })
  const r2 = await funcao.executarAgendamentos({})
  assert.deepEqual([r2.executados, r2.erros], [1, 1])
  assert.match(supa.db.nfse_agendamentos.find((x) => x.id === 'aaaaaaaa-0000-4000-8000-000000000001').mensagem, /já tem nota/)
  assert.equal(enviados.length, 2)

  // execução que caiu no meio ("processando" há muito tempo): vira erro, não tenta de novo sozinha
  supa.db.nfse_agendamentos.push({ id: 'aaaaaaaa-0000-4000-8000-000000000002', cliente_id: CLIENTE, recorrente_id: id, situacao: 'processando',
    executado_em: new Date(Date.now() - ag.TRAVADO_MS - 1000).toISOString(), executar_em: new Date(Date.now() - ag.TRAVADO_MS).toISOString() })
  assert.equal((await funcao.executarAgendamentos({})).travados, 1)
  assert.equal(supa.db.nfse_agendamentos.find((x) => x.id === 'aaaaaaaa-0000-4000-8000-000000000002').situacao, 'erro')

  const todos = await chamar({ acao: 'agendamentos_listar' })
  assert.equal(todos.status, 200)
  assert.ok(todos.agendamentos.length >= 4)
})

test('function: banco sem a tabela de agendamentos avisa e não quebra a lista de recorrentes', async () => {
  const { supa, chamar } = montar()
  const gabarito = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
  assert.equal((await chamar({ acao: 'salvar_empresa', gabarito_xml: gabarito })).status, 200)
  delete supa.db.nfse_agendamentos
  const original = supa.from
  supa.from = (t) => {
    if (t !== 'nfse_agendamentos') return original(t)
    const erro = { data: null, error: { code: '42P01', message: 'relation "nfse_agendamentos" does not exist' } }
    const q = new Proxy({}, { get: (_, k) => (k === 'then' ? (ok) => Promise.resolve(erro).then(ok) : () => q) })
    return q
  }
  const lista = await chamar({ acao: 'recorrentes_listar' })
  assert.equal(lista.status, 200)
  assert.match(lista.aviso_agendamento, /supabase-schema-nfse-agendamentos\.sql/)
  assert.equal((await chamar({ acao: 'recorrentes_hoje' })).status, 200)
})

test('MEI: agenda um modelo MEI, na hora a nota entra na fila do robô e não repete', async () => {
  const MEI = '22222222-2222-4222-8222-222222222222'
  const MODELO = '33333333-3333-4333-8333-333333333333'
  const modelo = { id: MODELO, cliente_id: MEI, ativo: true, tomador_nome: 'Carlos Dias', tomador_doc: '52998224725',
    codigo_tributacao: '010701', municipio_prestacao: '', descricao: 'Serviços de {mes}', valor: 300 }
  const db = criarSupabaseFalso({ tabelas: { nfse_mei_acessos: [], nfse_mei_modelos: [modelo], nfse_mei_notas: [] } })
  const agora = new Date('2026-11-25T13:00:00Z') // 10h em Brasília
  const p = { executar_em: '2026-11-30T14:00', valor: '350,00' }

  await assert.rejects(ag.criarAgendamentoMei(db, { modelo, p, agora }), /senha do Emissor Nacional/)
  await db.from('nfse_mei_acessos').insert({ cliente_id: MEI })
  await assert.rejects(ag.criarAgendamentoMei(db, { modelo, p: { ...p, data_servico: '2026-12-01' }, agora }), /competência não pode ser depois/)
  await assert.rejects(ag.criarAgendamentoMei(db, { modelo, p: { ...p, executar_em: '2026-11-25T09:00' }, agora }), /já passou/)

  const previa = await ag.criarAgendamentoMei(db, { modelo, p, agora, gravar: false })
  assert.deepEqual([previa.tipo, previa.mei_modelo_id, previa.recorrente_id, previa.data_servico, previa.periodo, previa.valor, previa.ambiente],
    ['mei', MODELO, null, '2026-11-30', '2026-11-01', 350, 'producao'])
  const criado = await ag.criarAgendamentoMei(db, { modelo, p, agora, criadoPor: 'WhatsApp (Breno)', avisarJid: 'g@g.us' })
  assert.ok(criado.id)
  await assert.rejects(ag.criarAgendamentoMei(db, { modelo, p: { ...p, executar_em: '2026-11-30T15:00' }, agora }), /já tem nota agendada para 11\/2026/)

  // na hora: entra na fila do robô MEI (sem passar pela Sefin)
  const { data: lista } = await db.from('nfse_agendamentos').select('*')
  // (o robô roda hoje: a competência vira hoje para o teste valer em qualquer dia)
  const hoje = hojeBrasilia()
  await db.from('nfse_agendamentos').update({ executar_em: new Date(Date.now() - 60000).toISOString(), data_servico: hoje }).eq('id', criado.id)
  const avisos = []
  const r = await ag.executarPendentes({ db, emitir: () => { throw new Error('não devia emitir pela Sefin') }, avisar: async (a, fim) => avisos.push(fim) })
  assert.equal(lista.length, 1)
  assert.deepEqual([r.executados, r.emitidos, r.erros, avisos[0].mensagem], [1, 1, 0, avisos[0].mensagem])
  assert.equal(avisos[0].situacao, 'emitida', avisos[0].mensagem)
  const { data: notas } = await db.from('nfse_mei_notas').select('*')
  assert.equal(notas.length, 1)
  assert.deepEqual([notas[0].status, notas[0].valor, notas[0].competencia, notas[0].modelo_id, notas[0].descricao],
    ['na_fila', 350, hoje, MODELO, nfseMeiLib.descricaoDoMes('Serviços de {mes}', hoje)])
  const { data: [feito] } = await db.from('nfse_agendamentos').select('*').eq('id', criado.id)
  assert.deepEqual([feito.situacao, feito.mei_nota_id], ['emitida', notas[0].id])
  assert.match(avisos[0].mensagem, /fila do robô/)

  // a mesma nota no mesmo mês já está na fila: um novo agendamento é recusado
  await assert.rejects(ag.criarAgendamentoMei(db, { modelo, p: { executar_em: emBrasilia(60), valor: '350', data_servico: hoje } }), /Já existe nota MEI igual/)
  assert.equal(ag.resumo(feito).mei_nota_id, notas[0].id)
})

test('WhatsApp: prévia do agendamento MEI', () => {
  const t = nfseWpp.previaAgendamento({ tipo: 'mei', empresa_nome: 'Ana MEI', nome: 'Carlos Dias', cpf: '52998224725', valor: 350,
    data: '2026-11-30', descricao: 'Serviços de novembro de 2026', agendar: { dia: '2026-11-30', hora: '14:00' } })
  assert.match(t, /Agendar NFS-e MEI\?/)
  assert.match(t, /30\/11\/2026 às 14:00/)
  assert.match(t, /Competência 30\/11\/2026/)
  assert.match(t, /robô MEI/)
  assert.doesNotMatch(t, /Homologação/)
})
