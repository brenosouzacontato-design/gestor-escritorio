// netlify/functions/lib/nfse/dps.js
//
// Monta a DPS a partir do gabarito da empresa (o bloco <DPS> de uma NFS-e já emitida).
// A DPS gerada é uma cópia do gabarito em que só mudam os campos variáveis:
// Id, tpAmb, dhEmi, verAplic, serie, nDPS, dCompet, tomador, xDescServ e vServ.
// Ordem das tags, regime tributário, códigos de serviço e tributação vêm do gabarito.
//
// Porte fiel de app/dps.py do emissor local; os testes golden garantem os mesmos bytes.
//
// Leiaute NT SE/CGNFS-e nº 009 v1.01 (Anexo VI v1.04.01): campos novos inseridos por
// aplicarLeiauteNt009 nas posições do Anexo VI. A Sefin liga a NT em fases, então cada grupo de
// campos tem a sua data por ambiente (NT009_DATAS). O que se observou na produção restrita:
//   - finNFSe: exigido depois de 15/10/2026 (DPS sem ele autorizada às 13:15 desse dia; E1235 em 20/10);
//   - regApIBSCBSSN: ainda recusado pelo esquema em 20/10/2026 (E1235 "invalid child element");
//   - indDest/dest: fase de 30/10/2026 segundo o cronograma divulgado;
//   - grupo IBSCBS: em 20/10/2026 a Sefin passou a rejeitar sem ele (E0855: "obrigatório declarar
//     informações de IBS/CBS quando a data de competência for igual ou posterior a 01/10/2026").
// Produção: tudo em 03/11/2026. Qualquer data muda sem mexer no código pela variável
// NFSE_NT009_<GRUPO>_<AMBIENTE>=AAAA-MM-DD (ex.: NFSE_NT009_SIMPLES_HOMOLOGACAO=2026-11-03);
// NFSE_NT009_PRODUCAO_A_PARTIR muda a data de produção de todos os grupos de uma vez.

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

// ---------- NT 009 ----------

const NT009_DATAS = {
  finNFSe: { homologacao: '2026-10-16', producao: '2026-11-03' },
  indDest: { homologacao: '2026-10-30', producao: '2026-11-03' },
  simples: { homologacao: '2026-11-03', producao: '2026-11-03' },
  ibscbs: { homologacao: '2026-10-20', producao: '2026-11-03' },
}

// Grupos da NT 009 que valem nesse ambiente na data de emissão (AAAA-MM-DD de Brasília).
function gruposNt009(ambiente, dataEmissao, env = process.env) {
  if (!['homologacao', 'producao'].includes(ambiente)) throw new Error(`Ambiente desconhecido: ${ambiente}`)
  const ativos = {}
  for (const [grupo, datas] of Object.entries(NT009_DATAS)) {
    const inicio = env[`NFSE_NT009_${grupo.toUpperCase()}_${ambiente.toUpperCase()}`]
      || (ambiente === 'producao' && env.NFSE_NT009_PRODUCAO_A_PARTIR) || datas[ambiente]
    ativos[grupo] = dataEmissao >= inicio
  }
  return ativos
}

const usaLeiauteNt009 = (ambiente, dataEmissao, env = process.env) =>
  Object.values(gruposNt009(ambiente, dataEmissao, env)).some(Boolean)

// Códigos de atividade do Simples Nacional aceitos no campo cAtvSN (NT 009, item 2.4)
const CODIGOS_ATIVIDADE_SN = ['7', '8', '9', '10', '11', '12', '13', '14', '90']

// Insere `elemento` em `pai` antes do primeiro filho cuja tag esteja em `antesDe` (ou no fim).
function inserirAntes(pai, elemento, antesDe) {
  const i = pai.children.findIndex((c) => antesDe.includes(c.tag))
  if (i < 0) pai.children.push(elemento)
  else pai.children.splice(i, 0, elemento)
}

const remover = (pai, tags) => { if (pai) pai.children = pai.children.filter((c) => !tags.includes(c.tag)) }

// Ajusta a DPS (cópia do gabarito) para o leiaute da NT 009. Para NFS-e regular (finNFSe = 0) com o
// destinatário igual ao tomador (indDest = 0); para optante do Simples ME/EPP ou pendente (opSimpNac
// 3 ou 4), também regApIBSCBSSN e cAtvSN, que são obrigatórios (Anexo VI, RN 313 e 449) e vêm da
// configuração da empresa (servicoPadrao).
// grupos: quais partes aplicar ({ finNFSe, indDest, simples }, ver gruposNt009); padrão: todas.
function aplicarLeiauteNt009(inf, servicoPadrao = {}, grupos = { finNFSe: true, indDest: true, simples: true }) {
  // finNFSe/indDest/dest saem do grupo IBSCBS (posição antiga) e vão para a raiz de infDPS
  const ibscbs = filho(inf, 'IBSCBS')
  if (grupos.finNFSe) {
    remover(ibscbs, ['finNFSe'])
    remover(inf, ['finNFSe'])
    inserirAntes(inf, novo('finNFSe', '0'), ['tpNFSeDebito', 'tpNFSeCredito', 'chNFSeRej', 'cLocEmi'])
  }
  if (grupos.indDest) {
    remover(ibscbs, ['indDest', 'dest'])
    remover(inf, ['indDest'])
    inserirAntes(inf, novo('indDest', '0'), ['dest', 'interm', 'serv', 'valores', 'IBSCBS'])
  }
  if (grupos.ibscbs) aplicarIbsCbs(inf, servicoPadrao)
  if (!grupos.simples) return

  const regTrib = filho(inf, 'prest/regTrib')
  const cServ = filho(inf, 'serv/cServ')
  const opSimpNac = (filho(regTrib, 'opSimpNac') || {}).text
  remover(regTrib, ['regApIBSCBSSN'])
  remover(cServ, ['cAtvSN'])
  if (opSimpNac !== '3' && opSimpNac !== '4') return

  const regime = String(servicoPadrao.regApIBSCBSSN || '')
  const atividade = String(servicoPadrao.cAtvSN || '')
  if (!['1', '2', '3'].includes(regime)) {
    throw new Error('Configure o regime de apuração do IBS/CBS no Simples Nacional (regApIBSCBSSN) da empresa')
  }
  if (!CODIGOS_ATIVIDADE_SN.includes(atividade)) {
    throw new Error('Configure o código de atividade do Simples Nacional (cAtvSN) da empresa')
  }
  if (!regTrib || !cServ) throw new Error('Gabarito sem prest/regTrib ou serv/cServ')
  inserirAntes(regTrib, novo('regApIBSCBSSN', regime), ['regEspTrib'])
  inserirAntes(cServ, novo('cAtvSN', atividade), ['cIntContrib', 'xDescServ'])
}

// Grupo IBSCBS da DPS no leiaute da NT 009 (Anexo VI, itens 373-425): indicador da operação e
// CST/cClassTrib, que vêm da configuração da empresa. Com o regime de IBS/CBS pelo Simples
// (regApIBSCBSSN = 1) os valores de IBS e CBS não são informados (RN 136 e 173). O NBS do serviço
// (cNBS, em serv/cServ) vai junto. O IBSCBS do gabarito, se houver, é substituído.
// NFSE_GIBSCBS_VAZIO=1 inclui um <gIBSCBS/> vazio, se a Sefin passar a exigir o grupo.
const FORMATOS_IBSCBS = { cIndOp: /^\d{6}$/, CST: /^\d{3}$/, cClassTrib: /^\d{6}$/, cNBS: /^\d{9}$/ }

function aplicarIbsCbs(inf, servicoPadrao = {}, env = process.env) {
  const v = (campo) => String(servicoPadrao[campo] || '').replace(/\D/g, '')
  for (const campo of ['cIndOp', 'CST', 'cClassTrib']) {
    if (!FORMATOS_IBSCBS[campo].test(v(campo))) {
      throw new Error(`Configure ${campo} de IBS/CBS da empresa (obrigatório para competência a partir de 10/2026)`)
    }
  }
  const cServ = filho(inf, 'serv/cServ')
  if (cServ && FORMATOS_IBSCBS.cNBS.test(v('cNBS'))) {
    remover(cServ, ['cNBS'])
    inserirAntes(cServ, novo('cNBS', v('cNBS')), ['cAtvSN', 'cIntContrib', 'xDescServ'])
  }
  const trib = novo('trib')
  trib.children = [novo('CST', v('CST')), novo('cClassTrib', v('cClassTrib'))]
  if (env.NFSE_GIBSCBS_VAZIO === '1') trib.children.push(novo('gIBSCBS'))
  const valores = novo('valores')
  valores.children = [trib]
  const ibscbs = novo('IBSCBS')
  ibscbs.children = [novo('cIndOp', v('cIndOp')), valores]
  remover(inf, ['IBSCBS'])
  inserirAntes(inf, ibscbs, [])
}

// empresa: { cnpj, codigoMunicipio, regraCompetencia,
//            servicoPadrao: { cTribNac, tribISSQN, tpRetISSQN, regApIBSCBSSN?, cAtvSN?,
//                             cIndOp?, CST?, cClassTrib?, cNBS? } }
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
  const grupos = gruposNt009(ambiente, emissao.data)
  if (Object.values(grupos).some(Boolean)) aplicarLeiauteNt009(inf, sp, grupos)
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

module.exports = {
  NS, VER_APLIC, CAMPOS_VARIAVEIS, CODIGOS_ATIVIDADE_SN, carregarGabarito, idDps, formatarValor, montarDps, folhas,
  dataHoraBrasilia, usaLeiauteNt009, gruposNt009, aplicarLeiauteNt009, aplicarIbsCbs, FORMATOS_IBSCBS,
}
