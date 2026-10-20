// Ponta a ponta da function nfse.js com Supabase e Sefin simulados: login → empresa → certificado →
// importar → editar → prévia → emitir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

process.env.NFSE_CERT_KEY = crypto.randomBytes(32).toString('base64')
delete process.env.NFSE_EMAILS_PERMITIDOS

const funcao = require('../../../nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')
const { criarCliente, comprimir } = require('../sefin')
const { decifrar } = require('../cofre')

const G = path.join(__dirname, 'golden')
const F = path.join(__dirname, 'fixtures')
const CLIENTE = '11111111-1111-4111-8111-111111111111'
const CHAVE = '31546062247619250000178000000000001326100000000001'

function montar() {
  const supa = criarSupabaseFalso({
    usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Clínica Teste', cnpj: '47.619.250/0001-78' }] },
  })
  const chamadas = []
  funcao._deps.supabase = () => supa
  funcao._deps.criarCliente = ({ ambiente }) => criarCliente({
    tls: null, ambiente, transporte: async (metodo, caminho) => {
      chamadas.push(`${metodo} ${caminho}`)
      if (metodo === 'POST') return { status: 201, dados: { chaveAcesso: CHAVE, nfseXmlGZipB64: comprimir('<NFSe><infNFSe><nNFSe>14</nNFSe></infNFSe></NFSe>') }, texto: '' }
      return { status: 404, dados: { erro: { codigo: 'E2404' } }, texto: '' }
    },
  })
  const chamar = async (corpo, token = 'tok') => {
    const r = await funcao.handler({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(corpo) })
    return { status: r.statusCode, ...JSON.parse(r.body) }
  }
  return { supa, chamar, chamadas }
}

test('sem login não faz nada', async () => {
  const { chamar } = montar()
  assert.equal((await chamar({ acao: 'status', cliente_id: CLIENTE }, null)).status, 401)
  assert.equal((await chamar({ acao: 'status', cliente_id: CLIENTE }, 'falso')).status, 401)
})

test('fluxo completo: empresa, certificado cifrado, importar, editar, prévia e emitir', async () => {
  const { supa, chamar, chamadas } = montar()
  const gabarito = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')

  // série igual à do Emissor Web é recusada
  assert.equal((await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gabarito, serie_dps: '70000' })).status, 400)
  // campos do Simples Nacional da NT 009: validados e mantidos ao salvar de novo sem eles
  const simples = { regApIBSCBSSN: '1', cAtvSN: '7' }
  assert.equal((await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gabarito, servico_padrao: { cAtvSN: '99' } })).status, 400)
  assert.equal((await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gabarito, servico_padrao: simples })).status, 200)
  const st = await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gabarito })
  assert.equal(st.status, 200)
  assert.equal(st.empresa.codigo_municipio, '3154606')
  assert.deepEqual(st.empresa.servico_padrao, { cTribNac: '041201', tribISSQN: '1', tpRetISSQN: '1', ...simples })
  assert.equal(st.empresa.ambiente, 'homologacao')

  const pfx = fs.readFileSync(path.join(G, 'teste.pfx')).toString('base64')
  assert.equal((await chamar({ acao: 'salvar_certificado', cliente_id: CLIENTE, pfx_base64: pfx, senha: 'errada' })).status, 400)
  const sc = await chamar({ acao: 'salvar_certificado', cliente_id: CLIENTE, pfx_base64: pfx, senha: 'teste' })
  assert.equal(sc.status, 200)
  assert.equal(sc.certificado.cnpj, '47619250000178')
  const guardado = supa.db.nfse_certificados[0]
  assert.ok(!guardado.pfx_cifrado.includes(pfx.slice(0, 30)))
  assert.equal(decifrar(guardado.senha_cifrada).toString(), 'teste')

  const imp = await chamar({ acao: 'importar', cliente_id: CLIENTE, texto: fs.readFileSync(path.join(F, 'lote_whatsapp.txt'), 'utf8') })
  assert.equal(imp.status, 200)
  const notas = supa.db.nfse_notas.filter((n) => n.lote_id === imp.lote_id)
  assert.equal(notas.length, 26)
  assert.equal(notas.filter((n) => n.estado === 'validada').length, 20)

  // nota com CPF errado: corrige na tela e vira pronta
  const ruim = notas[1]
  assert.equal(ruim.status_validacao, 'invalido')
  assert.equal((await chamar({ acao: 'editar', nota_id: ruim.id, campos: { cpf: '083.016.613-05' } })).status, 200)
  assert.equal(supa.db.nfse_notas.find((n) => n.id === ruim.id).status_validacao, 'pronto')
  assert.equal((await chamar({ acao: 'editar', nota_id: ruim.id, campos: { data: '31/02/2026' } })).status, 400)

  const pv = await chamar({ acao: 'previa', nota_id: notas[0].id })
  assert.equal(pv.numero_previa, 1)
  assert.match(pv.xml, /<tpAmb>2<\/tpAmb>/)
  assert.equal(supa.db.nfse_notas.find((n) => n.id === notas[0].id).n_dps, null) // prévia não reserva

  // ambiente confirmado diferente: nada vai para a Sefin
  assert.equal((await chamar({ acao: 'emitir', nota_id: notas[0].id, ambiente: 'producao' })).status, 409)
  assert.deepEqual(chamadas, [])
  const em = await chamar({ acao: 'emitir', nota_id: notas[0].id, ambiente: 'homologacao' })
  assert.equal(em.status, 200)
  assert.equal(em.resultado.estado, 'autorizada')
  assert.equal(em.nota.numero_nfse, '14')
  assert.deepEqual(chamadas, ['POST /nfse'])

  // nota pendente não emite
  const pendente = notas.find((n) => n.status_validacao === 'pendente')
  assert.equal((await chamar({ acao: 'emitir', nota_id: pendente.id, ambiente: 'homologacao' })).status, 409)
})

test('gabarito de outro CNPJ é recusado', async () => {
  const { chamar } = montar()
  const gab = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8').replace(/47619250000178/g, '11222333000181')
  const r = await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gab })
  assert.equal(r.status, 400)
  assert.match(r.erro, /CNPJ/)
})
