// Notas recorrentes semanais (ex.: ponto de coleta que emite toda semana para a Shopee): tomador com
// CNPJ, semanas de segunda a domingo, o valor digitado na hora e a nota emitida em seguida.
// CNPJs fictícios.

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
const { cnpjValido, validar, hojeBrasilia } = require('../validador')
const { semanasFechadas, segundaDa, somarDias, descricaoDa } = require('../recorrentes')
const { montarDps, carregarGabarito } = require('../dps')
const { serializar } = require('../xml')

const G = path.join(__dirname, 'golden')
const CLIENTE = '11111111-1111-4111-8111-111111111111'

// CNPJ válido a partir de 12 dígitos
function cnpj(base) {
  let c = String(base)
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const resto = c.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11
    c += resto < 2 ? 0 : 11 - resto
  }
  return c
}
const MARKET = cnpj('112223330001')
const MARKET_ERRADO = MARKET.slice(0, 13) + ((Number(MARKET[13]) + 1) % 10)

test('CNPJ do tomador: validação e tag CNPJ na DPS', () => {
  assert.ok(cnpjValido(MARKET))
  assert.ok(!cnpjValido(MARKET_ERRADO))
  assert.ok(!cnpjValido('11111111111111'))
  const base = { nome: 'Market Ltda', data: '2026-10-04', valor: '10.00', descricao: 'x', camposObrigatorios: ['nome', 'cpf'], hoje: '2026-11-03' }
  assert.equal(validar({ ...base, cpf: MARKET }).status, 'pronto')
  assert.deepEqual(validar({ ...base, cpf: MARKET_ERRADO }).erros, ['CNPJ com dígito verificador errado'])

  const gabarito = carregarGabarito(fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8'))
  const empresa = { cnpj: '47619250000178', codigoMunicipio: '3154606', regraCompetencia: 'mes_do_atendimento', servicoPadrao: {} }
  const dps = montarDps({ gabarito, empresa, ambiente: 'homologacao', serie: '900', nDps: 1, cpfTomador: MARKET, nomeTomador: 'Market Ltda',
    descricao: 'Coleta', valor: '10.00', dataAtendimento: '2026-09-04', agora: new Date('2026-09-10T12:00:00Z') })
  assert.match(serializar(dps), new RegExp(`<toma><CNPJ>${MARKET}</CNPJ><xNome>Market Ltda</xNome></toma>`))
})

test('semanas: segunda a domingo, só as encerradas, desde o início', () => {
  // terça 03/11/2026 → última semana fechada: 26/10 a 01/11
  assert.deepEqual(semanasFechadas('2026-10-14', '2026-11-03'), [
    { inicio: '2026-10-12', fim: '2026-10-18' }, { inicio: '2026-10-19', fim: '2026-10-25' }, { inicio: '2026-10-26', fim: '2026-11-01' }])
  // na segunda, a semana que acabou ontem já entra; a corrente não
  assert.equal(semanasFechadas('2026-10-26', '2026-11-02').length, 1)
  assert.equal(semanasFechadas('2026-11-02', '2026-11-08').length, 0)
  assert.equal(descricaoDa({ descricao: 'Coleta de {inicio} a {fim}' }, { inicio: '2026-10-26', fim: '2026-11-01' }), 'Coleta de 26/10/2026 a 01/11/2026')
})

function montar() {
  const supa = criarSupabaseFalso({
    usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Lanchonete Teste', cnpj: '47.619.250/0001-78' }] },
  })
  const enviados = []
  let numero = 20
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

test('function: modelo semanal com CNPJ, emite a semana com o valor digitado, pula semana, não repete', async () => {
  const { supa, chamar, enviados } = montar()
  const gabarito = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
  const simples = { regApIBSCBSSN: '1', cAtvSN: '7', cNBS: '123012300', cIndOp: '030101', CST: '200', cClassTrib: '200028' }
  assert.equal((await chamar({ acao: 'salvar_empresa', gabarito_xml: gabarito, servico_padrao: simples })).status, 200)
  const pfx = fs.readFileSync(path.join(G, 'teste.pfx')).toString('base64')
  assert.equal((await chamar({ acao: 'salvar_certificado', pfx_base64: pfx, senha: 'teste' })).status, 200)

  // validação do modelo
  assert.equal((await chamar({ acao: 'recorrente_salvar', recorrente: { nome: 'Market', cpf: MARKET_ERRADO } })).status, 400)
  assert.equal((await chamar({ acao: 'recorrente_salvar', recorrente: { cpf: MARKET } })).status, 400)

  const hoje = hojeBrasilia()
  const tresSemanas = somarDias(segundaDa(hoje), -21)
  const s = await chamar({ acao: 'recorrente_salvar', recorrente: {
    nome: 'Market Ltda', cpf: MARKET, endereco: 'Av. Teste, 100 - Centro', cep: '30000-000', descricao: 'Ponto de coleta de {inicio} a {fim}', inicio: somarDias(tresSemanas, 2) } })
  assert.equal(s.status, 200)
  assert.equal(supa.db.nfse_recorrentes[0].inicio, tresSemanas) // ajusta para a segunda-feira

  let lista = await chamar({ acao: 'recorrentes_listar' })
  assert.equal(lista.status, 200)
  const [modelo] = lista.recorrentes
  assert.deepEqual(modelo.semanas.map((x) => x.situacao), ['a_emitir', 'a_emitir', 'a_emitir', 'a_emitir'])
  const [s1, s2, s3, s4] = modelo.semanas
  // a semana em andamento já aparece, com a data de hoje
  assert.deepEqual([s4.inicio, s4.emAndamento, s4.data, s1.emAndamento, s1.data], [segundaDa(hoje), true, hoje, false, s1.fim])

  // ambiente divergente, sem valor, semana futura ou data fora da semana / no futuro: nada sai
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s1.inicio, valor: '100,00', ambiente: 'producao' })).status, 409)
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s1.inicio, valor: '', ambiente: 'homologacao' })).status, 400)
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: somarDias(segundaDa(hoje), 7), valor: '10', ambiente: 'homologacao' })).status, 400)
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s1.inicio, valor: '10', data: s2.inicio, ambiente: 'homologacao' })).status, 400)
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s4.inicio, valor: '10', data: somarDias(hoje, 1), ambiente: 'homologacao' })).status, 400)
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s4.inicio, valor: '10', cpf: MARKET_ERRADO, ambiente: 'homologacao' })).status, 400)
  assert.equal(enviados.length, 0)

  const e1 = await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s1.inicio, valor: '1.234,56', ambiente: 'homologacao' })
  assert.equal(e1.status, 200, JSON.stringify(e1))
  assert.equal(e1.resultado.estado, 'autorizada')
  assert.equal(e1.nota.cpf, MARKET)
  assert.equal(e1.nota.data, s1.fim)
  assert.equal(Number(e1.nota.valor), 1234.56)
  assert.equal(e1.nota.descricao, `Ponto de coleta de ${s1.inicio.split('-').reverse().join('/')} a ${s1.fim.split('-').reverse().join('/')}`)
  assert.equal(e1.nota.recorrente_id, modelo.id)
  assert.equal(supa.db.nfse_lotes.find((l) => l.id === e1.nota.lote_id).origem, 'recorrente')
  assert.match(e1.nota.xml_enviado, new RegExp(`<CNPJ>${MARKET}</CNPJ>`))

  // a mesma semana não sai de novo
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s1.inicio, valor: '50', ambiente: 'homologacao' })).status, 409)

  // mesmo valor em outra semana: é outra nota, sai sem pedir confirmação
  const e2 = await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s2.inicio, valor: '1234,56', ambiente: 'homologacao' })
  assert.equal(e2.status, 200, JSON.stringify(e2))
  assert.equal(e2.resultado.estado, 'autorizada')

  // semana sem serviço
  assert.equal((await chamar({ acao: 'recorrente_pular', id: modelo.id, semana: s3.inicio })).status, 200)
  lista = await chamar({ acao: 'recorrentes_listar' })
  assert.deepEqual(lista.recorrentes[0].semanas.map((x) => [x.situacao, x.nota?.valor ?? null]), [['emitida', 1234.56], ['emitida', 1234.56], ['pulada', null], ['a_emitir', null]])
  await chamar({ acao: 'recorrente_pular', id: modelo.id, semana: s3.inicio, desfazer: true })
  assert.equal((await chamar({ acao: 'recorrentes_listar' })).recorrentes[0].semanas[2].situacao, 'a_emitir')
  assert.equal(enviados.length, 2)

  // tela Hoje: as semanas que faltam (inclusive a atual), com a empresa e o ambiente
  const h = await chamar({ acao: 'recorrentes_hoje' })
  assert.deepEqual(h.semanas.map((x) => [x.empresa, x.ambiente, x.modelo.nome, x.inicio, x.emAndamento]),
    [['Lanchonete Teste', 'homologacao', 'Market Ltda', s3.inicio, false], ['Lanchonete Teste', 'homologacao', 'Market Ltda', s4.inicio, true]])
  assert.equal(h.semanas[1].modelo.endereco, 'Av. Teste, 100 - Centro')
  const e3 = await chamar({ acao: 'recorrente_emitir', cliente_id: h.semanas[0].cliente_id, id: h.semanas[0].modelo.id, semana: s3.inicio, valor: '80', ambiente: h.semanas[0].ambiente })
  assert.equal(e3.resultado.estado, 'autorizada')
  // semana atual com ajustes só desta nota: tomador, descrição e data (dentro da semana, até hoje)
  const e4 = await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s4.inicio, valor: '75,50', ambiente: 'homologacao',
    nome: '  Market   Filial ', descricao: 'Coleta extra', data: s4.inicio })
  assert.equal(e4.status, 200, JSON.stringify(e4))
  assert.deepEqual([e4.nota.nome, e4.nota.descricao, e4.nota.data, e4.nota.cpf], ['Market Filial', 'Coleta extra', s4.inicio, MARKET])
  assert.equal(supa.db.nfse_recorrentes[0].nome, 'Market Ltda') // o modelo não muda
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: modelo.id, semana: s4.inicio, valor: '1', ambiente: 'homologacao' })).status, 409)
  assert.deepEqual((await chamar({ acao: 'recorrentes_hoje' })).semanas, [])

  // modelo inexistente (ou de outra empresa) não é encontrado
  assert.equal((await chamar({ acao: 'recorrente_emitir', id: '99999999-9999-4999-8999-999999999999', semana: s3.inicio, valor: '1', ambiente: 'homologacao' })).status, 404)
})
