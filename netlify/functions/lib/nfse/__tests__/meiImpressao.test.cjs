const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { lerImpressao, camposDaImpressao } = require('../meiImpressao')
const { extrairCampos, desenharDanfse } = require('../danfse/danfse')

// Nota de MEI real do Emissor Nacional, com prestador trocado por dados fictícios: a mesma nota
// como "versão para impressão" (sem captcha) e como XML autorizado.
const FIX = path.join(__dirname, 'fixtures')
const HTML = fs.readFileSync(path.join(FIX, 'mei_impressao.html'), 'utf8')
const XML = fs.readFileSync(path.join(FIX, 'mei_nfse.xml'), 'utf8')
const IBGE = { 'Ribeirão das Neves/MG': '3154606' }
const buscarIbge = async (nome, uf) => IBGE[`${nome}/${uf}`] || null

test('lê painéis e campos da versão para impressão', () => {
  const s = lerImpressao(HTML)
  assert.strictEqual(s['Identificação da NFS-e']['Chave de acesso'], '31241042211222333000181000000000000526114018684686')
  assert.strictEqual(s.Tomador['Nome/Razão Social'], 'MMS ARMAZENAGEM E LOGISTICA S/A')
  assert.strictEqual(s['Tributação Municipal']['Valor do Serviço'], '466,67')
  assert.strictEqual(s.Emitente['Inscrição Municipal'], '')
})

test('campos da página batem com os do XML autorizado', async () => {
  const doXml = await extrairCampos(XML, { buscarMunicipio: async () => null })
  const daPagina = await camposDaImpressao(HTML, { competencia: '2026-11-09', buscarIbge })
  assert.deepStrictEqual(daPagina, doXml)
})

test('sem resposta do IBGE, o código do tomador fica com traço', async () => {
  const c = await camposDaImpressao(HTML, { competencia: '2026-11-09', buscarIbge: async () => null })
  assert.strictEqual(c.tomador.ibgeCep, '- / 33.822-722')
  assert.strictEqual(c.prestador.ibgeCep, '3124104 / 32.800-000')
})

test('página que não é de nota é recusada', async () => {
  await assert.rejects(() => camposDaImpressao('<html><body>Sessão expirada</body></html>'), /chave de acesso/)
})

test('gera o PDF do DANFSe', async () => {
  const pdf = await desenharDanfse(await camposDaImpressao(HTML, { competencia: '2026-11-09', buscarIbge }))
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-')
})
