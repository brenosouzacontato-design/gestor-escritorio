// ISS retido pelo tomador (tpRetISSQN = 2): NFS-e de engenharia (cTribNac 070101) de optante do Simples,
// R$ 28.366,80 com alíquota de 1,80% → ISS R$ 510,60 retido e líquido R$ 27.856,20.
// A fixture tem a estrutura de uma NFS-e real (Belo Horizonte), com prestador e tomador fictícios.
// A retenção vem do gabarito: a DPS nova mantém tpRetISSQN e pAliq; a Sefin calcula vISSQN, vTotalRet
// e vLiq, que o DANFSe e a conferência leem da NFS-e devolvida.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

process.env.NFSE_CERT_KEY = process.env.NFSE_CERT_KEY || crypto.randomBytes(32).toString('base64')
delete process.env.NFSE_EMAILS_PERMITIDOS

const funcao = require('../../../nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')
const { montarDps, carregarGabarito } = require('../dps')
const { serializar } = require('../xml')
const { extrairCampos } = require('../danfse/danfse')
const { resumirNfse } = require('../adn')

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfse_iss_retido.xml'), 'utf8')
const CLIENTE = '22222222-2222-4222-8222-222222222222'
const PRESTADOR = '44555666000181'
const TOMADOR = '77888999000343'
const empresa = {
  cnpj: PRESTADOR, codigoMunicipio: '3106200', regraCompetencia: 'mes_do_atendimento',
  servicoPadrao: { cTribNac: '070101', tribISSQN: '1', tpRetISSQN: '2' },
}

test('DPS com ISS retido: mantém tpRetISSQN 2 e a alíquota do gabarito para qualquer valor', () => {
  const dps = montarDps({
    gabarito: carregarGabarito(XML), empresa, ambiente: 'producao', serie: '900', nDps: 1,
    cpfTomador: TOMADOR, nomeTomador: 'Tomador de Teste Engenharia Ltda.', descricao: 'Gerenciamento de projetos - novembro',
    valor: '30000.00', dataAtendimento: '2026-11-18', agora: new Date('2026-11-19T12:00:00Z'),
  })
  const xml = serializar(dps)
  assert.match(xml, /<tribMun><tribISSQN>1<\/tribISSQN><tpRetISSQN>2<\/tpRetISSQN><pAliq>1\.80<\/pAliq><\/tribMun>/)
  assert.match(xml, /<vServ>30000\.00<\/vServ>/)
  assert.match(xml, /<cTribNac>070101<\/cTribNac><cTribMun>001<\/cTribMun>/)
  assert.match(xml, new RegExp(`<toma><CNPJ>${TOMADOR}</CNPJ>`))
  assert.match(xml, /<totTrib><pTotTribSN>2\.10<\/pTotTribSN><\/totTrib>/)
  // nada de valor calculado copiado do gabarito (o ISS de outra nota não pode ir junto)
  assert.doesNotMatch(xml, /510\.60|27856\.20|28366\.80/)
})

test('configuração da empresa: o gabarito com ISS retido grava tpRetISSQN 2', async () => {
  const supa = criarSupabaseFalso({
    usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Prestador de Teste', cnpj: '44.555.666/0001-81' }] },
  })
  funcao._deps.supabase = () => supa
  const r = await funcao.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' },
    body: JSON.stringify({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: XML, serie_dps: '900', ambiente: 'producao',
      servico_padrao: { regApIBSCBSSN: '1', cAtvSN: '7' } }) })
  assert.equal(r.statusCode, 200, r.body)
  const [cfg] = supa.db.nfse_empresas
  assert.equal(cfg.cnpj, PRESTADOR)
  assert.equal(cfg.codigo_municipio, '3106200')
  assert.deepEqual([cfg.servico_padrao.cTribNac, cfg.servico_padrao.tribISSQN, cfg.servico_padrao.tpRetISSQN], ['070101', '1', '2'])
})

test('NFS-e com ISS retido: DANFSe e conferência mostram retenção e valor líquido', async () => {
  const c = await extrairCampos(XML, { buscarMunicipio: null })
  assert.equal(c.issqn.retencao, 'Retido pelo Tomador')
  assert.match(c.issqn.aliquota, /1,80/)
  assert.match(c.issqn.apurado, /510,60/)
  assert.match(c.totais.servico, /28\.366,80/)
  assert.match(c.totais.retencoes, /510,60/)
  assert.match(c.totais.liquido, /27\.856,20/)

  const nota = resumirNfse(XML)
  assert.equal(nota.valor, 28366.8)
  assert.equal(nota.valor_liquido, 27856.2)
})
