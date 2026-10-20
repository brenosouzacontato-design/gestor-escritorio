// Leiaute da NT SE/CGNFS-e nº 009 v1.01 (Anexo VI v1.04.01) na DPS.
// Ordem esperada dos campos copiada da aba "LEIAUTE DPS_NFS-e - RT" do Anexo VI.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { carregarGabarito, montarDps, usaLeiauteNt009 } = require('../dps')
const { assinar, verificar } = require('../assinatura')
const { serializar, lerElemento, filho } = require('../xml')
const { lerPfx } = require('../certificado')

const G = path.join(__dirname, 'golden')
const casos = JSON.parse(fs.readFileSync(path.join(G, 'casos.json'), 'utf8'))
const gabaritoXml = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
const cert = lerPfx(fs.readFileSync(path.join(G, 'teste.pfx')), casos.senha_pfx)
const p = casos.prestador

const ORDEM_INFDPS = ['tpAmb', 'dhEmi', 'verAplic', 'serie', 'nDPS', 'dCompet', 'tpEmit', 'cMotivoEmisTI', 'finNFSe',
  'tpNFSeDebito', 'tpNFSeCredito', 'chNFSeRej', 'cLocEmi', 'subst', 'prest', 'toma', 'indDest', 'dest', 'interm', 'serv',
  'valores', 'IBSCBS']
const ORDEM_REGTRIB = ['opSimpNac', 'regApTribSN', 'regApIBSCBSSN', 'regEspTrib']
const ORDEM_CSERV = ['cTribNac', 'cTribMun', 'cNBS', 'cAtvSN', 'cIntContrib', 'xDescServ']

function gerar({ ambiente = 'homologacao', agora = '2026-10-20T09:30:00-03:00', servicoPadrao = {}, gabarito = gabaritoXml } = {}) {
  return montarDps({
    gabarito: carregarGabarito(gabarito), ambiente, serie: '900', nDps: 5,
    empresa: {
      cnpj: p.cnpj, codigoMunicipio: p.codigo_municipio_ibge, regraCompetencia: p.regra_competencia,
      servicoPadrao: { ...p.servico_padrao, regApIBSCBSSN: '1', cAtvSN: '7', ...servicoPadrao },
    },
    cpfTomador: '52998224725', nomeTomador: 'Paciente de Teste', descricao: 'Consulta', valor: '10.00',
    dataAtendimento: '2026-10-20', agora: new Date(agora),
  })
}

const tags = (no) => no.children.map((c) => c.tag)
const naOrdem = (lista, ordem) => {
  const pos = lista.map((t) => ordem.indexOf(t))
  assert.ok(pos.every((x) => x >= 0), `tag fora do leiaute: ${lista}`)
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b), `ordem errada: ${lista.join(', ')}`)
}

test('datas de corte: homologação desde 16/10/2026, produção a partir de 03/11/2026', () => {
  assert.equal(usaLeiauteNt009('homologacao', '2026-10-15', {}), false)
  assert.equal(usaLeiauteNt009('homologacao', '2026-10-16', {}), true)
  assert.equal(usaLeiauteNt009('producao', '2026-11-02', {}), false)
  assert.equal(usaLeiauteNt009('producao', '2026-11-03', {}), true)
  // se a Sefin adiar a produção, a data muda por variável de ambiente
  assert.equal(usaLeiauteNt009('producao', '2026-11-03', { NFSE_NT009_PRODUCAO_A_PARTIR: '2026-12-01' }), false)
})

test('DPS no leiaute NT 009: finNFSe, indDest e campos do Simples, na ordem do Anexo VI', () => {
  const inf = filho(gerar(), 'infDPS')
  naOrdem(tags(inf), ORDEM_INFDPS)
  assert.equal(filho(inf, 'finNFSe').text, '0')
  assert.equal(filho(inf, 'indDest').text, '0')
  assert.equal(tags(inf).indexOf('finNFSe'), tags(inf).indexOf('tpEmit') + 1)
  assert.equal(tags(inf).indexOf('indDest'), tags(inf).indexOf('toma') + 1)
  const regTrib = filho(inf, 'prest/regTrib')
  naOrdem(tags(regTrib), ORDEM_REGTRIB)
  assert.equal(filho(regTrib, 'regApIBSCBSSN').text, '1')
  const cServ = filho(inf, 'serv/cServ')
  naOrdem(tags(cServ), ORDEM_CSERV)
  assert.equal(filho(cServ, 'cAtvSN').text, '7')
})

test('produção antes de 03/11 continua no leiaute em vigor', () => {
  const inf = filho(gerar({ ambiente: 'producao', agora: '2026-10-30T10:00:00-03:00' }), 'infDPS')
  for (const t of ['finNFSe', 'indDest']) assert.equal(filho(inf, t), null)
  assert.equal(filho(inf, 'prest/regTrib/regApIBSCBSSN'), null)
  assert.equal(filho(inf, 'serv/cServ/cAtvSN'), null)
  const depois = filho(gerar({ ambiente: 'producao', agora: '2026-11-03T08:00:00-03:00' }), 'infDPS')
  assert.equal(filho(depois, 'finNFSe').text, '0')
})

test('optante do Simples sem regime IBS/CBS ou atividade configurados: erro antes de gastar número', () => {
  assert.throws(() => gerar({ servicoPadrao: { regApIBSCBSSN: '' } }), /regApIBSCBSSN/)
  assert.throws(() => gerar({ servicoPadrao: { cAtvSN: '99' } }), /cAtvSN/)
})

test('não optante do Simples não leva regApIBSCBSSN nem cAtvSN (Anexo VI, RN 314 e 450)', () => {
  const naoOptante = gabaritoXml.replace('<opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN>', '<opSimpNac>1</opSimpNac>')
  const inf = filho(gerar({ gabarito: naoOptante, servicoPadrao: { regApIBSCBSSN: '', cAtvSN: '' } }), 'infDPS')
  assert.equal(filho(inf, 'prest/regTrib/regApIBSCBSSN'), null)
  assert.equal(filho(inf, 'serv/cServ/cAtvSN'), null)
  assert.equal(filho(inf, 'finNFSe').text, '0')
})

test('gabarito com finNFSe/indDest dentro de IBSCBS (posição antiga): saem de lá e vão para infDPS', () => {
  const comIbscbs = gabaritoXml.replace('</valores></infDPS>',
    '</valores><IBSCBS><finNFSe>0</finNFSe><indFinal>0</indFinal><cIndOp>030101</cIndOp><indDest>0</indDest></IBSCBS></infDPS>')
  const inf = filho(gerar({ gabarito: comIbscbs }), 'infDPS')
  assert.deepEqual(tags(filho(inf, 'IBSCBS')), ['indFinal', 'cIndOp'])
  assert.equal(tags(inf).filter((t) => t === 'finNFSe').length, 1)
  naOrdem(tags(inf), ORDEM_INFDPS)
})

test('DPS no leiaute novo assina e verifica, também relida do texto', () => {
  const dps = assinar(gerar(), cert)
  verificar(dps)
  verificar(lerElemento(serializar(dps), 'DPS'))
})
