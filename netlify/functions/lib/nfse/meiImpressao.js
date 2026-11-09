// netlify/functions/lib/nfse/meiImpressao.js
//
// DANFSe da nota de MEI sem o captcha do portal. O Emissor Nacional pede hCaptcha para baixar o
// PDF/XML, mas a "versão para impressão" da nota (Notas/Visualizar/Impressao) abre sem captcha.
// Essa página é o XML autorizado passado por XSLT: tem todos os dados que o DANFSe imprime.
// O robô guarda a página (nfse-mei/{id}.html) e aqui ela vira os mesmos campos que
// danfse.extrairCampos tira do XML, para o mesmo desenho do DANFSe da PJ.
//
// O que a página não mostra: a competência (vem da própria nota do gestor), o código IBGE do
// município do tomador (busca pelo nome na API do IBGE; sem resposta, fica "-") e o valor líquido
// (MEI não tem retenção: líquido = serviço - retenções da página).

const { AMB_GER, C_STAT, OP_SIMP_NAC } = require('./danfse/danfse')

const TRACO = '-'
const ou = (v) => (v === '' || v == null ? TRACO : v)

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function texto(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      return ENTIDADES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

// { "Emitente": { "CNPJ": "…", … }, "Tomador": { … }, … } — rótulo e valor de cada campo, por painel.
function lerImpressao(html) {
  const secoes = {}
  let atual = secoes[''] = {}
  const pedacos = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .split(/(?=<h3[^>]*class="panel-title")|(?=<div class="form-group">)/)
  for (const p of pedacos) {
    const titulo = /^<h3[^>]*class="panel-title"[^>]*>([\s\S]*?)<\/h3>/.exec(p)
    if (titulo) {
      const nome = texto(titulo[1])
      atual = secoes[nome] = secoes[nome] || {}
      continue
    }
    const campo = /^<div class="form-group">\s*<label[^>]*>([\s\S]*?)<\/label>([\s\S]*)$/.exec(p)
    if (!campo) continue
    const valor = texto(campo[2]).replace(/^R\$\s*/, '')
    atual[texto(campo[1])] = valor === '-' ? '' : valor
  }
  return secoes
}

const semCodigo = (v) => (v || '').replace(/^\d+\s*-\s*/, '')
const codigoDe = (v) => (/^(\d+)\s*-/.exec(v || '') || [])[1] || ''
const digitos = (v) => (v || '').replace(/\D/g, '')

// "09/11/2026 às 16:47:32-03:00" → "09/11/2026 16:47:32"
const dataHora = (v) => {
  const m = /(\d{2}\/\d{2}\/\d{4})(?:\D+(\d{2}:\d{2}:\d{2}))?/.exec(v || '')
  return m ? [m[1], m[2]].filter(Boolean).join(' ') : TRACO
}

// "0,00" e vazio viram "-" (o XML não traz o grupo e o DANFSe do portal mostra traço)
const valor = (v, sufixo = '') => {
  if (!v) return TRACO
  const n = Number(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n) || n === 0) return TRACO
  return sufixo ? `${v.replace(/\s*%$/, '')}%` : `R$ ${v}`
}
const numeroBr = (v) => Number(String(v || '0').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '')) || 0
const reais = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const cep = (v) => (/^\d{8}$/.test(v) ? v.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2-$3') : v)
const documento = (v) => {
  const d = digitos(v)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return v || ''
}

// "Ribeirão das Neves/MG" → { nome: 'Ribeirão das Neves', uf: 'MG' }
function municipio(v) {
  const m = /^(.*?)\s*\/\s*([A-Z]{2})$/.exec((v || '').trim())
  return m ? { nome: m[1], uf: m[2] } : null
}

// "AVENIDA PALMEIRAS , 1040 , Bairro RETIRO , CEP 32807090 , Esmeraldas/MG"
function endereco(v) {
  const partes = (v || '').split(/\s+,\s+|,\s*/).map((s) => s.trim()).filter(Boolean)
  const r = { linha: [], cep: '', municipio: null }
  for (const p of partes) {
    if (/^CEP\s/i.test(p)) r.cep = digitos(p)
    else if (/^Bairro\s/i.test(p)) r.linha.push(p.replace(/^Bairro\s+/i, ''))
    else if (municipio(p) && p === partes[partes.length - 1]) r.municipio = municipio(p)
    else r.linha.push(p)
  }
  return r
}

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

async function buscarCodigoIbge(nome, uf) {
  const controle = new AbortController()
  const tempo = setTimeout(() => controle.abort(), 4000)
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`, { signal: controle.signal })
    if (!r.ok) return null
    const lista = await r.json()
    const achado = (lista || []).find((m) => semAcento(m.nome) === semAcento(nome))
    return achado ? String(achado.id) : null
  } catch {
    return null
  } finally {
    clearTimeout(tempo)
  }
}

async function pessoa(sec, { codigoIbge, buscar }) {
  if (!sec || !Object.keys(sec).length) return null
  const end = endereco(sec['Endereço do Estabelecimento/Domicílio'] || sec['Endereço'])
  const mun = end.municipio
  const cMun = codigoIbge || (mun ? await buscar(mun.nome, mun.uf).catch(() => null) : null)
  return {
    doc: ou(documento(sec.CNPJ || sec.CPF || sec.NIF || sec['CNPJ / CPF / NIF'])),
    im: ou(sec['Inscrição Municipal']),
    fone: ou(digitos(sec.Telefone)),
    nome: ou(sec['Razão Social'] || sec['Nome/Razão Social'] || sec.Nome),
    municipio: mun ? `${mun.nome} / ${mun.uf}` : TRACO,
    ibgeCep: mun || end.cep ? `${cMun || TRACO} / ${cep(end.cep) || TRACO}` : TRACO,
    endereco: ou(end.linha.join(', ')),
    email: ou(sec.Email || sec['E-mail']),
  }
}

// Campos do DANFSe (mesmo formato de danfse.extrairCampos) a partir da página de impressão.
async function camposDaImpressao(html, { competencia = '', buscarIbge = buscarCodigoIbge } = {}) {
  const s = lerImpressao(html)
  const idNfse = s['Identificação da NFS-e'] || {}
  const idDps = s['Identificação do DPS'] || {}
  const emit = s.Emitente || {}
  const mun = s['Tributação Municipal'] || {}
  const outras = s['Outras Informações'] || {}
  const serv = s['Serviço Prestado'] || {}
  const compl = s['Informações Complementares'] || {}
  const fed = s['Tributação Federal'] || {}
  const tot = s['Total dos tributos'] || {}

  const chave = digitos(idNfse['Chave de acesso'])
  if (chave.length !== 50) throw new Error('Página da nota sem a chave de acesso: não é a versão para impressão da NFS-e')
  const numero = String(Number(chave.slice(23, 36)))
  const buscar = (nome, uf) => buscarIbge(nome, uf)

  // MEI emite no próprio município: o código IBGE do emitente é o do começo da chave
  const prestador = await pessoa(emit, { codigoIbge: chave.slice(0, 7), buscar })
  prestador.simples = /MEI|Microempreendedor/i.test(emit['Situação Perante o Simples Nacional'] || '')
    ? OP_SIMP_NAC[2] : ou(emit['Situação Perante o Simples Nacional'])
  prestador.regimeSN = TRACO

  const munEmit = endereco(emit['Endereço do Estabelecimento/Domicílio']).municipio
  const local = municipio(serv['Município'])
  const incid = municipio(mun['Município de Incidência'])
  const codTrib = /^(\d{6})\s*-\s*(.*)$/.exec(serv['Código de Tributação Nacional'] || '')
  const cTribNac = codTrib ? codTrib[1].replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3') : ''
  const cTribMun = serv['Código de Tributação Municipal'] || ''

  const regime = emit['Regime Especial de Tributação'] || ''
  const servico = numeroBr(mun['Valor do Serviço'])
  const retido = ['IRRF', 'Contribuições Sociais - Retidas', 'Contribuição Previdenciária - Retida']
    .reduce((t, r) => t + numeroBr(fed[r]), 0) + (codigoDe(mun['Retenção']) && codigoDe(mun['Retenção']) !== '1' ? numeroBr(mun['Valor do ISSQN']) : 0)
  const anoCompetencia = Number(String(competencia).slice(0, 4)) || Number((dataHora(idDps['Data de emissão']).split('/')[2] || '').slice(0, 4)) || 0
  const compBr = /^\d{4}-\d{2}-\d{2}/.test(competencia) ? competencia.slice(0, 10).split('-').reverse().join('/') : dataHora(idDps['Data de emissão']).slice(0, 10)

  const complementares = []
  const add = (rotulo, v) => { if (v) complementares.push(`${rotulo} ${v}`) }
  add('Inf. Cont.:', compl['Informações complementares'])
  add('Doc. Ref.:', compl['Documento de referência'])
  add('Doc. Tec.:', compl['Número de documento de responsabilidade técnica'])
  add('Núm. Ped.:', Object.entries(compl).find(([k]) => /^Número do Pedido/i.test(k))?.[1])
  add('Item Ped.:', Object.entries(compl).find(([k]) => /^Itens do Pedido/i.test(k))?.[1])

  const opcaoTributos = tot['Opção'] || ''
  const totFed = Object.entries(tot).find(([k]) => /federa/i.test(k))?.[1]
  const totais = 'Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: ' + (
    totFed
      ? ['Federais', 'Estaduais', 'Municipais'].map((n) => `${n}: ${ou(Object.entries(tot).find(([k]) => new RegExp(n.slice(0, 6), 'i').test(k))?.[1])}`).join('; ')
      : (tot['Simples Nacional'] ? `Simples Nacional: ${tot['Simples Nacional']}` : (/n.o informar/i.test(opcaoTributos) || !opcaoTributos ? 'Não informado' : opcaoTributos)))

  return {
    chave,
    ambiente: '1',  // o Emissor Nacional (www.nfse.gov.br) é o ambiente de produção
    cabecalho: {
      municipio: cTribNac.startsWith('99') || !munEmit ? '' : `Município: ${munEmit.nome} / ${munEmit.uf}`,
      ambienteGerador: `Ambiente Gerador: ${AMB_GER[codigoDe(outras['Ambiente Gerador'])] || ou(semCodigo(outras['Ambiente Gerador']))}`,
      tipoAmbiente: 'Tipo de Ambiente: Produção',
    },
    identificacao: {
      numero,
      competencia: ou(compBr),
      dhProc: dataHora(idNfse['Data de geração']),
      nDPS: ou(idDps['Número']),
      serie: ou(idDps['Série']),
      dhEmi: dataHora(idDps['Data de emissão']),
      emitente: 'Prestador',
      situacao: C_STAT[codigoDe(outras['Situação da NFS-e'])] || ou(semCodigo(outras['Situação da NFS-e'])),
      finalidade: TRACO,
    },
    prestador,
    tomador: await pessoa(s.Tomador, { buscar }),
    destinatario: await pessoa(s['Destinatário'] || s['Destinatário da Operação'], { buscar }),
    destinatarioEhTomador: false,
    intermediario: await pessoa(s['Intermediário'] || s['Intermediário da Operação'], { buscar }),
    servico: {
      codigo: ou([cTribNac, cTribMun].filter(Boolean).join(' / ')),
      nbs: ou(serv['Item da NBS correspondente ao serviço prestado']),
      local: local ? `${local.nome} / ${local.uf} / BR` : ou(serv['País']),
      descricaoCodigo: ou(codTrib && codTrib[2]),
      descricao: ou(serv['Descrição do serviço']),
    },
    issqn: Object.keys(mun).length ? {
      tipo: ou(semCodigo(mun['Tributação do ISSQN'])),
      incidencia: incid ? `${incid.nome} / ${incid.uf} / BR` : ou(mun['País Resultado da Prestação de Serviço']),
      regimeEspecial: ou(regime),
      imunidade: ou(semCodigo(mun['Tipo de Imunidade'])),
      suspensao: ou(semCodigo(mun['Suspensão do ISSQN'])),
      processo: ou(mun['Número processo suspensão']),
      beneficio: ou(semCodigo(mun['Benefício Municipal - BM'])),
      calculoBM: valor(mun['Total Benefício Municipal']),
      deducoes: valor(mun['Total Deduções/Reduções']),
      descontoIncond: valor(mun['Desconto incondicionado']),
      bc: valor(mun['Base de Cálculo']),
      aliquota: valor(mun['Alíquota'], '%'),
      retencao: ou(semCodigo(mun['Retenção'])),
      apurado: valor(mun['Valor do ISSQN']),
      temLinha2: (!!regime && regime !== 'Nenhum') || !!(mun['Tipo de Imunidade'] || mun['Suspensão do ISSQN'] || mun['Número processo suspensão']),
      temLinha3: !!(mun['Benefício Municipal - BM'] || numeroBr(mun['Total Benefício Municipal']) || numeroBr(mun['Total Deduções/Reduções']) || numeroBr(mun['Desconto incondicionado'])),
    } : null,
    federal: {
      irrf: valor(fed.IRRF),
      cp: valor(fed['Contribuição Previdenciária - Retida']),
      csRetidas: valor(fed['Contribuições Sociais - Retidas']),
      pis: valor(fed['PIS - Débito Apuração Própria']),
      cofins: valor(fed['COFINS - Débito Apuração Própria']),
      descricaoCs: /n.o informado/i.test(fed['Descrição Contribuições Sociais - Retidas'] || '') ? TRACO : ou(fed['Descrição Contribuições Sociais - Retidas']),
      mostrarPisCofins: anoCompetencia <= 2026,
    },
    // MEI não destaca IBS/CBS na nota (a página não traz o grupo)
    ibscbs: Object.fromEntries(['cst', 'operacao', 'exclusoes', 'bc', 'reducoes', 'aliquotas', 'efetivaMun', 'vIBSMun',
      'efetivaUF', 'vIBSUF', 'vIBSTot', 'pCBS', 'efetivaCBS', 'vCBS'].map((k) => [k, TRACO])),
    totais: {
      servico: servico ? reais(servico) : TRACO,
      descontoIncond: valor(mun['Desconto incondicionado']),
      descontoCond: TRACO,
      retencoes: retido ? reais(retido) : TRACO,
      liquido: servico ? reais(servico - retido - numeroBr(mun['Desconto incondicionado'])) : TRACO,
      ibscbs: TRACO,
      liquidoComIbsCbs: TRACO,
    },
    complementares: { texto: complementares.join(' | '), totais },
    canhoto: `${numero} / ${chave}`,
  }
}

module.exports = { lerImpressao, camposDaImpressao, buscarCodigoIbge }
