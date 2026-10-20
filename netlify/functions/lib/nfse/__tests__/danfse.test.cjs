// DANFSe (NT 008/2026) a partir de uma NFS-e de homologação real da Simple Care, com o tomador
// trocado por um fictício.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('@cantoo/pdf-lib')
const { gerarDanfse, extrairCampos } = require('../danfse/danfse')

const XML = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfse_homologacao.xml'), 'utf8')
const CHAVE = '31546062247619250000178000000000000126100238654068'
const semIbge = { buscarMunicipio: null }

test('campos do DANFSe saem do XML da NFS-e', async () => {
  const c = await extrairCampos(XML, semIbge)
  assert.equal(c.chave, CHAVE)
  assert.equal(c.ambiente, '2')
  assert.equal(c.cabecalho.municipio, 'Município: Ribeirão das Neves / MG')
  assert.equal(c.cabecalho.tipoAmbiente, 'Tipo de Ambiente: Homologação')
  assert.deepEqual(
    [c.identificacao.numero, c.identificacao.competencia, c.identificacao.dhProc, c.identificacao.nDPS, c.identificacao.serie],
    ['1', '02/10/2026', '15/10/2026 13:15:46', '3', '900'],
  )
  assert.equal(c.identificacao.emitente, 'Prestador')
  assert.equal(c.identificacao.situacao, 'NFS-e Gerada')
  // prestador: CNPJ da DPS, nome e endereço do emit da NFS-e
  assert.equal(c.prestador.doc, '47.619.250/0001-78')
  assert.equal(c.prestador.nome, 'SIMPLE CARE ODONTOLOGIA DE RESULTADO LTDA')
  assert.equal(c.prestador.endereco, 'RUA SAO PEDRO, 21, SAO JANUARIO (JUSTINOPOLIS)')
  assert.equal(c.prestador.ibgeCep, '3154606 / 33.900-370')
  assert.match(c.prestador.simples, /^Optante - Microempresa/)
  assert.equal(c.tomador.doc, '123.456.789-09')
  assert.equal(c.tomador.nome, 'Paciente de Teste')
  assert.equal(c.tomador.endereco, '-') // campo sem dado no XML vira traço (NT, nota 12)
  assert.equal(c.destinatario, null)
  assert.equal(c.intermediario, null)
  assert.equal(c.servico.codigo, '04.12.01')
  assert.equal(c.servico.descricaoCodigo, 'Odontologia.')
  assert.equal(c.servico.local, 'Ribeirão das Neves / MG / BR')
  assert.equal(c.issqn.tipo, 'Operação Tributável')
  assert.equal(c.issqn.retencao, 'Não Retido')
  assert.equal(c.totais.servico, 'R$ 20,00')
  assert.equal(c.totais.liquido, 'R$ 20,00')
  assert.equal(c.complementares.totais, 'Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: 2,00%')
  assert.equal(c.canhoto, `1 / ${CHAVE}`)
})

test('DANFSe é um PDF A4 de uma página só', async () => {
  const pdf = await gerarDanfse(XML, semIbge)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  const doc = await PDFDocument.load(pdf)
  assert.equal(doc.getPageCount(), 1)
  const { width, height } = doc.getPage(0).getSize()
  assert.ok(Math.abs(width - 595.28) < 0.5 && Math.abs(height - 841.89) < 0.5, `${width}x${height}`)
})

test('nota de produção não leva a expressão de homologação', async () => {
  const producao = XML.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')
  const c = await extrairCampos(producao, semIbge)
  assert.equal(c.ambiente, '1')
  assert.equal(c.cabecalho.tipoAmbiente, 'Tipo de Ambiente: Produção')
})

test('município fora do XML é buscado (e cai no código se a busca falhar)', async () => {
  const comEndereco = XML.replace('<xNome>Paciente de Teste</xNome>',
    '<xNome>Paciente de Teste</xNome><end><endNac><cMun>3550308</cMun><CEP>01001000</CEP></endNac><xLgr>Praça da Sé</xLgr><nro>1</nro><xBairro>Sé</xBairro></end>')
  const c = await extrairCampos(comEndereco, { buscarMunicipio: async (cod) => (cod === '3550308' ? 'São Paulo' : null) })
  assert.equal(c.tomador.municipio, 'São Paulo / SP')
  assert.equal(c.tomador.ibgeCep, '3550308 / 01.001-000')
  assert.equal(c.tomador.endereco, 'Praça da Sé, 1, Sé')
  const semBusca = await extrairCampos(comEndereco, { buscarMunicipio: async () => { throw new Error('fora do ar') } })
  assert.equal(semBusca.tomador.municipio, '3550308 / SP')
})

test('NFS-e no leiaute da NT 009: finalidade e destinatário na raiz de infDPS', async () => {
  const nt009 = XML.replace('<tpEmit>1</tpEmit>', '<tpEmit>1</tpEmit><finNFSe>0</finNFSe>')
    .replace('</toma>', '</toma><indDest>0</indDest>')
  const c = await extrairCampos(nt009, semIbge)
  assert.equal(c.identificacao.finalidade, 'NFS-e regular')
  assert.equal(c.destinatario, null)
  assert.equal(c.destinatarioEhTomador, true)
})

// Estrutura de IBS/CBS como a Sefin devolveu na NFS-e nº 4 de homologação (20/10/2026), com o
// tomador fictício da fixture
const NFSE_IBSCBS = XML
  .replace('<xTribNac>Odontologia.</xTribNac>', '<xTribNac>Odontologia.</xTribNac><xNBS>Serviços odontológicos</xNBS>')
  .replace('<valores><vLiq>20.00</vLiq></valores>', '<valores><vLiq>11.00</vLiq></valores><IBSCBS><cLocalidadeIncid>3154606</cLocalidadeIncid>'
    + '<xLocalidadeIncid>Ribeirão das Neves</xLocalidadeIncid><valores><vBC>11.00</vBC><uf><pIBSUF>0.10</pIBSUF><pRedAliqUF>60.00</pRedAliqUF>'
    + '<pAliqEfetUF>0.04</pAliqEfetUF></uf><mun><pIBSMun>0.00</pIBSMun><pRedAliqMun>60.00</pRedAliqMun><pAliqEfetMun>0.00</pAliqEfetMun></mun>'
    + '<fed><pCBS>0.90</pCBS><pRedAliqCBS>60.00</pRedAliqCBS><pAliqEfetCBS>0.36</pAliqEfetCBS></fed></valores><totCIBS><vTotNF>11.00</vTotNF>'
    + '<gIBS><vIBSTot>0.00</vIBSTot><gIBSUFTot><vIBSUF>0.00</vIBSUF></gIBSUFTot><gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS>'
    + '<gCBS><vCBS>0.04</vCBS></gCBS></totCIBS></IBSCBS>')
  .replace('<tpEmit>1</tpEmit>', '<tpEmit>1</tpEmit><finNFSe>0</finNFSe>')
  .replace('<cTribNac>041201</cTribNac>', '<cTribNac>041201</cTribNac><cNBS>123012300</cNBS>')
  .replace('</valores></infDPS>', '</valores><IBSCBS><cIndOp>030101</cIndOp><indDest>0</indDest><valores><trib><CST>200</CST>'
    + '<cClassTrib>200029</cClassTrib></trib></valores></IBSCBS></infDPS>')

test('NFS-e com IBS/CBS (NT 009): CST/cClassTrib, alíquotas e valores no DANFSe', async () => {
  const c = await extrairCampos(NFSE_IBSCBS, semIbge)
  assert.equal(c.ibscbs.cst, '200 / 200029')
  assert.equal(c.ibscbs.operacao, '030101 / 3154606 / Ribeirão das Neves / MG')
  assert.equal(c.ibscbs.bc, 'R$ 11,00')
  assert.equal(c.ibscbs.reducoes, '60,00% / 60,00% / 60,00%')
  assert.equal(c.ibscbs.aliquotas, '0,10% / 0,00%')
  assert.equal(c.ibscbs.pCBS, '0,90%')
  assert.equal(c.ibscbs.efetivaCBS, '0,36%')
  assert.equal(c.ibscbs.vCBS, 'R$ 0,04')
  assert.equal(c.totais.liquidoComIbsCbs, 'R$ 11,00')
  assert.equal(c.servico.nbs, '123012300')
  assert.equal(c.identificacao.finalidade, 'NFS-e regular')
  assert.equal(c.destinatarioEhTomador, true)
  const pdf = await gerarDanfse(NFSE_IBSCBS, semIbge)
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1)
})

test('XML que não é NFS-e autorizada é recusado', async () => {
  await assert.rejects(() => gerarDanfse('<DPS><infDPS/></DPS>', semIbge), /NFSe/)
})
