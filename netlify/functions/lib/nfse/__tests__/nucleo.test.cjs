// Testes do núcleo de NFS-e. Rodar: node --test netlify/functions/lib/nfse/__tests__/
//
// "golden/" foi gerado pelo app Python (emissor-nfse/scripts/gerar_golden_js.py), que já emitiu
// notas aceitas pela Sefin. O JS tem que produzir EXATAMENTE os mesmos bytes, assinatura incluída.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { carregarGabarito, montarDps, idDps, folhas, formatarValor, CAMPOS_VARIAVEIS } = require('../dps')
const { assinar, verificar } = require('../assinatura')
const { serializar, lerElemento, canonico } = require('../xml')
const { lerPfx, checar, testarPar } = require('../certificado')

const G = path.join(__dirname, 'golden')
const casos = JSON.parse(fs.readFileSync(path.join(G, 'casos.json'), 'utf8'))
const gabaritoXml = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
const cert = lerPfx(fs.readFileSync(path.join(G, 'teste.pfx')), casos.senha_pfx)

const p = casos.prestador
const empresa = {
  cnpj: p.cnpj, codigoMunicipio: p.codigo_municipio_ibge, regraCompetencia: p.regra_competencia,
  servicoPadrao: p.servico_padrao,
}

function gerar(caso) {
  const dps = montarDps({
    gabarito: carregarGabarito(gabaritoXml), empresa, ambiente: caso.ambiente, serie: caso.serie, nDps: caso.n_dps,
    cpfTomador: caso.cpf, nomeTomador: caso.tomador, descricao: caso.descricao, valor: caso.valor,
    dataAtendimento: caso.data_atendimento, competencia: caso.competencia, agora: new Date(casos.agora),
  })
  return assinar(dps, cert)
}

test('certificado de teste: CNPJ, titular e par chave/certificado', () => {
  assert.equal(cert.cnpj, p.cnpj)
  assert.equal(cert.titular, 'EMPRESA TESTE LTDA')
  assert.ok(testarPar(cert))
  assert.deepEqual(checar(cert, p.cnpj).bloqueios, [])
  assert.match(checar(cert, '11222333000181').bloqueios[0], /diferente/)
})

test('senha errada do pfx', () => {
  assert.throws(() => lerPfx(fs.readFileSync(path.join(G, 'teste.pfx')), 'errada'), /senha errada/)
})

for (const caso of casos.casos) {
  test(`golden ${caso.nome}: mesmos bytes do Python (assinatura incluída)`, () => {
    const esperado = fs.readFileSync(path.join(G, caso.esperado), 'utf8')
    const obtido = serializar(gerar(caso))
    assert.equal(obtido, esperado)
  })
}

test('DPS assinada verifica e estrutura é igual ao gabarito', () => {
  const dps = gerar(casos.casos[0])
  verificar(dps)
  verificar(lerElemento(serializar(dps), 'DPS')) // relida do texto
  const gerada = folhas(dps)
  const gab = folhas(carregarGabarito(gabaritoXml))
  assert.deepEqual(gerada.map(([c]) => c), gab.map(([c]) => c))
  const diferentes = gerada.filter(([c, v], i) => v !== gab[i][1]).map(([c]) => c)
  assert.deepEqual(diferentes.filter((c) => !CAMPOS_VARIAVEIS.has(c)), [])
})

test('alteração depois de assinar quebra a assinatura', () => {
  const dps = gerar(casos.casos[0])
  const inf = dps.children[0]
  inf.children.find((c) => c.tag === 'valores').children[0].children[0].text = '6500.00'
  assert.throws(() => verificar(dps), /DigestValue/)
})

test('gabarito a partir da NFS-e completa (como o portal baixa) ignora a assinatura da Sefin', () => {
  const nfse = `<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS1"><nNFSe>12</nNFSe>${gabaritoXml.replace(/<\?xml[^>]*\?>/, '')}</infNFSe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature></NFSe>`
  const g = carregarGabarito(nfse)
  assert.equal(g.tag, 'DPS')
  assert.deepEqual(folhas(g), folhas(carregarGabarito(gabaritoXml)))
})

test('canônico do infDPS declara o namespace herdado e nunca xmlns=""', () => {
  const dps = gerar(casos.casos[1])
  const c = canonico(dps.children[0], dps.ns)
  assert.ok(c.startsWith('<infDPS xmlns="http://www.sped.fazenda.gov.br/nfse" Id="'))
  assert.ok(!c.includes('xmlns=""'))
})

test('Id da DPS, valores e competência', () => {
  assert.equal(idDps('3154606', p.cnpj, '70000', 16), 'DPS315460624761925000017870000000000000000016')
  assert.equal(formatarValor('650'), '650.00')
  assert.equal(formatarValor('2500.5'), '2500.50')
  assert.throws(() => formatarValor('1.590,00'), /Valor inválido/)
  assert.throws(() => formatarValor('10.125'), /Valor inválido/)
  assert.throws(() => gerar({ ...casos.casos[0], competencia: '2026-10-16' }), /posterior/)
})
