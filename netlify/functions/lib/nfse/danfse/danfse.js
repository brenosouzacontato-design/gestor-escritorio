// netlify/functions/lib/nfse/danfse/danfse.js
//
// DANFSe v2.0 em PDF a partir do XML da NFS-e autorizada (xml_retorno), no layout da
// Nota Técnica SE/CGNFS-e nº 008/2026 v1.02 (Anexo I). A API pública de DANFSe do Ambiente
// Nacional (adn.nfse.gov.br/danfse) foi suspensa em 03/08/2026 e a NT passou a geração para o
// software emissor.
//
// O que segue a NT: A4 retrato em uma página, grade de 4 colunas com as posições/tamanhos do
// item 2.4.5, títulos de bloco 7pt negrito em caixa alta, rótulos 6pt negrito, conteúdo 7pt,
// sombreamento 5% no cabeçalho/títulos/"Emitente"/"Valor líquido + IBS/CBS", linhas de 0,5pt e
// borda de 1pt, logomarca da NFS-e, QR Code da consulta pública em X 17,48 / Y 1,67 cm,
// "NFS-e SEM VALIDADE JURÍDICA" em vermelho para tpAmb = 2, supressões permitidas (blocos não
// identificados, linhas sem dado), traço (-) em campo sem informação e reticências quando não cabe.
// Só imprime o que está no XML (item 2.1).
//
// Diferença consciente: a NT pede Arial (rótulos) e Microsoft Sans Serif (conteúdo). As fontes
// não podem ir no pacote, então usa Helvetica, a fonte padrão do PDF com as mesmas métricas da Arial.

const { PDFDocument, StandardFonts, rgb, degrees } = require('@cantoo/pdf-lib')
const QRCode = require('qrcode')
const { lerElemento, filho } = require('../xml')
const LOGO = require('./logoNfse')

const CM = 72 / 2.54
const A4 = { w: 21 * CM, h: 29.7 * CM }
const COL = [0.30, 5.41, 10.51, 15.62]
const LARG = 5.09
const LARG2 = 10.19
const LARG_TOTAL = 20.40
const CINZA = rgb(0.95, 0.95, 0.95) // 5% de densidade
const PRETO = rgb(0, 0, 0)
const VERMELHO = rgb(1, 0, 0) // M100/Y100
const MARCA = rgb(0.65, 0.65, 0.65) // K35
const URL_CONSULTA = 'https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave='
const INICIO_CANHOTO = 28.10
const ALT_LINHA = 0.645
const ALT_SUPRIMIDO = 0.32

// ---------- descrições das tabelas do leiaute ----------

const TP_EMIT = { 1: 'Prestador', 2: 'Tomador', 3: 'Intermediário' }
const C_STAT = {
  100: 'NFS-e Gerada', 101: 'NFS-e de Substituição Gerada',
  102: 'NFS-e de Decisão Judicial ou Administrativa', 103: 'NFS-e Avulsa',
}
const FIN_NFSE = { 0: 'NFS-e regular' }
const AMB_GER = { 1: 'Prefeitura', 2: 'Sistema Nacional NFS-e' }
const TP_AMB = { 1: 'Produção', 2: 'Homologação' }
const OP_SIMP_NAC = { 1: 'Não Optante', 2: 'Optante - Microempreendedor Individual (MEI)', 3: 'Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)' }
const REG_AP_TRIB_SN = {
  1: 'Regime de apuração dos tributos federais e municipal pelo Simples Nacional',
  2: 'Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legislação municipal do tributo',
  3: 'Regime de apuração dos tributos federais e municipal pela NFS-e conforme respectivas legislações federal e municipal de cada tributo',
}
const REG_ESP_TRIB = {
  0: 'Nenhum', 1: 'Ato Cooperado (Cooperativa)', 2: 'Estimativa', 3: 'Microempresa Municipal',
  4: 'Notário ou Registrador', 5: 'Profissional Autônomo', 6: 'Sociedade de Profissionais', 9: 'Outros',
}
const TRIB_ISSQN = { 1: 'Operação Tributável', 2: 'Imunidade', 3: 'Exportação de Serviço', 4: 'Não Incidência' }
const TP_RET_ISSQN = { 1: 'Não Retido', 2: 'Retido pelo Tomador', 3: 'Retido pelo Intermediário' }
const TP_IMUNIDADE = {
  1: 'Patrimônio, renda ou serviços, uns dos outros (CF88, Art 150, VI, a)',
  2: 'Templos de qualquer culto (CF88, Art 150, VI, b)',
  3: 'Patrimônio, renda ou serviços dos partidos políticos, inclusive suas fundações, das entidades sindicais dos trabalhadores, das instituições de educação e de assistência social, sem fins lucrativos (CF88, Art 150, VI, c)',
  4: 'Livros, jornais, periódicos e o papel destinado a sua impressão (CF88, Art 150, VI, d)',
  5: 'Fonogramas e videofonogramas musicais produzidos no Brasil (CF88, Art 150, VI, e)',
}
const TP_SUSP = { 1: 'Exigibilidade Suspensa por Decisão Judicial', 2: 'Exigibilidade Suspensa por Processo Administrativo' }
const TP_BM = { 1: 'Alíquota Diferenciada', 2: 'Redução da BC', 3: 'Isenção' }

// Código IBGE do município: os 2 primeiros dígitos são a UF.
const UF_IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN',
  25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC',
  43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
}

// ---------- leitura do XML ----------

function lerNfse(xml) {
  const raiz = lerElemento(xml, 'NFSe')
  const inf = filho(raiz, 'infNFSe')
  if (!inf) throw new Error('XML sem <infNFSe>: não é uma NFS-e autorizada')
  const infDPS = filho(inf, 'DPS/infDPS')
  if (!infDPS) throw new Error('XML da NFS-e sem a DPS')
  const id = (inf.attrs.find(([n]) => n === 'Id') || [])[1] || ''
  return { inf, infDPS, chave: id.replace(/^NFS/, '') }
}

const txt = (no, caminho) => {
  const n = no && filho(no, caminho)
  return n && n.text.trim() ? n.text.trim() : ''
}

// ---------- formatação ----------

const TRACO = '-'
const ou = (v) => (v === '' || v == null ? TRACO : v)

function documento(no) {
  const cnpj = txt(no, 'CNPJ'); const cpf = txt(no, 'CPF'); const nif = txt(no, 'NIF')
  if (cnpj.length === 14) return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (cpf.length === 11) return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return nif || cnpj || cpf || ''
}

function dinheiro(v) {
  if (v === '' || v == null) return TRACO
  const n = Number(v)
  if (!Number.isFinite(n)) return TRACO
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function percentual(v) {
  if (v === '' || v == null) return TRACO
  const n = Number(v)
  if (!Number.isFinite(n)) return TRACO
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

// "2026-10-15T13:15:46-03:00" → "15/10/2026 13:15:46" (hora local que está no próprio XML)
function dataHora(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(v || '')
  if (!m) return ou(v)
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}:${m[6]}` : ''}`
}

const cep = (v) => (/^\d{8}$/.test(v) ? v.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : v)
const codTribNac = (v) => (/^\d{6}$/.test(v) ? v.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : v)
const descricao = (tabela, codigo) => (codigo === '' ? TRACO : tabela[codigo] || codigo)

// ---------- municípios ----------

// Nome do município pelo código IBGE: primeiro os nomes que já vêm no XML da NFS-e
// (emissão, prestação, incidência); senão a API de localidades do IBGE; senão o próprio código.
async function criarNomesMunicipio(inf, infDPS, buscar) {
  const conhecidos = new Map()
  const juntar = (cod, nome) => { if (cod && nome) conhecidos.set(cod, nome) }
  juntar(txt(infDPS, 'cLocEmi'), txt(inf, 'xLocEmi'))
  juntar(txt(infDPS, 'serv/locPrest/cLocPrestacao'), txt(inf, 'xLocPrestacao'))
  juntar(txt(inf, 'cLocIncid'), txt(inf, 'xLocIncid'))
  juntar(txt(infDPS, 'valores/trib/tribMun/cLocIncid'), txt(inf, 'xLocIncid'))
  const pendentes = new Set()
  return {
    async carregar(codigos) {
      for (const c of codigos) if (c && !conhecidos.has(c)) pendentes.add(c)
      await Promise.all([...pendentes].map(async (c) => {
        const nome = buscar ? await buscar(c).catch(() => null) : null
        if (nome) conhecidos.set(c, nome)
      }))
    },
    nome: (cod) => conhecidos.get(cod) || cod,
    comUf: (cod) => (cod ? `${conhecidos.get(cod) || cod} / ${UF_IBGE[String(cod).slice(0, 2)] || '-'}` : TRACO),
  }
}

async function buscarMunicipioIbge(codigo) {
  const controle = new AbortController()
  const tempo = setTimeout(() => controle.abort(), 3000)
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${encodeURIComponent(codigo)}`, { signal: controle.signal })
    if (!r.ok) return null
    const j = await r.json()
    return (j && j.nome) || null
  } finally {
    clearTimeout(tempo)
  }
}

// ---------- montagem ----------

// Monta os dados de cada campo do DANFSe a partir do XML (separado do desenho para os testes).
async function extrairCampos(xml, { buscarMunicipio = buscarMunicipioIbge } = {}) {
  const { inf, infDPS, chave } = lerNfse(xml)
  const prest = filho(infDPS, 'prest')
  const emit = filho(inf, 'emit')
  const toma = filho(infDPS, 'toma')
  const interm = filho(infDPS, 'interm')
  const ibscbsDps = filho(infDPS, 'IBSCBS')
  const dest = ibscbsDps && filho(ibscbsDps, 'dest')
  const ibscbsNfse = filho(inf, 'IBSCBS')
  const valNfse = filho(inf, 'valores')
  const valDps = filho(infDPS, 'valores')
  const tribMun = valDps && filho(valDps, 'trib/tribMun')
  const tribFed = valDps && filho(valDps, 'trib/tribFed')
  const piscofins = tribFed && filho(tribFed, 'piscofins')
  const cServ = filho(infDPS, 'serv/cServ')

  // Prestador: a DPS do emissor só leva CNPJ e regime; nome e endereço vêm de infNFSe/emit,
  // que é a mesma pessoa quando tpEmit = 1 (prestador).
  const tpEmit = txt(infDPS, 'tpEmit')
  const fontePrest = (campo) => txt(prest, campo) || (tpEmit === '1' || !tpEmit ? txt(emit, campo) : '')
  const endPrest = filho(prest, 'end') || (tpEmit === '1' ? emit : null)
  const endNacPrest = endPrest && (filho(endPrest, 'endNac') || filho(endPrest, 'enderNac'))

  const ends = [endNacPrest, toma && filho(toma, 'end/endNac'), dest && filho(dest, 'end/endNac'), interm && filho(interm, 'end/endNac')]
  const municipios = await criarNomesMunicipio(inf, infDPS, buscarMunicipio)
  await municipios.carregar([txt(infDPS, 'cLocEmi'), ...ends.map((e) => txt(e, 'cMun'))])

  const pessoa = (no, endNo, extra = {}) => {
    const endNac = endNo && (filho(endNo, 'endNac') || filho(endNo, 'enderNac'))
    const endExt = endNo && filho(endNo, 'endExt')
    const cMun = txt(endNac, 'cMun')
    // na DPS logradouro/número ficam em end/; no emit da NFS-e, dentro de enderNac/
    const parte = (c) => txt(endNo, c) || txt(endNac, c)
    const end = endNo && ['xLgr', 'nro', 'xCpl', 'xBairro'].map(parte).filter(Boolean).join(', ')
    return {
      doc: ou(documento(no)),
      im: ou(txt(no, 'IM')),
      fone: ou(txt(no, 'fone')),
      nome: ou(txt(no, 'xNome')),
      municipio: cMun ? municipios.comUf(cMun) : ou(txt(endExt, 'xCidade')),
      ibgeCep: cMun ? `${cMun} / ${cep(txt(endNac, 'CEP')) || TRACO}` : (endExt ? ou(txt(endExt, 'cEndPost')) : TRACO),
      endereco: ou(end),
      email: ou(txt(no, 'email')),
      ...extra,
    }
  }

  const prestador = pessoa(prest, endPrest, {
    doc: ou(documento(prest) || documento(emit)),
    im: ou(fontePrest('IM')),
    fone: ou(fontePrest('fone')),
    nome: ou(fontePrest('xNome')),
    email: ou(fontePrest('email')),
    simples: descricao(OP_SIMP_NAC, txt(prest, 'regTrib/opSimpNac')),
    regimeSN: descricao(REG_AP_TRIB_SN, txt(prest, 'regTrib/regApTribSN')),
  })
  if (endNacPrest) {
    const cMun = txt(endNacPrest, 'cMun')
    prestador.municipio = cMun ? municipios.comUf(cMun) : TRACO
    prestador.ibgeCep = cMun ? `${cMun} / ${cep(txt(endNacPrest, 'CEP')) || TRACO}` : TRACO
  }

  const cLocEmi = txt(infDPS, 'cLocEmi')
  const cTribNac = txt(cServ, 'cTribNac')
  const cLocPrest = txt(infDPS, 'serv/locPrest/cLocPrestacao')
  const cPaisPrest = txt(infDPS, 'serv/locPrest/cPaisPrestacao')
  const cLocIncid = txt(inf, 'cLocIncid')

  // Contribuições sociais retidas: com PIS/COFINS retido (tpRetPisCofins = 1) soma CSLL + PIS +
  // COFINS e os débitos de apuração própria vão a zero (NT, 2.4.5).
  const tpRetPisCofins = txt(piscofins, 'tpRetPisCofins')
  const vPis = txt(piscofins, 'vPis'); const vCofins = txt(piscofins, 'vCofins'); const vCsll = txt(tribFed, 'vRetCSLL')
  const pisRetido = tpRetPisCofins === '1'
  const somar = (...vs) => (vs.some((v) => v !== '') ? vs.reduce((s, v) => s + (Number(v) || 0), 0) : '')

  const vIBSTot = txt(ibscbsNfse, 'totCIBS/gIBS/vIBSTot')
  const vCBS = txt(ibscbsNfse, 'totCIBS/gCBS/vCBS')

  const competencia = txt(infDPS, 'dCompet')
  const anoCompetencia = Number((competencia || '').slice(0, 4)) || 0

  return {
    chave,
    ambiente: txt(infDPS, 'tpAmb'),
    cabecalho: {
      // item 99 do código de tributação nacional não exibe o município (NT, 2.4.5)
      municipio: cTribNac.slice(0, 2) === '99' ? '' : `Município: ${txt(inf, 'xLocEmi') || municipios.nome(cLocEmi)} / ${UF_IBGE[cLocEmi.slice(0, 2)] || txt(emit, 'enderNac/UF') || '-'}`,
      ambienteGerador: `Ambiente Gerador: ${descricao(AMB_GER, txt(inf, 'ambGer'))}`,
      tipoAmbiente: `Tipo de Ambiente: ${descricao(TP_AMB, txt(infDPS, 'tpAmb'))}`,
    },
    identificacao: {
      numero: ou(txt(inf, 'nNFSe')),
      competencia: dataHora(competencia),
      dhProc: dataHora(txt(inf, 'dhProc')),
      nDPS: ou(txt(infDPS, 'nDPS')),
      serie: ou(txt(infDPS, 'serie')),
      dhEmi: dataHora(txt(infDPS, 'dhEmi')),
      emitente: descricao(TP_EMIT, tpEmit),
      situacao: descricao(C_STAT, txt(inf, 'cStat')),
      finalidade: descricao(FIN_NFSE, txt(ibscbsDps, 'finNFSe')),
    },
    prestador,
    tomador: toma ? pessoa(toma, filho(toma, 'end')) : null,
    destinatario: dest ? pessoa(dest, filho(dest, 'end')) : null,
    destinatarioEhTomador: !!ibscbsDps && !dest,
    intermediario: interm ? pessoa(interm, filho(interm, 'end')) : null,
    servico: {
      codigo: ou([codTribNac(cTribNac), txt(cServ, 'cTribMun')].filter(Boolean).join(' / ')),
      nbs: ou(txt(cServ, 'cNBS')),
      local: cLocPrest
        ? `${txt(inf, 'xLocPrestacao') || municipios.nome(cLocPrest)} / ${UF_IBGE[cLocPrest.slice(0, 2)] || '-'} / BR`
        : ou(cPaisPrest),
      descricaoCodigo: ou(txt(inf, 'xTribMun') || txt(inf, 'xTribNac')),
      descricao: ou(txt(cServ, 'xDescServ')),
    },
    issqn: tribMun ? {
      tipo: descricao(TRIB_ISSQN, txt(tribMun, 'tribISSQN')),
      incidencia: cLocIncid ? `${txt(inf, 'xLocIncid') || municipios.nome(cLocIncid)} / ${UF_IBGE[cLocIncid.slice(0, 2)] || '-'} / BR` : ou(txt(tribMun, 'cPaisResult')),
      regimeEspecial: descricao(REG_ESP_TRIB, txt(prest, 'regTrib/regEspTrib')),
      imunidade: descricao(TP_IMUNIDADE, txt(tribMun, 'tpImunidade')),
      suspensao: descricao(TP_SUSP, txt(tribMun, 'exigSusp/tpSusp')),
      processo: ou(txt(tribMun, 'exigSusp/nProcesso')),
      beneficio: descricao(TP_BM, txt(valNfse, 'tpBM')),
      calculoBM: dinheiro(txt(valNfse, 'vCalcBM') || txt(tribMun, 'BM/vRedBCBM')),
      deducoes: dinheiro(txt(valDps, 'vDedRed/vDR') || somar(txt(valNfse, 'vCalcDR'), txt(ibscbsNfse, 'valores/vCalcReeRepRes'))),
      descontoIncond: dinheiro(txt(valDps, 'vDescCondIncond/vDescIncond')),
      bc: dinheiro(txt(valNfse, 'vBC')),
      aliquota: percentual(txt(valNfse, 'pAliqAplic')),
      retencao: descricao(TP_RET_ISSQN, txt(tribMun, 'tpRetISSQN')),
      apurado: dinheiro(txt(valNfse, 'vISSQN')),
      // linhas 2 e 3 do bloco podem sumir quando não há nenhum dado nelas (NT, nota 5)
      temLinha2: ['regTrib/regEspTrib'].some((c) => txt(prest, c) && txt(prest, c) !== '0')
        || !!(txt(tribMun, 'tpImunidade') || txt(tribMun, 'exigSusp/tpSusp') || txt(tribMun, 'exigSusp/nProcesso')),
      temLinha3: !!(txt(valNfse, 'tpBM') || txt(valNfse, 'vCalcBM') || txt(tribMun, 'BM/vRedBCBM') || txt(valDps, 'vDedRed/vDR')
        || txt(valNfse, 'vCalcDR') || txt(valDps, 'vDescCondIncond/vDescIncond')),
    } : null,
    federal: {
      irrf: dinheiro(txt(tribFed, 'vRetIRRF')),
      cp: dinheiro(txt(tribFed, 'vRetCP')),
      csRetidas: dinheiro(pisRetido ? somar(vCsll, vPis, vCofins) : vCsll),
      pis: dinheiro(pisRetido ? '0' : vPis),
      cofins: dinheiro(pisRetido ? '0' : vCofins),
      descricaoCs: tpRetPisCofins ? `Código ${tpRetPisCofins}` : TRACO,
      // até o fim de 2026 (NT, nota 6)
      mostrarPisCofins: anoCompetencia <= 2026,
    },
    ibscbs: {
      cst: ou([txt(ibscbsDps, 'valores/trib/gIBSCBS/CST'), txt(ibscbsDps, 'valores/trib/gIBSCBS/cClassTrib')].filter(Boolean).join(' / ')),
      operacao: ou([txt(ibscbsDps, 'cIndOp'), txt(ibscbsNfse, 'cLocalidadeIncid'), txt(ibscbsNfse, 'xLocalidadeIncid')].filter(Boolean).join(' / ')),
      exclusoes: dinheiro(somar(txt(valDps, 'vDescCondIncond/vDescIncond'), txt(ibscbsNfse, 'valores/vCalcReeRepRes'),
        ibscbsNfse ? txt(valNfse, 'vISSQN') : '', ibscbsNfse ? vPis : '', ibscbsNfse ? vCofins : '')),
      bc: dinheiro(txt(ibscbsNfse, 'valores/vBC')),
      reducoes: ibscbsNfse ? [txt(ibscbsNfse, 'valores/uf/pRedAliqUF'), txt(ibscbsNfse, 'valores/mun/pRedAliqMun'), txt(ibscbsNfse, 'valores/fed/pRedAliqCBS')].map(percentual).join(' / ') : TRACO,
      aliquotas: ibscbsNfse ? [txt(ibscbsNfse, 'valores/uf/pIBSUF'), txt(ibscbsNfse, 'valores/mun/pIBSMun')].map(percentual).join(' / ') : TRACO,
      efetivaMun: percentual(txt(ibscbsNfse, 'valores/mun/pAliqEfetMun')),
      vIBSMun: dinheiro(txt(ibscbsNfse, 'totCIBS/gIBS/gIBSMunTot/vIBSMun')),
      efetivaUF: percentual(txt(ibscbsNfse, 'valores/uf/pAliqEfetUF')),
      vIBSUF: dinheiro(txt(ibscbsNfse, 'totCIBS/gIBS/gIBSUFTot/vIBSUF')),
      vIBSTot: dinheiro(vIBSTot),
      pCBS: percentual(txt(ibscbsNfse, 'valores/fed/pCBS')),
      efetivaCBS: percentual(txt(ibscbsNfse, 'valores/fed/pAliqEfetCBS')),
      vCBS: dinheiro(vCBS),
    },
    totais: {
      servico: dinheiro(txt(valDps, 'vServPrest/vServ')),
      descontoIncond: dinheiro(txt(valDps, 'vDescCondIncond/vDescIncond')),
      descontoCond: dinheiro(txt(valDps, 'vDescCondIncond/vDescCond')),
      retencoes: dinheiro(txt(valNfse, 'vTotalRet')),
      liquido: dinheiro(txt(valNfse, 'vLiq')),
      ibscbs: dinheiro(somar(vIBSTot, vCBS)),
      liquidoComIbsCbs: dinheiro(txt(ibscbsNfse, 'totCIBS/vTotNF')),
    },
    complementares: informacoesComplementares(inf, infDPS),
    canhoto: `${ou(txt(inf, 'nNFSe'))} / ${chave}`,
  }
}

// União das informações complementares, na ordem e com os prefixos da NT, separadas por "|".
// A linha de totais aproximados de tributos é obrigatória e vai sempre por último.
function informacoesComplementares(inf, infDPS) {
  const partes = []
  const add = (rotulo, valor) => { if (valor) partes.push(`${rotulo} ${valor}`) }
  const infoCompl = filho(infDPS, 'serv/infoCompl')
  add('Inf. Cont.:', txt(infoCompl, 'xInfComp'))
  add('NFS-e Subst.:', txt(infDPS, 'subst/chSubstda'))
  add('Doc. Ref.:', txt(infoCompl, 'docRef'))
  add('Cod. Obra:', txt(infDPS, 'serv/obra/cObra'))
  add('Insc. Imob.:', txt(infDPS, 'serv/obra/inscImobFisc') || txt(infDPS, 'IBSCBS/imovel/inscImobFisc'))
  add('Cod. Evt.:', txt(infDPS, 'serv/atvEvento/idAtvEvt'))
  add('Doc. Tec.:', txt(infoCompl, 'idDocTec'))
  add('Núm. Ped.:', txt(infoCompl, 'xPed'))
  add('Item Ped.:', (filho(infoCompl, 'gItemPed') || { children: [] }).children.map((c) => c.text.trim()).filter(Boolean).join(', '))
  add('Inf. A. T. Mun.:', txt(inf, 'xOutInf'))

  const totTrib = filho(infDPS, 'valores/trib/totTrib')
  let totais = 'Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: '
  if (filho(totTrib, 'vTotTrib')) {
    totais += `Federais: ${dinheiro(txt(totTrib, 'vTotTrib/vTotTribFed'))}; Estaduais: ${dinheiro(txt(totTrib, 'vTotTrib/vTotTribEst'))}; Municipais: ${dinheiro(txt(totTrib, 'vTotTrib/vTotTribMun'))}`
  } else if (filho(totTrib, 'pTotTrib')) {
    totais += `Federais: ${percentual(txt(totTrib, 'pTotTrib/pTotTribFed'))}; Estaduais: ${percentual(txt(totTrib, 'pTotTrib/pTotTribEst'))}; Municipais: ${percentual(txt(totTrib, 'pTotTrib/pTotTribMun'))}`
  } else if (txt(totTrib, 'pTotTribSN')) {
    totais += `Simples Nacional: ${percentual(txt(totTrib, 'pTotTribSN'))}`
  } else {
    totais += 'Não informado'
  }
  return { texto: partes.join(' | '), totais }
}

// ---------- desenho ----------

async function gerarDanfse(xml, opcoes = {}) {
  const campos = await extrairCampos(xml, opcoes)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`DANFSe ${campos.identificacao.numero} - ${campos.chave}`)
  pdf.setCreator('Gestor Escritório Contábil')
  pdf.setProducer('Gestor Escritório Contábil')
  const pagina = pdf.addPage([A4.w, A4.h])
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)
  const d = criarDesenho(pagina, normal, negrito)

  // borda da página (1pt) e cabeçalho
  d.retangulo(0.20, 0.20, 20.60, 29.30, { borda: 1 })
  d.retangulo(0.30, 0.30, LARG_TOTAL, 1.16, { fundo: CINZA })
  const logo = await pdf.embedPng(LOGO)
  const altLogo = Math.min(0.85, 4.0 * logo.height / logo.width)
  d.imagem(logo, 0.49, 0.44 + (0.85 - altLogo) / 2, 4.0, altLogo)
  const titulo = ['DANFSe v2.0', 'Documento Auxiliar da NFS-e']
  const homologacao = campos.ambiente === '2'
  const topoTitulo = homologacao ? 0.30 + 0.36 : 0.30 + 0.48
  titulo.forEach((t, i) => d.textoCentro(t, 5.41, LARG2, topoTitulo + i * 0.33, { fonte: negrito, tam: 9 }))
  if (homologacao) d.textoCentro('NFS-e SEM VALIDADE JURÍDICA', 5.41, LARG2, topoTitulo + 0.66, { fonte: negrito, tam: 9, cor: VERMELHO })
  if (campos.cabecalho.municipio) d.texto(campos.cabecalho.municipio, 15.70, 0.30 + 0.40, { tam: 8, largura: 4.95 })
  d.texto(campos.cabecalho.ambienteGerador, 15.70, 0.97 + 0.17, { tam: 6, largura: 4.95 })
  d.texto(campos.cabecalho.tipoAmbiente, 15.70, 1.22 + 0.17, { tam: 6, largura: 4.95 })
  d.linha(1.47)

  // identificação da NFS-e (rótulos 7pt em caixa alta)
  const id = campos.identificacao
  const rotulo7 = { tamRotulo: 7 }
  d.campo('CHAVE DE ACESSO DA NFS-E', campos.chave, COL[0], 1.48, 15.30, rotulo7)
  d.campo('NÚMERO DA NFS-E', id.numero, COL[0], 2.27, LARG, rotulo7)
  d.campo('COMPETÊNCIA DA NFS-E', id.competencia, COL[1], 2.27, LARG, rotulo7)
  d.campo('DATA E HORA DA EMISSÃO DA NFS-E', id.dhProc, COL[2], 2.27, LARG, rotulo7)
  d.campo('NÚMERO DA DPS', id.nDPS, COL[0], 2.96, LARG, rotulo7)
  d.campo('SÉRIE DA DPS', id.serie, COL[1], 2.96, LARG, rotulo7)
  d.campo('DATA E HORA DA EMISSÃO DA DPS', id.dhEmi, COL[2], 2.96, LARG, rotulo7)
  d.retangulo(COL[0], 3.65, LARG, 0.67, { fundo: CINZA })
  d.campo('EMITENTE DA NFS-E', id.emitente, COL[0], 3.65, LARG, rotulo7)
  d.campo('SITUAÇÃO DA NFS-E', id.situacao, COL[1], 3.65, LARG, rotulo7)
  d.campo('FINALIDADE', id.finalidade, COL[2], 3.65, LARG, rotulo7)
  await d.qrCode(URL_CONSULTA + campos.chave, 17.48, 1.67, 1.52)
  d.quebrar('A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e', 4.62, normal, 6)
    .forEach((l, i) => d.textoCentro(l, 15.80, 4.72, 3.36 + 0.20 + i * 0.22, { tam: 6 }))
  d.linha(4.33)

  // ---- blocos em fluxo: a altura que sobra vai para a descrição do serviço e as informações complementares
  const blocos = []
  const blocoPessoa = (tituloBloco, p, { semIm = false, extra = null } = {}) => ({
    linhas: [
      [titulo1(tituloBloco), ['CNPJ / CPF / NIF', p.doc, 1], semIm ? null : ['Indicador Municipal (Inscrição)', p.im, 2], ['Telefone', p.fone, 3]],
      [['Nome / Nome Empresarial', p.nome, 0, LARG2], ['Município / Sigla UF', p.municipio, 2], ['Código IBGE / CEP', p.ibgeCep, 3]],
      [['Endereço', p.endereco, 0, LARG2], ['E-mail', p.email, 2, LARG2]],
      ...(extra ? [extra] : []),
    ],
  })
  const suprimido = (mensagem) => ({ suprimido: mensagem })

  blocos.push(blocoPessoa('PRESTADOR / FORNECEDOR', campos.prestador, {
    extra: [['Simples Nacional na Data de Competência', campos.prestador.simples, 0], ['Regime de Apuração Tributária pelo SN', campos.prestador.regimeSN, 1, LARG2 + LARG + 0.02]],
  }))
  blocos.push(campos.tomador ? blocoPessoa('TOMADOR / ADQUIRENTE', campos.tomador) : suprimido('TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e'))
  blocos.push(campos.destinatario
    ? blocoPessoa('DESTINATÁRIO DA OPERAÇÃO', campos.destinatario, { semIm: true })
    : suprimido(campos.destinatarioEhTomador ? 'O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO' : 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e'))
  blocos.push(campos.intermediario ? blocoPessoa('INTERMEDIÁRIO DA OPERAÇÃO', campos.intermediario) : suprimido('INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e'))

  const s = campos.servico
  blocos.push({
    linhas: [[titulo1('SERVIÇO PRESTADO'), ['Código de Tributação Nacional / Municipal', s.codigo, 1], ['Código da NBS', s.nbs, 2], ['Local da Prestação / Sigla UF / País', s.local, 3]]],
    depois: [{ semRotulo: s.descricaoCodigo, alt: 0.40 }, { descricaoServico: s.descricao }],
  })

  const i = campos.issqn
  blocos.push(i ? {
    linhas: [
      [titulo1('TRIBUTAÇÃO MUNICIPAL (ISSQN)'), ['Tipo de Tributação do ISSQN', i.tipo, 1], ['Município / Sigla UF / País de Incidência do ISSQN', i.incidencia, 2, LARG2]],
      i.temLinha2 ? [['Regime Especial de Tributação do ISSQN', i.regimeEspecial, 0], ['Tipo de Imunidade do ISSQN', i.imunidade, 1], ['Suspensão da Exigibilidade do ISSQN', i.suspensao, 2], ['Número Processo Suspensão', i.processo, 3]] : null,
      i.temLinha3 ? [['Benefício Municipal', i.beneficio, 0], ['Cálculo do BM', i.calculoBM, 1], ['Total Deduções/Reduções', i.deducoes, 2], ['Desconto Incondicionado', i.descontoIncond, 3]] : null,
      [['BC ISSQN', i.bc, 0], ['Alíquota Aplicada', i.aliquota, 1], ['Retenção do ISSQN', i.retencao, 2], ['ISSQN Apurado', i.apurado, 3]],
    ].filter(Boolean),
  } : suprimido('TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN'))

  const f = campos.federal
  blocos.push({
    linhas: [
      [titulo1('TRIBUTAÇÃO FEDERAL (EXCETO CBS)'), ['IRRF', f.irrf, 1], ['Contribuição Previdenciária - Retida', f.cp, 2], ['Contribuições Sociais - Retidas', f.csRetidas, 3]],
      f.mostrarPisCofins ? [['PIS - Débito Apuração Própria', f.pis, 0], ['COFINS - Débito Apuração Própria', f.cofins, 1], ['Descrição Contrib. Sociais - Retidas', f.descricaoCs, 2, LARG2]] : null,
    ].filter(Boolean),
  })

  const b = campos.ibscbs
  blocos.push({
    linhas: [
      [titulo1('TRIBUTAÇÃO IBS / CBS'), ['CST / cClassTrib', b.cst, 1], ['Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF', b.operacao, 2, LARG2]],
      [['Exclusões e Reduções da Base de Cálculo', b.exclusoes, 0], ['Base de Cálculo Após Exclusões e Reduções', b.bc, 1], ['Red. Alíquota IBS / Red. Alíquota CBS', b.reducoes, 2], ['Alíquota - IBS UF / IBS Mun', b.aliquotas, 3]],
      [['Alíq. Efetiva Municipal - IBS', b.efetivaMun, 0], ['Valor Apurado Municipal - IBS', b.vIBSMun, 1], ['Alíq. Efetiva Estadual - IBS', b.efetivaUF, 2], ['Valor Apurado Estadual - IBS', b.vIBSUF, 3]],
      [['Valor Total Apurado - IBS', b.vIBSTot, 0], ['Alíquota - CBS', b.pCBS, 1], ['Alíquota Efetiva - CBS', b.efetivaCBS, 2], ['Valor Total Apurado - CBS', b.vCBS, 3]],
    ],
  })

  const t = campos.totais
  blocos.push({
    altLinha: 0.68,
    linhas: [
      [titulo1('VALOR TOTAL DA NFS-E'), ['VALOR DA OPERAÇÃO / SERVIÇO', t.servico, 1, LARG, 7], ['Desconto Incondicionado', t.descontoIncond, 2], ['Desconto Condicionado', t.descontoCond, 3]],
      [['Total das Retenções (ISSQN / Federais)', t.retencoes, 0], ['VALOR LÍQUIDO DA NFS-E', t.liquido, 1, LARG, 7], ['Total do IBS/CBS', t.ibscbs, 2], ['VALOR LÍQUIDO DA NFS-E + IBS/CBS', t.liquidoComIbsCbs, 3, LARG, 7, true]],
    ],
  })

  // alturas fixas e o que sobra para descrição do serviço / informações complementares
  const altBloco = (bl) => (bl.suprimido ? ALT_SUPRIMIDO + 0.06 : bl.linhas.length * (bl.altLinha || ALT_LINHA) + (bl.depois ? 0.40 : 0))
  const fixo = blocos.reduce((soma, bl) => soma + altBloco(bl), 0)
  const topoInfo = 0.39
  const fimConteudo = INICIO_CANHOTO - 0.08
  const sobra = fimConteudo - 4.34 - fixo - topoInfo
  const linhasDesc = d.quebrar(s.descricao, LARG_TOTAL - 0.16, normal, 7)
  const linhasInfo = d.quebrar([campos.complementares.texto, campos.complementares.totais].filter(Boolean).join('\n'), LARG_TOTAL - 0.16, normal, 7)
  const alturaTexto = (n) => 0.30 + n * 0.28
  const minInfo = alturaTexto(Math.min(linhasInfo.length, 3))
  const altDesc = Math.max(0.63, Math.min(alturaTexto(linhasDesc.length), sobra - minInfo))
  const altInfo = Math.max(minInfo, sobra - altDesc)

  let y = 4.34
  for (const bl of blocos) {
    if (bl.suprimido) {
      d.texto(bl.suprimido, COL[0] + 0.08, y + 0.24, { fonte: negrito, tam: 7 })
      y += ALT_SUPRIMIDO + 0.06
      d.linha(y - 0.01)
      continue
    }
    const altLinha = bl.altLinha || ALT_LINHA
    bl.linhas.forEach((linha, n) => {
      for (const c of linha) {
        if (!c) continue
        if (c.titulo) {
          d.retangulo(COL[0], y, LARG, altLinha, { fundo: CINZA })
          d.texto(c.titulo, COL[0] + 0.08, y + 0.27, { fonte: negrito, tam: 7, largura: LARG - 0.12 })
          continue
        }
        const [rot, valor, coluna, largura = LARG, tamRotulo = 6, sombra = false] = c
        if (sombra) d.retangulo(COL[coluna], y, largura, altLinha, { fundo: CINZA })
        d.campo(rot, valor, COL[coluna], y, largura, { tamRotulo })
      }
      y += altLinha
      if (n === bl.linhas.length - 1 && !bl.depois) d.linha(y - 0.01)
    })
    if (bl.depois) {
      for (const extra of bl.depois) {
        if (extra.semRotulo) {
          d.texto(extra.semRotulo, COL[0] + 0.08, y + 0.26, { tam: 7, largura: LARG_TOTAL - 0.16 })
          y += extra.alt
        } else {
          d.texto('Descrição do Serviço', COL[0] + 0.08, y + 0.22, { fonte: negrito, tam: 6 })
          d.paragrafo(linhasDesc, COL[0] + 0.08, y + 0.48, altDesc - 0.30)
          y += altDesc
        }
      }
      d.linha(y - 0.01)
    }
  }

  // informações complementares
  d.texto('INFORMAÇÕES COMPLEMENTARES', COL[0] + 0.08, y + 0.27, { fonte: negrito, tam: 7 })
  y += topoInfo
  d.paragrafoComTotais(campos.complementares, COL[0] + 0.08, y + 0.20, altInfo - 0.12, LARG_TOTAL - 0.16, normal)

  // canhoto (opcional na NT; mantido)
  const yc = INICIO_CANHOTO + 0.20
  d.retangulo(COL[0], yc, LARG_TOTAL, 0.67, { borda: 0.5 })
  d.linhaVertical(COL[1] - 0.02, yc, 0.67)
  d.linhaVertical(COL[2] - 0.02, yc, 0.67)
  d.campo('DATA CIENTIFICAÇÃO:', '', COL[0], yc, LARG, { tamRotulo: 7 })
  d.campo('IDENTIFICAÇÃO E ASSINATURA', '', COL[1], yc, LARG, { tamRotulo: 7 })
  d.campo('Nº NFS-E / CHAVE NFS-E', campos.canhoto, COL[2], yc, LARG2, { tamRotulo: 7 })

  if (opcoes.marcaDagua) d.marcaDagua(opcoes.marcaDagua, negrito)

  return Buffer.from(await pdf.save())
}

const titulo1 = (texto) => ({ titulo: texto })

function criarDesenho(pagina, normal, negrito) {
  const X = (cm) => cm * CM
  const Y = (cmTopo) => A4.h - cmTopo * CM
  const seguro = (texto) => String(texto == null ? '' : texto)
    .normalize('NFC')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿ\n]/g, '?')

  function caber(texto, largura, fonte, tam) {
    let t = seguro(texto)
    if (!largura || fonte.widthOfTextAtSize(t, tam) <= largura * CM) return t
    while (t.length && fonte.widthOfTextAtSize(`${t}...`, tam) > largura * CM) t = t.slice(0, -1)
    return `${t.trimEnd()}...`
  }

  const d = {
    retangulo(x, y, w, h, { fundo = null, borda = 0 } = {}) {
      pagina.drawRectangle({ x: X(x), y: Y(y + h), width: w * CM, height: h * CM, color: fundo || undefined, borderColor: borda ? PRETO : undefined, borderWidth: borda || 0 })
    },
    linha(y) {
      pagina.drawLine({ start: { x: X(0.30), y: Y(y) }, end: { x: X(20.70), y: Y(y) }, thickness: 0.5, color: PRETO })
    },
    linhaVertical(x, y, h) {
      pagina.drawLine({ start: { x: X(x), y: Y(y) }, end: { x: X(x), y: Y(y + h) }, thickness: 0.5, color: PRETO })
    },
    imagem(img, x, y, w, h) {
      pagina.drawImage(img, { x: X(x), y: Y(y + h), width: w * CM, height: h * CM })
    },
    texto(texto, x, baseCm, { fonte = normal, tam = 7, cor = PRETO, largura = null } = {}) {
      pagina.drawText(caber(texto, largura, fonte, tam), { x: X(x), y: Y(baseCm), size: tam, font: fonte, color: cor })
    },
    textoCentro(texto, x, largura, baseCm, { fonte = normal, tam = 7, cor = PRETO } = {}) {
      const t = caber(texto, largura, fonte, tam)
      const w = fonte.widthOfTextAtSize(t, tam)
      pagina.drawText(t, { x: X(x) + (largura * CM - w) / 2, y: Y(baseCm), size: tam, font: fonte, color: cor })
    },
    campo(rot, valor, x, y, largura, { tamRotulo = 6 } = {}) {
      d.texto(rot, x + 0.08, y + 0.24, { fonte: negrito, tam: tamRotulo, largura: largura - 0.12 })
      if (valor !== '') d.texto(valor, x + 0.08, y + 0.52, { tam: 7, largura: largura - 0.12 })
    },
    quebrar(texto, largura, fonte, tam) {
      const linhas = []
      for (const paragrafo of seguro(texto).split('\n')) {
        let atual = ''
        for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
          const tentativa = atual ? `${atual} ${palavra}` : palavra
          if (fonte.widthOfTextAtSize(tentativa, tam) <= largura * CM) { atual = tentativa; continue }
          if (atual) linhas.push(atual)
          atual = palavra
          while (fonte.widthOfTextAtSize(atual, tam) > largura * CM) { // palavra maior que a linha
            let corte = atual.length - 1
            while (corte > 1 && fonte.widthOfTextAtSize(atual.slice(0, corte), tam) > largura * CM) corte--
            linhas.push(atual.slice(0, corte)); atual = atual.slice(corte)
          }
        }
        linhas.push(atual)
      }
      return linhas
    },
    paragrafo(linhas, x, baseCm, alturaCm) {
      const max = Math.max(1, Math.floor(alturaCm / 0.28) + 1)
      const visiveis = linhas.slice(0, max)
      if (linhas.length > max) visiveis[max - 1] = caber(`${visiveis[max - 1]}...`, LARG_TOTAL - 0.16, normal, 7)
      visiveis.forEach((l, i) => d.texto(l, x, baseCm + i * 0.28, { tam: 7 }))
    },
    // texto livre com reticências se não couber, sem nunca cortar a linha dos totais de tributos
    paragrafoComTotais({ texto, totais }, x, baseCm, alturaCm, largura, fonte) {
      const linhasTotais = d.quebrar(totais, largura, fonte, 7)
      const max = Math.max(1, Math.floor(alturaCm / 0.28) + 1) - linhasTotais.length
      const linhasTexto = texto ? d.quebrar(texto, largura, fonte, 7) : []
      const visiveis = linhasTexto.slice(0, Math.max(0, max))
      if (linhasTexto.length > visiveis.length && visiveis.length) visiveis[visiveis.length - 1] = caber(`${visiveis[visiveis.length - 1]}...`, largura, fonte, 7)
      ;[...visiveis, ...linhasTotais].forEach((l, i) => d.texto(l, x, baseCm + i * 0.28, { tam: 7 }))
    },
    async qrCode(conteudo, x, y, lado) {
      const qr = QRCode.create(conteudo, { errorCorrectionLevel: 'M' })
      const n = qr.modules.size
      const passo = (lado * CM) / n
      for (let lin = 0; lin < n; lin++) {
        for (let col = 0; col < n; col++) {
          if (!qr.modules.get(lin, col)) continue
          pagina.drawRectangle({ x: X(x) + col * passo, y: Y(y) - (lin + 1) * passo, width: passo + 0.05, height: passo + 0.05, color: PRETO })
        }
      }
    },
    marcaDagua(texto, fonte) {
      const tam = 60
      const w = fonte.widthOfTextAtSize(texto, tam)
      pagina.drawText(seguro(texto), {
        x: A4.w / 2 - (w / 2) * Math.cos(Math.PI / 4), y: A4.h / 2 - (w / 2) * Math.sin(Math.PI / 4),
        size: tam, font: fonte, color: MARCA, rotate: degrees(45), opacity: 0.6,
      })
    },
  }
  return d
}

module.exports = { gerarDanfse, extrairCampos, URL_CONSULTA }
