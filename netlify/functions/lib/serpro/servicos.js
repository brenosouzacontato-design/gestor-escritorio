// netlify/functions/lib/serpro/servicos.js
//
// Serviços do Integra Contador usados pelo gestor: monta os "dados" de cada pedido a partir do
// que a tela manda e interpreta a resposta. Só funções puras (testadas em __tests__/servicos.test.cjs,
// com respostas reais do ambiente de demonstração em __tests__/fixtures).
//
//   Recálculo de DARF  → SICALC  CONSOLIDARGERARDARF51 (Emitir, v2.9)
//   DAS do Simples     → PGDASD  GERARDAS12            (Emitir, v1.0)  com data de consolidação = recálculo
//   Parcelamentos SN/MEI → <sistema> PARCELASPARAGERARxxx (Consultar) e GERARDASxxx (Emitir), v1.0
//
// Códigos conferidos no catálogo de serviços da documentação em 25/11/2026.

const { ErroIntegra } = require('./integraContador')

const SERVICOS = {
  darf: { operacao: 'Emitir', idSistema: 'SICALC', idServico: 'CONSOLIDARGERARDARF51', versaoSistema: '2.9' },
  das: { operacao: 'Emitir', idSistema: 'PGDASD', idServico: 'GERARDAS12', versaoSistema: '1.0' },
}

// Parcelamentos do Simples Nacional e do MEI. Só pessoa jurídica (tipo 2).
const PARCELAMENTOS = {
  PARCSN: { nome: 'Parcelamento ordinário do Simples Nacional', n: 16 },
  'PARCSN-ESP': { nome: 'Parcelamento especial do Simples Nacional', n: 17 },
  PERTSN: { nome: 'Pert do Simples Nacional', n: 18 },
  RELPSN: { nome: 'Relp do Simples Nacional', n: 19 },
  PARCMEI: { nome: 'Parcelamento ordinário do MEI', n: 20 },
  'PARCMEI-ESP': { nome: 'Parcelamento especial do MEI', n: 21 },
  PERTMEI: { nome: 'Pert do MEI', n: 22 },
  RELPMEI: { nome: 'Relp do MEI', n: 23 },
}

function servicoParcelamento(sistema, qual) {
  const p = PARCELAMENTOS[sistema]
  if (!p) throw new ErroIntegra(`Parcelamento desconhecido: ${sistema}`)
  if (qual === 'parcelas') return { operacao: 'Consultar', idSistema: sistema, idServico: `PARCELASPARAGERAR${p.n}2`, versaoSistema: '1.0' }
  if (qual === 'emitir') return { operacao: 'Emitir', idSistema: sistema, idServico: `GERARDAS${p.n}1`, versaoSistema: '1.0' }
  throw new ErroIntegra(`Serviço de parcelamento desconhecido: ${qual}`)
}

// ---------------------------------------------------------------- utilidades
const digitos = (v) => String(v || '').replace(/\D/g, '')

function erro(msg) {
  return new ErroIntegra(msg, { status: 400 })
}

// "2026-03-10" → "2026-03-10T00:00:00"
function dataIso(v, campo) {
  const s = String(v || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T12:00:00Z'))) throw erro(`${campo} inválida (use AAAA-MM-DD)`)
  return `${s}T00:00:00`
}

// "03/2026" ou "2026-03" → { mes: '03', ano: '2026' }
function competencia(v, campo = 'Competência') {
  const s = String(v || '').trim()
  let m = s.match(/^(0[1-9]|1[0-2])\/(\d{4})$/)
  if (m) return { mes: m[1], ano: m[2] }
  m = s.match(/^(\d{4})-?(0[1-9]|1[0-2])$/)
  if (m) return { mes: m[2], ano: m[1] }
  throw erro(`${campo} inválida (use MM/AAAA)`)
}

function valor(v, campo) {
  const n = typeof v === 'number' ? v : Number(String(v || '').replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) throw erro(`${campo} inválido`)
  return n.toFixed(2)
}

// PDF em base64 → Buffer, conferindo que é PDF mesmo
function pdfDe(b64, onde) {
  if (!b64 || typeof b64 !== 'string') throw new ErroIntegra(`O SERPRO não devolveu o PDF (${onde}).`)
  const buf = Buffer.from(b64, 'base64')
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new ErroIntegra(`O arquivo devolvido pelo SERPRO não é PDF (${onde}).`)
  return buf
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const aaaammdd = (s) => (/^\d{8}$/.test(String(s || '')) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)
const isoData = (s) => (s ? String(s).slice(0, 10) : null)

// ---------------------------------------------------------------- DARF (Sicalc)
// Tipo e formato do período de apuração (Sicalc → Dados de domínio)
const MES = '(0[1-9]|1[0-2])'
const TIPOS_PA = {
  ME: { nome: 'mensal', exemplo: 'MM/AAAA', formato: new RegExp(`^${MES}/\\d{4}$`) },
  TR: { nome: 'trimestral', exemplo: 'T/AAAA com T de 01 a 04', formato: /^0[1-4]\/\d{4}$/ },
  AN: { nome: 'anual', exemplo: 'AAAA', formato: /^\d{4}$/ },
  QZ: { nome: 'quinzenal', exemplo: 'QQ/MM/AAAA com QQ 01 ou 02', formato: new RegExp(`^0[12]/${MES}/\\d{4}$`) },
  DC: { nome: 'decendial', exemplo: 'DD/MM/AAAA com DD de 01 a 03', formato: new RegExp(`^0[1-3]/${MES}/\\d{4}$`) },
  SM: { nome: 'semanal', exemplo: 'SS/MM/AAAA com SS de 01 a 05', formato: new RegExp(`^0[1-5]/${MES}/\\d{4}$`) },
  DI: { nome: 'diário', exemplo: 'DD/MM/AAAA', formato: new RegExp(`^(0[1-9]|[12]\\d|3[01])/${MES}/\\d{4}$`) },
}

// form: { codigo_receita: '0220-01' | '0220' + extensao, tipo_pa ('ME','TR','AN',...), periodo ('MM/AAAA' ou 'AAAA'),
//         vencimento ('AAAA-MM-DD') ou cota, valor, data_consolidacao ('AAAA-MM-DD'), uf?, municipio? (código TOM), observacao?,
//         numero_referencia? }
function dadosDarf(form) {
  const f = form || {}
  const [rec, extDoCodigo] = String(f.codigo_receita || '').split(/[-/ ]/)
  const codigoReceita = digitos(rec)
  const codigoReceitaExtensao = digitos(f.extensao || extDoCodigo || '01').padStart(2, '0')
  if (!/^\d{4}$/.test(codigoReceita)) throw erro('Código da receita inválido (ex.: 0220 ou 0220-01)')
  const tipoPA = String(f.tipo_pa || 'ME').toUpperCase()
  if (!TIPOS_PA[tipoPA]) throw erro(`Tipo de período inválido: ${tipoPA}`)
  let dataPA = String(f.periodo || '').trim()
  if (tipoPA === 'ME') { const c = competencia(dataPA, 'Período de apuração'); dataPA = `${c.mes}/${c.ano}` }
  else if (!TIPOS_PA[tipoPA].formato.test(dataPA)) throw erro(`Período de apuração inválido para ${TIPOS_PA[tipoPA].nome} (use ${TIPOS_PA[tipoPA].exemplo})`)
  const d = { codigoReceita, codigoReceitaExtensao, tipoPA, dataPA, valorImposto: valor(f.valor, 'Valor do imposto') }
  if (f.cota && f.vencimento) throw erro('Informe o vencimento OU a cota, não os dois')
  if (f.cota) d.cota = String(Number(f.cota))
  else if (f.vencimento) d.vencimento = dataIso(f.vencimento, 'Data de vencimento')
  else throw erro('Informe o vencimento original (ou a cota)')
  d.dataConsolidacao = dataIso(f.data_consolidacao, 'Data de pagamento (consolidação)')
  if (f.uf) d.uf = String(f.uf).toUpperCase().slice(0, 2)
  if (f.municipio) d.municipio = String(digitos(f.municipio))
  if (f.numero_referencia) d.numeroReferencia = String(digitos(f.numero_referencia))
  if (f.observacao) d.observacao = String(f.observacao).slice(0, 200)
  return d
}

function resultadoDarf(dados) {
  const c = (dados && dados.consolidado) || {}
  return {
    pdf: pdfDe(dados && dados.darf, 'DARF'),
    numero_documento: (dados && dados.numeroDocumento) || null,
    pix: (dados && dados.qrCode) || null,
    principal: num(c.valorPrincipalMoedaCorrente),
    multa: num(c.valorMultaMora),
    juros: num(c.valorJuros),
    total: num(c.valorTotalConsolidado),
    validade: isoData(c.dataValidadeCalculo),
    data_consolidacao: isoData(c.dataArrecadacaoConsolidacao),
  }
}

// ---------------------------------------------------------------- DAS (PGDAS-D)
// form: { periodo: 'MM/AAAA', data_consolidacao?: 'AAAA-MM-DD' (pagar depois do vencimento = recálculo) }
// O PGDAS-D só aceita data de consolidação FUTURA ("anterior/igual à data atual" é recusada,
// EntradaIncorreta-PGDASD-MSG_ISN_002). Hoje ou antes: manda sem a data, que é o DAS para pagar hoje.
const hojeBrasilia = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

function dadosDas(form, hoje = hojeBrasilia()) {
  const f = form || {}
  const c = competencia(f.periodo, 'Período de apuração')
  const d = { periodoApuracao: `${c.ano}${c.mes}` }
  if (f.data_consolidacao) {
    const data = dataIso(f.data_consolidacao, 'Data de pagamento').slice(0, 10)
    if (data > hoje) d.dataConsolidacao = data.replace(/-/g, '')
  }
  return d
}

function resultadoDas(dados) {
  const das = Array.isArray(dados) ? dados[0] : dados
  if (!das) throw new ErroIntegra('O SERPRO não devolveu o DAS.')
  const det = das.detalhamentoDas || das.detalhamento || {}
  const v = det.valores || {}
  return {
    pdf: pdfDe(das.pdf, 'DAS'),
    numero_documento: det.numeroDocumento || null,
    principal: num(v.principal),
    multa: num(v.multa),
    juros: num(v.juros),
    total: num(v.total),
    vencimento: aaaammdd(det.dataVencimento),
    validade: aaaammdd(det.dataLimiteAcolhimento),
    observacoes: [det.observacao1, det.observacao2, det.observacao3].filter(Boolean),
  }
}

// ---------------------------------------------------------------- parcelamentos
// A documentação chama de "listaParcela"; o serviço devolve "listaParcelas". Aceita os dois.
function resultadoParcelas(dados) {
  const lista = (dados && (dados.listaParcelas || dados.listaParcela)) || []
  return lista
    .map((p) => ({ parcela: String(p.parcela), valor: num(p.valor) }))
    .filter((p) => /^\d{6}$/.test(p.parcela))
    .sort((a, b) => a.parcela.localeCompare(b.parcela))
}

function dadosParcela(parcela) {
  const c = competencia(parcela, 'Parcela')
  return { parcelaParaEmitir: Number(`${c.ano}${c.mes}`) }
}

function resultadoDasParcela(dados) {
  return { pdf: pdfDe(dados && dados.docArrecadacaoPdfB64, 'DAS do parcelamento') }
}

// "202306" → "06/2023"
const parcelaBr = (p) => `${String(p).slice(4, 6)}/${String(p).slice(0, 4)}`

module.exports = {
  SERVICOS, PARCELAMENTOS, TIPOS_PA, servicoParcelamento,
  dadosDarf, resultadoDarf, dadosDas, resultadoDas, resultadoParcelas, dadosParcela, resultadoDasParcela,
  parcelaBr, competencia,
}
