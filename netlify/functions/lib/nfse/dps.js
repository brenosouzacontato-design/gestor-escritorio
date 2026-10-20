// netlify/functions/lib/nfse/dps.js
//
// Monta a DPS a partir do gabarito da empresa (o bloco <DPS> de uma NFS-e já emitida).
// A DPS gerada é uma cópia do gabarito em que só mudam os campos variáveis:
// Id, tpAmb, dhEmi, verAplic, serie, nDPS, dCompet, tomador, xDescServ e vServ.
// Ordem das tags, regime tributário, códigos de serviço e tributação vêm do gabarito.
//
// Porte fiel de app/dps.py do emissor local; os testes golden garantem os mesmos bytes.

const { lerElemento, filho, novo, clonar } = require('./xml')

const NS = 'http://www.sped.fazenda.gov.br/nfse'
const VER_APLIC = 'EmissorLote_1.0'

const CAMPOS_VARIAVEIS = new Set([
  'infDPS/@Id', 'infDPS/tpAmb', 'infDPS/dhEmi', 'infDPS/verAplic', 'infDPS/serie', 'infDPS/nDPS',
  'infDPS/dCompet', 'infDPS/toma/CPF', 'infDPS/toma/xNome', 'infDPS/serv/cServ/xDescServ',
  'infDPS/valores/vServPrest/vServ',
])

// Aceita o XML de uma NFS-e inteira (como o portal baixa) ou só o bloco <DPS>.
// Remove a <Signature> da DPS, se houver: cada DPS nova é assinada de novo.
function carregarGabarito(xmlTexto) {
  const dps = lerElemento(xmlTexto, 'DPS')
  if (dps.ns !== NS) throw new Error('O gabarito precisa estar no namespace da NFS-e Nacional')
  dps.children = dps.children.filter((c) => c.tag !== 'Signature')
  if (!filho(dps, 'infDPS')) throw new Error('Gabarito sem <infDPS>')
  return dps
}

function idDps(codMunicipio, cnpj, serie, nDps) {
  // "DPS" + cMun(7) + tipo de inscrição (2 = CNPJ) + inscrição(14) + série(5) + nDPS(15)
  const serieNum = parseInt(serie, 10)
  if (!Number.isInteger(serieNum) || serieNum < 0 || serieNum > 99999) throw new Error(`Série inválida: ${serie}`)
  const n = BigInt(nDps)
  if (n < 1n || n > 999999999999999n) throw new Error(`nDPS fora da faixa: ${nDps}`)
  return `DPS${String(codMunicipio).padStart(7, '0')}2${String(cnpj).padStart(14, '0')}`
    + `${String(serieNum).padStart(5, '0')}${n.toString().padStart(15, '0')}`
}

// Valor monetário sempre como string ("650", "6730.5", "1590.00"). Nada de float.
function formatarValor(valor) {
  const s = String(valor).trim()
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!m) throw new Error(`Valor inválido para a DPS: ${valor} (use ponto e no máximo 2 decimais)`)
  return `${BigInt(m[1]).toString()}.${(m[2] || '').padEnd(2, '0')}`
}

const espacos = (s) => String(s || '').split(/\s+/).filter(Boolean).join(' ')

// Data/hora de Brasília (UTC-3, sem horário de verão desde 2019), sem frações de segundo.
function dataHoraBrasilia(agora) {
  const d = new Date(agora.getTime() - 3 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    data: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    iso: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`,
  }
}

function definir(raiz, caminho, valor) {
  const el = filho(raiz, caminho)
  if (!el) throw new Error(`Gabarito sem a tag ${caminho}`)
  el.text = String(valor)
}

// empresa: { cnpj, codigoMunicipio, regraCompetencia, servicoPadrao: { cTribNac, tribISSQN, tpRetISSQN } }
function montarDps({
  gabarito, empresa, ambiente, serie, nDps, cpfTomador, nomeTomador, descricao, valor,
  dataAtendimento, competencia = null, agora = new Date(),
}) {
  const emissao = dataHoraBrasilia(agora)
  let dCompet = competencia
  if (!dCompet) dCompet = empresa.regraCompetencia === 'mes_da_emissao' ? emissao.data : dataAtendimento
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dCompet)) throw new Error(`Competência inválida: ${dCompet}`)
  if (dCompet > emissao.data) {
    // A Sefin rejeita competência posterior à emissão (E0015)
    throw new Error(`Competência ${dCompet.split('-').reverse().join('/')} é posterior à data de emissão`)
  }

  const dps = clonar(gabarito)
  const inf = filho(dps, 'infDPS')
  inf.attrs = [['Id', idDps(empresa.codigoMunicipio, empresa.cnpj, serie, nDps)]]

  definir(inf, 'tpAmb', ambiente === 'producao' ? '1' : '2')
  definir(inf, 'dhEmi', emissao.iso)
  definir(inf, 'verAplic', VER_APLIC)
  definir(inf, 'serie', String(parseInt(serie, 10)))
  definir(inf, 'nDPS', BigInt(nDps).toString())
  definir(inf, 'dCompet', dCompet)
  definir(inf, 'cLocEmi', empresa.codigoMunicipio)
  definir(inf, 'prest/CNPJ', empresa.cnpj)

  const toma = filho(inf, 'toma')
  if (!toma) throw new Error('Gabarito sem a tag toma')
  toma.text = ''
  toma.children = [novo('CPF', cpfTomador), novo('xNome', espacos(nomeTomador))]

  const sp = empresa.servicoPadrao || {}
  if (sp.cTribNac) definir(inf, 'serv/cServ/cTribNac', sp.cTribNac)
  definir(inf, 'serv/cServ/xDescServ', espacos(descricao))
  if (sp.tribISSQN) definir(inf, 'valores/trib/tribMun/tribISSQN', sp.tribISSQN)
  if (sp.tpRetISSQN) definir(inf, 'valores/trib/tribMun/tpRetISSQN', sp.tpRetISSQN)
  definir(inf, 'valores/vServPrest/vServ', formatarValor(valor))
  return dps
}

// (caminho, valor) de todas as folhas e atributos a partir de infDPS, na ordem do documento.
function folhas(dps) {
  const saida = []
  const andar = (no, prefixo) => {
    const caminho = prefixo ? `${prefixo}/${no.tag}` : no.tag
    for (const [k, v] of [...no.attrs].sort()) saida.push([`${caminho}/@${k}`, v])
    if (no.children.length) no.children.forEach((f) => andar(f, caminho))
    else saida.push([caminho, no.text || ''])
  }
  andar(filho(dps, 'infDPS'), '')
  return saida
}

module.exports = { NS, VER_APLIC, CAMPOS_VARIAVEIS, carregarGabarito, idDps, formatarValor, montarDps, folhas, dataHoraBrasilia }
