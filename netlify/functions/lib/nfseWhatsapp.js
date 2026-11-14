// netlify/functions/lib/nfseWhatsapp.js
//
// Emissão de NFS-e por comando no grupo "Documentos" do WhatsApp, para
// tomadores JÁ CADASTRADOS no gestor (Emitir NFS-e → Clientes da empresa ou
// Notas recorrentes):
//
//   nfse Simple Care Shopee 1.250,00            → nota recorrente da semana
//   nfse Simple Care Maria Souza 150            → tomador cadastrado, data de hoje
//   emitir nota Simple Care Maria 150 10/11     → com a data do atendimento
//   nfse Simple Care                            → lista os cadastrados da empresa
//   nfse                                        → lista as empresas que emitem
//
// O robô monta a prévia e só emite depois do "sim" (citando a prévia ou em
// até VALIDADE_HORAS). A emissão roda em nfse-whatsapp-background.js, com as
// mesmas regras da tela (validação, duplicidade, reserva de número).
//
// Aqui ficam as regras sem banco nem rede (testes em
// __tests__/nfseWhatsapp.test.cjs).

const { parseValor } = require('./nfse/importador')
const recorrentes = require('./nfse/recorrentes')

const VALIDADE_HORAS = 2

const ESTADOS = { AGUARDANDO: 'aguardando', EMITINDO: 'emitindo', EMITIDA: 'emitida', CANCELADO: 'cancelado', ERRO: 'erro' }

// "nfse ...", "nfs-e ...", "nota: ...", "emitir nota ...", "emitir nfse ..."
// "nota fiscal chegou?" é conversa (não começa com o comando).
const RE_COMANDO = /^(?:emitir\s+(?:a\s+|uma\s+)?(?:nota(?:\s+fiscal)?|nfs-?e|nfse)|nfs-?e|nfse|nota\s*:)(?![\p{L}\d])[\s:.\-–—]*([\s\S]*)$/iu

function lerComandoNfse(texto) {
  const m = RE_COMANDO.exec(String(texto || '').trim())
  return m ? { resto: m[1].replace(/\s+/g, ' ').trim() } : null
}

// "sim", "s", "emitir", "pode emitir", "confirmo" / "não", "n", "cancelar"
function lerConfirmacao(texto) {
  const t = String(texto || '').trim()
  if (/^(?:sim|s|emitir|emite|pode\s+emitir|confirmo|confirmar)(?![\p{L}\d])[\s.!]*$/iu.test(t)) return 'sim'
  if (/^(?:n[aã]o|n|cancela(?:r)?|n[aã]o\s+emitir)(?![\p{L}\d])[\s.!]*$/iu.test(t)) return 'nao'
  return null
}

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}
const digitos = (s) => String(s || '').replace(/\D/g, '')
const VAZIAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'MEI', 'CIA', 'EI', 'SLU', 'COM', 'PARA', 'NOTA', 'NFSE', 'NFS', 'EMITIR', 'VALOR', 'REAIS', 'SEMANA',
  // palavras de pedido em texto livre ("preciso emitir uma nota pra Maria")
  'NOTAS', 'NF', 'FISCAL', 'FISCAIS', 'EMITE', 'EMITA', 'EMITIMOS', 'PRECISO', 'PRECISA', 'PRECISAMOS', 'PRA', 'UMA', 'UM',
  'FAZER', 'FAZ', 'FACA', 'GERAR', 'GERA', 'TIRAR', 'TIRA', 'POR', 'FAVOR', 'PODE', 'PODERIA', 'NO', 'NA', 'EM', 'OI', 'OLA',
  'PESSOAL', 'SOLICITO', 'PEDIDO', 'HOJE', 'ATENDIMENTO', 'CLIENTE'])
function palavras(s) {
  return semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .filter((p) => p.length >= 2 && !/^\d+$/.test(p) && !VAZIAS.has(p))
}

// CPFs/CNPJs escritos no texto (com ou sem pontuação), só os dígitos.
const documentosNoTexto = (texto) => (String(texto || '').match(/\d[\d./-]{9,17}\d/g) || [])
  .map(digitos).filter((d) => d.length === 11 || d.length === 14)

// Quantas palavras do nome (ou de um apelido) aparecem no texto.
function pontuar(nomes, alvo) {
  let melhor = 0
  for (const nome of nomes) {
    const ps = palavras(nome)
    if (!ps.length) continue
    const n = ps.filter((p) => alvo.has(p)).length
    if (n > melhor) melhor = n
  }
  return melhor
}

// O item com mais palavras batendo; empate ou nenhum → null.
function melhorPorNome(itens, nomesDe, texto) {
  const alvo = new Set(palavras(texto))
  for (const d of documentosNoTexto(texto)) {
    const porDoc = itens.filter((i) => [i.cpf, i.cnpj].some((x) => digitos(x) === d))
    if (porDoc.length === 1) return porDoc[0]
  }
  let top = 0
  let achados = []
  for (const i of itens) {
    const p = pontuar(nomesDe(i), alvo)
    if (p > top) { top = p; achados = [i] } else if (p === top && p > 0) achados.push(i)
  }
  return top > 0 && achados.length === 1 ? achados[0] : null
}

// Data (dd/mm ou dd/mm/aaaa) e valor do texto. Data sem ano: o ano de hoje
// (ou o anterior, se a data cairia no futuro).
function extrairDataValor(texto, hoje) {
  let resto = ` ${texto} `
  let data = null
  const md = /\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/.exec(resto)
  if (md) {
    let ano = md[3] ? Number(md[3].length === 2 ? `20${md[3]}` : md[3]) : Number(hoje.slice(0, 4))
    const iso = (a) => `${a}-${String(md[2]).padStart(2, '0')}-${String(md[1]).padStart(2, '0')}`
    if (!md[3] && iso(ano) > hoje) ano -= 1
    const d = new Date(`${iso(ano)}T12:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso(ano)) data = iso(ano)
    resto = resto.replace(md[0], ' ')
  }
  let valor = null
  const tokens = resto.split(/\s+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tk = tokens[i].replace(/^r\$/i, '')
    const temReal = /^r\$/i.test(tokens[i]) || /^r\$$/i.test(tokens[i - 1] || '')
    if (!/^\d[\d.]*(?:,\d{1,2})?$/.test(tk)) continue
    // número solto e comprido demais (CPF/CNPJ) não é valor
    if (!temReal && !tk.includes(',') && digitos(tk).length > 7) continue
    const v = parseValor(tk)
    if (v && Number(v) > 0) {
      valor = v
      resto = resto.replace(tokens[i], ' ')
      break
    }
  }
  return { data, valor, resto: resto.replace(/\s+/g, ' ').trim() }
}

// Semana da nota recorrente: a da data informada; senão a última semana já
// fechada ainda sem nota; senão a semana em andamento.
// semanas: recorrentes.semanasDoModelo(...)
function escolherSemana(semanas, data) {
  if (data) return semanas.find((s) => recorrentes.naSemana(data, s)) || null
  const fechadas = semanas.filter((s) => !s.emAndamento && s.situacao === 'a_emitir')
  if (fechadas.length) return fechadas[fechadas.length - 1]
  return semanas.find((s) => s.emAndamento && s.situacao === 'a_emitir') || null
}

// Empresa deduzida pelo tomador citado ("nota pra Friocargo"), quando ele está cadastrado em
// uma empresa só. Tomador comum a várias (ex.: MMS em três MEIs) → null.
function empresaPeloTomador(empresas, cadastros, texto) {
  const itens = []
  for (const e of empresas) {
    const cad = (cadastros || {})[e.cliente_id] || {}
    for (const t of cad.tomadores || []) if (t.ativo !== false) itens.push({ e, cpf: t.cpf, nomes: [t.nome, ...(Array.isArray(t.apelidos) ? t.apelidos : [])] })
    for (const m of cad.modelos || []) if (m.ativo !== false) itens.push({ e, cpf: m.cpf, nomes: [m.nome] })
    for (const m of cad.mei || []) if (m.ativo !== false && m.tomador_nome) itens.push({ e, cpf: m.tomador_doc, nomes: [m.tomador_nome] })
  }
  const achado = melhorPorNome(itens, (i) => i.nomes, texto)
  if (!achado) return null
  // o mesmo tomador (mesmo nome/documento) em outra empresa torna a escolha ambígua
  const alvo = new Set(palavras(texto))
  const empate = itens.filter((i) => i.e !== achado.e && (digitos(i.cpf) && digitos(i.cpf) === digitos(achado.cpf)
    || pontuar(i.nomes, alvo) === pontuar(achado.nomes, alvo)))
  return empate.length ? null : achado.e
}

// Interpreta o pedido.
//   empresas:   [{ cliente_id, nome, ambiente, descricao_padrao }]  (nfse_empresas + clientes.nome)
//   cadastros:  { [cliente_id]: { modelos: nfse_recorrentes[], tomadores: nfse_tomadores[] } }
// Devolve { erro, lista? } ou { empresa, tipo: 'recorrente'|'tomador', item, valor, data, resto }.
function interpretarPedido(texto, { empresas, cadastros, hoje }) {
  const ativas = (empresas || []).filter((e) => e.ativo !== false)
  if (!ativas.length) return { erro: 'Nenhuma empresa está configurada para emitir NFS-e no gestor (Emitir NFS-e).' }
  const { data, valor, resto } = extrairDataValor(texto || '', hoje)

  const empresa = ativas.length === 1 ? ativas[0]
    : melhorPorNome(ativas, (e) => [e.nome], resto) || empresaPeloTomador(ativas, cadastros, resto)
  if (!empresa) {
    return {
      erro: resto ? `Não sei de qual empresa é a nota ("${resto.slice(0, 60)}").` : 'Diga de qual empresa é a nota.',
      lista: { titulo: 'Empresas que emitem NFS-e pelo gestor', itens: ativas.map((e) => `${e.nome}${e.mei ? ' (MEI)' : ''}`) },
      valor, data,
    }
  }

  const cad = (cadastros || {})[empresa.cliente_id] || {}
  const modelos = (cad.modelos || []).filter((m) => m.ativo !== false && m.periodicidade === 'semanal')
  const tomadores = (cad.tomadores || []).filter((t) => t.ativo !== false)
  // MEI (Emissor Nacional, nfse_mei_modelos): o "tomador" é o do modelo
  const modelosMei = (cad.mei || []).filter((m) => m.ativo !== false)
    .map((m) => ({ ...m, nome: m.tomador_nome || 'Tomador não identificado', cpf: m.tomador_doc || '' }))
  const todos = [
    ...modelos.map((m) => ({ tipo: 'recorrente', item: m, nomes: [m.nome] })),
    ...tomadores.map((t) => ({ tipo: 'tomador', item: t, nomes: [t.nome, ...(Array.isArray(t.apelidos) ? t.apelidos : [])] })),
    ...modelosMei.map((m) => ({ tipo: 'mei', item: m, nomes: [m.nome] })),
  ]
  const nomesListados = [
    ...modelos.map((m) => `${m.nome} (recorrente semanal)`),
    ...tomadores.map((t) => t.nome),
    ...modelosMei.map((m) => `${m.nome} (modelo MEI${m.valor != null ? ` — ${brl(m.valor)}` : ''})`),
  ].slice(0, 30)
  if (!todos.length) {
    return { erro: empresa.mei
      ? `${empresa.nome} (MEI) não tem modelo de nota. Cadastre em Documentos → NFS-e MEI.`
      : `${empresa.nome} não tem tomador cadastrado nem nota recorrente. Cadastre em Emitir NFS-e.` }
  }

  // tira o nome da empresa do texto antes de procurar o tomador
  const palavrasEmpresa = new Set(palavras(empresa.nome))
  const textoTomador = palavras(resto).filter((p) => !palavrasEmpresa.has(p)).join(' ') || (todos.length === 1 ? '' : resto)
  const docs = documentosNoTexto(resto)
  const achado = todos.length === 1 && !textoTomador
    ? todos[0]
    : melhorPorNome(todos.map((x) => ({ ...x, cpf: x.item.cpf })), (x) => x.nomes, [textoTomador, ...docs].join(' '))
  if (!achado) {
    return {
      erro: textoTomador ? `Não achei "${textoTomador.toLowerCase()}" entre os cadastrados de ${empresa.nome}.` : `Para quem é a nota de ${empresa.nome}?`,
      lista: { titulo: `Cadastrados de ${empresa.nome}`, itens: nomesListados },
      empresa, valor, data,
    }
  }

  const valorFinal = valor || (achado.item.valor != null ? String(Number(achado.item.valor).toFixed(2)) : null)
    || (achado.item.valor_padrao != null ? String(Number(achado.item.valor_padrao).toFixed(2)) : null)
  const unico = todos.length === 1
  if (!valorFinal) return { erro: `Falta o valor da nota de ${achado.item.nome}.`, empresa, item: achado.item, unico, data }
  if (data && data > hoje) return { erro: 'A data do atendimento não pode ser futura.', empresa, item: achado.item, unico, valor: valorFinal }

  return { empresa, tipo: achado.tipo, item: achado.item, valor: valorFinal, data, resto, unico }
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

// Prévia enviada no grupo. dados: o que vai em nfse_whatsapp_pedidos.dados.
function previa(dados) {
  if (dados.tipo === 'mei') return previaMei(dados)
  const amb = dados.ambiente === 'producao' ? '' : '\n🧪 *Homologação (teste)* — a nota não tem validade.'
  const doc = dados.cpf ? `\n🪪 ${dados.cpf.length === 14 ? 'CNPJ' : 'CPF'} ${dados.cpf}` : '\n⚠️ Tomador sem CPF/CNPJ no cadastro.'
  const semana = dados.semana ? `\n🗓️ Semana de ${dataBR(dados.semana)} a ${dataBR(dados.semana_fim)}` : ''
  return `🧾 *Emitir NFS-e?*\n🏢 ${dados.empresa_nome}\n👤 ${dados.nome}${doc}\n💰 ${brl(dados.valor)}\n📅 Atendimento em ${dataBR(dados.data)}${semana}`
    + `${dados.descricao ? `\n📝 ${dados.descricao.slice(0, 300)}` : ''}${amb}`
    + '\n\nResponda *sim* para emitir ou *não* para cancelar.'
}

// MEI: a nota vai para a fila do robô, que emite no Emissor Nacional (docs/nfse-mei.md).
// dados.repetida: nota igual (mesmo tomador, valor e mês) já pedida.
function previaMei(dados) {
  const doc = dados.cpf ? `\n🪪 ${dados.cpf.length === 14 ? 'CNPJ' : 'CPF'} ${dados.cpf}` : ''
  const rep = dados.repetida
    ? `\n\n⚠️ *Já existe nota igual neste mês* (${dados.repetida.numero ? `nº ${dados.repetida.numero}` : dados.repetida.status}). Com *sim*, sai outra mesmo assim.`
    : ''
  return `🧾 *Emitir NFS-e MEI?* (Emissor Nacional)\n🏢 ${dados.empresa_nome}\n👤 ${dados.nome}${doc}\n💰 ${brl(dados.valor)}\n📅 Competência ${dataBR(dados.data)}`
    + `\n📝 ${String(dados.descricao || '').slice(0, 300)}${rep}`
    + '\n\nResponda *sim* para mandar ao robô (ele emite no portal e manda o PDF no WhatsApp do cliente) ou *não* para cancelar.'
}

// ---------- pedido em texto livre e modelo da mensagem ----------

// "preciso emitir uma nota pra Maria de 150", "pode fazer a NF da Shopee?", "nota fiscal pra Friocargo".
// Conversa sobre nota ("a nota chegou?", "notas de outubro") não conta.
const VERBO = String.raw`(?:emit\p{L}*|ger(?:a|ar|e)\p{L}*|tir(?:a|ar|e)\p{L}*|faz\p{L}*|fa[çc]a|fazer|precis\p{L}*|solicit\p{L}*|ped(?:e|ir|indo)|lan[çc]a\p{L}*)`
const NOTA = String.raw`(?:notas?(?:\s+fisca(?:l|is))?|nfs-?e|nfse|nf)`
const RE_INTENCAO = [
  new RegExp(String.raw`(?<![\p{L}])${VERBO}(?![\p{L}])[^\n]{0,40}?(?<![\p{L}])${NOTA}(?![\p{L}\d])`, 'iu'),
  new RegExp(String.raw`(?<![\p{L}])${NOTA}\s+(?:pra|para)(?![\p{L}])`, 'iu'),
]
function pareceNfse(texto) {
  const t = String(texto || '').trim()
  if (!t || t.length > 300 || lerComandoNfse(t)) return false
  return RE_INTENCAO.some((re) => re.test(t))
}

// "SIMPLE CARE ODONTOLOGIA LTDA" → "Simple Care Odontologia" (o suficiente para o comando achar a empresa)
const SUFIXOS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'SLU', 'MEI', 'EI', '-'])
function nomeCurto(nome) {
  const ps = String(nome || '').trim().split(/\s+/)
    .filter((p) => p && !SUFIXOS.has(semAcento(p).toUpperCase().replace(/[.,]/g, '')) && !/^[\d./-]+$/.test(p))
    .slice(0, 3)
  return ps.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ') || String(nome || '')
}
const valorBR = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Modelo da mensagem para emitir, com o que já se sabe do pedido.
// r: retorno de interpretarPedido (com ou sem erro). Partes que faltam ficam em MAIÚSCULAS.
function modeloMensagem(r = {}) {
  const partes = ['nfse', r.empresa ? nomeCurto(r.empresa.nome) : 'EMPRESA']
  if (r.item) {
    if (!r.unico) partes.push(r.item.nome)
  } else {
    partes.push('TOMADOR')
  }
  partes.push(r.valor ? valorBR(r.valor) : 'VALOR')
  if (r.data) partes.push(dataBR(r.data).slice(0, 5))
  return partes.join(' ')
}

// Resposta com o modelo: explicação (o que falta) + o modelo em mensagem separada, fácil de copiar.
// Devolve [texto, modelo].
function respostaModelo(r, { textoLivre = false } = {}) {
  const modelo = modeloMensagem(r)
  const falta = (modelo.match(/\b(EMPRESA|TOMADOR|VALOR)\b/g) || []).map((x) => x.toLowerCase())
  const cabecalho = r.erro && !(textoLivre && !falta.length)
    ? `⚠️ ${r.erro}`
    : '🧾 *Entendi um pedido de NFS-e.*'
  const instrucao = falta.length
    ? `Copie a mensagem abaixo, troque ${falta.map((f) => `*${f.toUpperCase()}*`).join(falta.length === 3 ? ', ' : ' e ').replace(/, (?=[^,]*$)/, ' e ')} e mande no grupo:`
    : 'Para emitir, mande a mensagem abaixo (pode ajustar valor e data). Vou mostrar a prévia antes de emitir:'
  const dica = '\n_Data do atendimento opcional no fim (ex.: 10/11); sem data, vale hoje._'
  return [`${cabecalho}${textoLista(r.lista)}\n\n${instrucao}${dica}`, modelo]
}

function textoLista(lista) {
  if (!lista?.itens?.length) return ''
  return `\n\n*${lista.titulo}:*\n${lista.itens.map((i) => `• ${i}`).join('\n')}`
}

function ajuda() {
  return 'Exemplos:\n• *nfse Simple Care Shopee 1.250,00* (nota recorrente da semana)\n• *nfse Simple Care Maria Souza 150,00* (tomador cadastrado, data de hoje)\n• *nfse Simple Care Maria 150 10/11* (com a data do atendimento)\n• *nfse Monica Silva 8.000,00* (MEI: usa o modelo da empresa)'
}

module.exports = {
  VALIDADE_HORAS, ESTADOS, lerComandoNfse, lerConfirmacao, extrairDataValor, escolherSemana,
  interpretarPedido, previa, textoLista, ajuda, palavras, pareceNfse, modeloMensagem, respostaModelo, nomeCurto,
}
