// netlify/functions/lib/nfse/importador.js
//
// Importação de atendimentos: texto do WhatsApp (colado ou recebido pelo webhook) e planilhas.
// Porte fiel de app/importador.py do emissor local, validado com o mesmo lote real de 26 mensagens.
//
// Tudo por regex, sem IA. Regra de ouro: campo não encontrado fica vazio (pendente); nunca
// inventar valor. Situações duvidosas viram `avisos` no registro.
//
// Registro: { nome, cpf, endereco, cep, data ('AAAA-MM-DD'|null), valor ('1590.00'|null), descricao,
//             autor, dataMensagem, origem, textoOriginal, avisos: [] }
//
// Diferença de motor de regex: no Python, \b e \w reconhecem letras acentuadas; no JS não. Onde
// isso importa, usamos fronteiras Unicode explícitas (LB/LA abaixo) com a flag "u".

const L = '[\\p{L}\\p{N}_]'
const LB = `(?<!${L})` // fronteira de palavra antes (equivale ao \b do Python)
const LA = `(?!${L})`  // fronteira de palavra depois

const re = (fonte, flags = '') => new RegExp(fonte, `${flags}u`)

function novoRegistro(extra = {}) {
  return {
    nome: '', cpf: '', endereco: '', cep: '', data: null, valor: null, descricao: '',
    autor: '', dataMensagem: '', origem: '', textoOriginal: '', avisos: [], ...extra,
  }
}

// --------------------------------------------------------------------------- utilidades

const INVISIVEIS = /[\u200e\u200f\u202a-\u202e\ufeff]/g
const QUEBRAS = /\r\n|[\n\r\u2028\u2029\x0b\x0c\x1c-\x1e\x85]/ // mesmo critério do str.splitlines()

function strip(s, chars) {
  let i = 0
  let j = s.length
  while (i < j && chars.includes(s[i])) i++
  while (j > i && chars.includes(s[j - 1])) j--
  return s.slice(i, j)
}

function limparLinha(linha) {
  let s = linha.replace(INVISIVEIS, '').replace(/\xa0/g, ' ')
  s = strip(s.trim(), '*_~').trim() // negrito/itálico do WhatsApp
  return s.replace(/\s+/g, ' ')
}

const semAcento = (t) => t.normalize('NFD').replace(/\p{Mn}/gu, '')
const soDigitos = (t) => String(t).replace(/\D/g, '')
const espacos = (t) => t.replace(/\s+/g, ' ')

// '1.590,00' | '1590,00' | '900,00' | '900' | '1.590' | '900.50' -> '1590.00' (string, sem float)
function parseValor(texto) {
  let s = strip(String(texto).replace(/r\$/gi, '').replace(/ /g, ''), '.,;:')
  if (!s || !/^[\d.,]+$/.test(s)) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // 1.590 = mil quinhentos e noventa
  const m = s.match(/^(\d*)(?:\.(\d*))?$/)
  if (!m || (!m[1] && !m[2])) return null
  // arredondamento como o Decimal.quantize do Python (meio para o par)
  const inteiro = BigInt(m[1] || '0')
  const dec = (m[2] || '').padEnd(3, '0')
  let centavos = inteiro * 100n + BigInt(dec.slice(0, 2))
  const resto = dec.slice(2)
  if (resto.length) {
    const r = Number(resto[0])
    const temMais = /[1-9]/.test(resto.slice(1))
    if (r > 5 || (r === 5 && (temMais || centavos % 2n === 1n))) centavos += 1n
  }
  return `${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`
}

function montarData(dia, mes, ano) {
  let a = parseInt(ano, 10)
  if (ano.length === 2) a += 2000
  const d = parseInt(dia, 10)
  const m = parseInt(mes, 10)
  const dt = new Date(Date.UTC(a, m - 1, d))
  if (a < 1 || dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseData(texto) {
  const t = String(texto).trim()
  let m = t.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})$/)
  if (m) return montarData(m[1], m[2], m[3])
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/)
  if (m) return montarData(m[3], m[2], m[1])
  return null
}

const dataBR = (iso) => iso.split('-').reverse().join('/')

// --------------------------------------------------------------------------- WhatsApp

// [10:03, 13/10/2026] Nome: texto          (WhatsApp Web / Android ao copiar)
const CAB_HORA_DATA = /^\[(\d{1,2}:\d{2})(?::\d{2})?,\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]\s*([^:]+?):\s?(.*)$/
// [13/10/2026, 10:03:15] Nome: texto       (iPhone)
const CAB_DATA_HORA = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?\]\s*([^:]+?):\s?(.*)$/
// 13/10/2026 10:03 - Nome: texto           (arquivo exportado)
const CAB_EXPORTADO = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2})\s+-\s+([^:]+?):\s?(.*)$/

const ROTULO_NOME = re('^(?:nome|paciente|cliente|tomador)\\s*[:\\-]\\s*(.+)$', 'i')
const ROTULO_CPF = re(`^cpf${LA}\\s*[:;,.\\-]*\\s*(.*)$`, 'i')
const ROTULO_ENDERECO = re('^(?:endere[cç]o|end\\.)\\s*[:\\-]?\\s*(.+)$', 'i')
const ROTULO_CEP = re(`^cep${LA}\\s*[:\\-.]?\\s*(.+)$`, 'i')
const ROTULO_DESCRICAO = re('^(?:descri[cç][aã]o|servi[cç]o|procedimento|tratamento|referente\\s+a|ref\\.?)\\s*[:\\-]\\s*(.+)$', 'i')
const VALOR_ROTULADO = re(`${LB}(valor(?:\\s+total)?|total|vlr|vl)${LA}\\.?\\s*(?:[:;,.=\\-]\\s*)*(?:r\\$\\s*)?(\\d[\\d.]*(?:,\\d{1,2})?)`, 'i')
const VALOR_SOLTO = re('^(?:r\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})$|^r\\$\\s*(\\d[\\d.]*(?:,\\d{1,2})?)$', 'i')
const DATA_LINHA = re(`^(?:data(?:\\s+d[oa]\\s+${L}+)?\\s*(?:[:;,.\\-]\\s*)*)?(\\d{1,2})\\s*[/.\\-]\\s*(\\d{1,2})\\s*[/.\\-]\\s*(\\d{4}|\\d{2})\\.?$`, 'i')
const SO_NUMEROS = /^[\d.\-\s/]+$/
// Data no meio de outra linha ("Av Copacabana 162 urca 31/01/26")
const DATA_EMBUTIDA = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/
// Nome e CPF na mesma linha ("Izaura Gomes Pereira 971.570.666-53")
const NOME_E_CPF = re('^(.+?)[\\s,\\-]*(?:cpf\\s*[:;,.\\-]*\\s*)?(\\d[\\d.\\-\\s]{9,16}\\d)$', 'i')
const CEP = re(`(?:${LB}cep\\s*[:\\-.]?\\s*)?${LB}(\\d{2}\\.?\\d{3}-\\d{3})${LA}|${LB}cep\\s*[:\\-.]?\\s*(\\d{8})${LA}`, 'i')
const CEP_SOZINHO = /^(\d{2}\.?\d{3}-\d{3}|\d{5}-\d{3})$/
const TIPOS_LOGRADOURO = '(?:rua|r\\.|av\\.?|avenida|alameda|al\\.|travessa|tv\\.|pra[cç]a|rodovia|estrada|beco)'
const ENDERECO = re(`^${TIPOS_LOGRADOURO}(?=\\s|$)`, 'i')
const SO_LOGRADOURO = re(`^${TIPOS_LOGRADOURO}?[\\s.,;:\\-]*$`, 'i')
const COMPLEMENTO_ENDERECO = re(`^(?:bairro|apto?\\.?|apartamento|casa|bloco|bl\\.|complemento|n[º°o]\\.?\\s*\\d|n[uú]mero)${LA}`, 'i')
const TELEFONE = re(`^(?:tel|telefone|cel|celular|fone|whats(?:app)?|contato)${LA}|^\\(\\d{2}\\)\\s*9?\\d{4}-?\\d{4}$`, 'i')
const NOME = /^[A-Za-zÀ-ÖØ-öø-ÿ'´`. ]+$/

// Frases de conversa, não de dados. Comparadas sem acento e em minúsculas.
const FRASES_IGNORADAS = [
  'nota fiscal', 'fazer nota', 'fazer a nota', 'emitir', 'por gentileza', 'por favor',
  'bom dia', 'boa tarde', 'boa noite', 'obrigad', 'segue', 'seguem', 'dados',
  'tudo bem', 'mensagem apagada', 'midia oculta', '<midia', 'imagem ocultada',
]

function ehFraseIgnorada(linha) {
  const t = semAcento(linha).toLowerCase()
  return FRASES_IGNORADAS.some((f) => t.includes(f)) || t.endsWith('?')
}

// Quebra o texto em mensagens pelo cabeçalho do WhatsApp. Sem nenhum cabeçalho, cada bloco
// separado por linha em branco vira uma mensagem.
function separarMensagens(texto) {
  const mensagens = []
  let atual = null
  for (const bruta of texto.split(QUEBRAS)) {
    const linha = bruta.replace(INVISIVEIS, '').replace(/\xa0/g, ' ').trim()
    let m = linha.match(CAB_HORA_DATA)
    let dia, hora, autor, resto
    if (m) [, hora, dia, autor, resto] = m
    else {
      m = linha.match(CAB_DATA_HORA) || linha.match(CAB_EXPORTADO)
      if (m) [, dia, hora, autor, resto] = m
    }
    if (m) {
      atual = { autor: autor.trim(), dataMensagem: `${dia} ${hora}`, linhas: [resto] }
      mensagens.push(atual)
    } else if (atual) {
      atual.linhas.push(bruta)
    }
  }
  if (mensagens.length) return mensagens
  return texto.split(/\n\s*\n/).filter((b) => b.trim())
    .map((b) => ({ autor: '', dataMensagem: '', linhas: b.split(QUEBRAS) }))
}

// Retorna [texto sem o CEP, cep em dígitos].
function extrairCep(texto) {
  const m = texto.match(CEP)
  if (!m) return [texto, '']
  const cep = soDigitos(m[1] || m[2])
  const restante = strip(texto.slice(0, m.index) + texto.slice(m.index + m[0].length), ' ,;-')
  return [espacos(restante), cep]
}

function interpretarMensagem(linhas) {
  const reg = novoRegistro({ origem: 'whatsapp' })
  const descricao = []
  const datas = []
  const valores = [] // [veioDeTotal, valor]
  let ultimaFoiEndereco = false

  const definirCpf = (bruto) => {
    const digitos = soDigitos(bruto)
    if (reg.cpf && reg.cpf !== digitos) {
      reg.avisos.push(`Mais de um CPF na mensagem; mantido ${reg.cpf}, ignorado ${digitos}`)
      return
    }
    reg.cpf = digitos
    if (digitos.length !== 11) reg.avisos.push(`CPF com ${digitos.length} dígitos: '${bruto.trim()}'`)
  }

  const definirEndereco = (texto) => {
    let [t, cep] = extrairCep(texto)
    if (cep && !reg.cep) reg.cep = cep
    const m = t.match(DATA_EMBUTIDA)
    if (m) {
      const d = montarData(m[1], m[2], m[3])
      if (d) {
        datas.push(d)
        reg.avisos.push(`Data ${dataBR(d)} estava junto do endereço`)
        t = strip(espacos(t.slice(0, m.index) + t.slice(m.index + m[0].length)), ' ,;-')
      }
    }
    if (SO_LOGRADOURO.test(t)) {
      reg.avisos.push(`Endereço incompleto: '${t}'`)
      return
    }
    if (t) reg.endereco = reg.endereco ? `${reg.endereco}, ${t}` : t
  }

  for (const bruta of linhas) {
    const linha = limparLinha(bruta)
    if (!linha) continue
    let foiEndereco = false
    let m

    if ((m = linha.match(ROTULO_NOME))) {
      if (!reg.nome) reg.nome = m[1].trim()
    } else if ((m = linha.match(ROTULO_CPF))) {
      if (soDigitos(m[1])) definirCpf(m[1])
    } else if ((m = linha.match(ROTULO_CEP))) {
      reg.cep = reg.cep || soDigitos(m[1])
    } else if ((m = linha.match(ROTULO_ENDERECO))) {
      definirEndereco(m[1])
      foiEndereco = true
    } else if ((m = linha.match(ROTULO_DESCRICAO))) {
      descricao.push(m[1].trim())
    } else if ((m = linha.match(VALOR_ROTULADO))) {
      const v = parseValor(m[2])
      if (v !== null) valores.push([m[1].toLowerCase().startsWith('total'), v])
      else reg.avisos.push(`Valor não entendido: '${linha}'`)
      // Texto junto do valor ("Valor 670,00 restaurações") é descrição
      const sobra = strip(`${linha.slice(0, m.index)} ${linha.slice(m.index + m[0].length)}`, ' ,;:-.')
      if (/[A-Za-zÀ-ÿ]/.test(sobra) && !/^(?:r\$|reais)$/i.test(sobra)) descricao.push(espacos(sobra))
    } else if ((m = linha.match(VALOR_SOLTO))) {
      const v = parseValor(m[1] || m[2])
      if (v !== null) valores.push([false, v])
    } else if ((m = linha.match(DATA_LINHA))) {
      const d = montarData(m[1], m[2], m[3])
      if (d) datas.push(d)
      else reg.avisos.push(`Data inexistente: '${linha}'`)
    } else if (CEP_SOZINHO.test(linha)) {
      reg.cep = reg.cep || soDigitos(linha)
    } else if (SO_NUMEROS.test(linha) && soDigitos(linha).length >= 9 && soDigitos(linha).length <= 12) {
      definirCpf(linha)
    } else if (TELEFONE.test(linha)) {
      reg.avisos.push(`Telefone ignorado: '${linha}'`)
    } else if (!reg.nome && (m = linha.match(NOME_E_CPF)) && NOME.test(m[1]) && soDigitos(m[2]).length === 11) {
      reg.nome = m[1].trim()
      definirCpf(m[2])
    } else if (ENDERECO.test(linha)) {
      definirEndereco(linha)
      foiEndereco = true
    } else if (ultimaFoiEndereco && COMPLEMENTO_ENDERECO.test(linha)) {
      definirEndereco(linha)
      foiEndereco = true
    } else if (ehFraseIgnorada(linha)) {
      // conversa
    } else if (!reg.nome && NOME.test(linha)) {
      reg.nome = linha
    } else {
      descricao.push(linha)
    }
    ultimaFoiEndereco = foiEndereco
  }

  if (datas.length) {
    reg.data = datas[0]
    if (new Set(datas).size > 1) {
      reg.avisos.push(`Mais de uma data na mensagem; usada a primeira. Outras: ${datas.slice(1).map(dataBR).join(', ')}`)
    }
  }
  if (valores.length) {
    const totais = valores.filter(([t]) => t).map(([, v]) => v)
    reg.valor = totais.length ? totais[totais.length - 1] : valores[0][1]
    if (new Set(valores.map(([, v]) => v)).size > 1) {
      reg.avisos.push(`Mais de um valor na mensagem (${valores.map(([, v]) => v).join(', ')}); usado ${reg.valor}`)
    }
  }
  reg.descricao = descricao.join('; ')
  if (reg.nome && reg.nome.split(/\s+/).filter(Boolean).length === 1) reg.avisos.push('Nome com uma palavra só')
  return reg
}

// Descarta mensagens de conversa ('Ok', 'Bom dia') que não trazem nenhum dado.
const temDados = (r) => Boolean(r.cpf || r.valor !== null || r.data || r.endereco || r.nome.split(/\s+/).filter(Boolean).length >= 2)

function importarTextoWhatsapp(texto) {
  const registros = []
  for (const msg of separarMensagens(texto)) {
    const reg = interpretarMensagem(msg.linhas)
    if (!temDados(reg)) continue
    reg.autor = msg.autor
    reg.dataMensagem = msg.dataMensagem
    reg.textoOriginal = msg.linhas.map((l) => l.replace(/\s+$/, '')).join('\n').trim()
    registros.push(reg)
  }
  return registros
}

// --------------------------------------------------------------------------- lista datada
//
// Formato de agenda/controle, sem cabeçalho do WhatsApp:
//   9/09/2026
//   Ana Souza Lima 480,00
//   Pedro Alves 100,00
//   11/09/2026
//   José Ricardo F Costa (recibo em nome de Maria Helena) 750,00
// Cada linha "nome valor" é um atendimento na última data vista. Observação entre parênteses vira aviso.

const LISTA_DATA = /^\s*(?:data\s*[:\-]?\s*)?(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4}|\d{2})\s*$/i
const LISTA_ITEM = /^\s*(.*?[A-Za-zÀ-ÿ].*?)\s*[-–:;,]?\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+(?:\.\d{2})?)\s*$/i

function pareceListaDatada(texto) {
  const linhas = texto.split(QUEBRAS).map((l) => l.trim()).filter(Boolean)
  if (linhas.some((l) => CAB_HORA_DATA.test(l) || CAB_DATA_HORA.test(l) || CAB_EXPORTADO.test(l))) return false
  const datas = linhas.filter((l) => LISTA_DATA.test(l)).length
  const itens = linhas.filter((l) => !LISTA_DATA.test(l) && LISTA_ITEM.test(l)).length
  return datas >= 1 && itens >= 1 && datas + itens >= linhas.length * 0.8
}

function importarListaDatada(texto) {
  const registros = []
  let data = null
  let linhaData = ''
  for (const bruta of texto.split(QUEBRAS)) {
    const linha = limparLinha(bruta)
    if (!linha) continue
    const md = linha.match(LISTA_DATA)
    if (md) {
      data = montarData(md[1], md[2], md[3])
      linhaData = linha
      continue
    }
    const mi = linha.match(LISTA_ITEM)
    const reg = novoRegistro({ origem: 'colado', textoOriginal: `${linhaData}\n${linha}`.trim() })
    if (!mi) {
      reg.descricao = linha
      reg.avisos.push(`Linha não entendida: '${linha}'`)
    } else {
      const obs = [...mi[1].matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
      reg.nome = mi[1].replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
      reg.valor = parseValor(mi[2])
      for (const o of obs) reg.avisos.push(`Observação na mensagem: ${o}`)
    }
    reg.data = data
    if (!data) reg.avisos.push('Sem data antes desta linha')
    registros.push(reg)
  }
  return registros
}

// Texto colado: lista datada (agenda) ou mensagens do WhatsApp.
function importarTexto(texto) {
  return pareceListaDatada(texto) ? importarListaDatada(texto) : importarTextoWhatsapp(texto)
}

// --------------------------------------------------------------------------- planilha

const ALIASES_COLUNAS = {
  data: 'data', 'data atendimento': 'data', 'data do atendimento': 'data', data_atendimento: 'data',
  nome: 'nome', paciente: 'nome', cliente: 'nome', tomador: 'nome',
  cpf: 'cpf',
  endereco: 'endereco', 'endereco completo': 'endereco',
  cep: 'cep',
  descricao: 'descricao', servico: 'descricao', procedimento: 'descricao', 'descricao do servico': 'descricao',
  valor: 'valor', total: 'valor', 'valor total': 'valor',
}

const normalizarColuna = (n) => espacos(semAcento(String(n ?? '')).trim().toLowerCase())
const vazio = (v) => v === null || v === undefined || v === ''

function registroDaLinha(valores, numeroLinha) {
  const reg = novoRegistro({ origem: 'planilha', dataMensagem: `linha ${numeroLinha}` })
  reg.nome = limparLinha(String(valores.nome ?? ''))
  reg.endereco = limparLinha(String(valores.endereco ?? ''))
  reg.descricao = limparLinha(String(valores.descricao ?? ''))

  const cpf = valores.cpf
  let digitos = vazio(cpf) ? '' : soDigitos(typeof cpf === 'number' && Number.isInteger(cpf) ? String(cpf) : cpf)
  if (digitos.length >= 9 && digitos.length <= 10) {
    // Excel costuma comer o zero à esquerda do CPF
    reg.avisos.push(`CPF completado com zeros à esquerda (${digitos} → ${digitos.padStart(11, '0')})`)
    digitos = digitos.padStart(11, '0')
  } else if (digitos && digitos.length !== 11) {
    reg.avisos.push(`CPF com ${digitos.length} dígitos: '${cpf}'`)
  }
  reg.cpf = digitos

  const cep = valores.cep
  reg.cep = vazio(cep) ? '' : soDigitos(String(cep)).padStart(8, '0')
  if (!reg.cep) [reg.endereco, reg.cep] = extrairCep(reg.endereco)

  const d = valores.data
  if (d instanceof Date) {
    reg.data = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  } else if (!vazio(d)) {
    reg.data = parseData(String(d))
    if (!reg.data) reg.avisos.push(`Data não entendida: '${d}'`)
  }

  const v = valores.valor
  if (typeof v === 'number') {
    reg.valor = parseValor(v.toFixed(2))
  } else if (!vazio(v)) {
    reg.valor = parseValor(String(v))
    if (reg.valor === null) reg.avisos.push(`Valor não entendido: '${v}'`)
  }
  reg.textoOriginal = Object.entries(valores).map(([k, val]) => `${k}=${val ?? ''}`).join(' | ')
  return reg
}

// linhas: matriz (primeira linha com 'nome' ou 'cpf' é o cabeçalho)
function importarLinhas(linhas) {
  let i = -1
  let colunas = []
  for (let k = 0; k < linhas.length; k++) {
    colunas = linhas[k].map((c) => ALIASES_COLUNAS[normalizarColuna(c)] || null)
    if (colunas.includes('nome') || colunas.includes('cpf')) { i = k; break }
  }
  if (i < 0) throw new Error('Planilha sem cabeçalho reconhecível. Colunas esperadas: data, nome, cpf, endereco, cep, descricao, valor')
  const registros = []
  for (let j = i + 1; j < linhas.length; j++) {
    const linha = linhas[j]
    if (!linha.some((c) => !vazio(c) && String(c).trim())) continue
    const valores = {}
    colunas.forEach((col, k) => { if (col && k < linha.length) valores[col] = linha[k] })
    registros.push(registroDaLinha(valores, j + 1))
  }
  return registros
}

function importarCsv(texto) {
  const primeira = texto.split(QUEBRAS)[0] || ''
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ','
  const linhas = []
  for (const l of texto.split(/\r\n|\n|\r/)) {
    const campos = []
    let atual = ''
    let aspas = false
    for (let k = 0; k < l.length; k++) {
      const c = l[k]
      if (aspas) {
        if (c === '"' && l[k + 1] === '"') { atual += '"'; k++ } else if (c === '"') aspas = false
        else atual += c
      } else if (c === '"') aspas = true
      else if (c === sep) { campos.push(atual); atual = '' } else atual += c
    }
    campos.push(atual)
    linhas.push(campos)
  }
  return importarLinhas(linhas)
}

module.exports = {
  importarTextoWhatsapp, interpretarMensagem, separarMensagens, importarLinhas, importarCsv,
  importarTexto, importarListaDatada, pareceListaDatada,
  parseValor, parseData, montarData, soDigitos, semAcento, novoRegistro,
}
