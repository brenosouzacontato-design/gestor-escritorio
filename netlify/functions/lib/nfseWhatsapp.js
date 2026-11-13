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
const VAZIAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'MEI', 'CIA', 'EI', 'SLU', 'COM', 'PARA', 'NOTA', 'NFSE', 'NFS', 'EMITIR', 'VALOR', 'REAIS', 'SEMANA'])
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

// Interpreta o pedido.
//   empresas:   [{ cliente_id, nome, ambiente, descricao_padrao }]  (nfse_empresas + clientes.nome)
//   cadastros:  { [cliente_id]: { modelos: nfse_recorrentes[], tomadores: nfse_tomadores[] } }
// Devolve { erro, lista? } ou { empresa, tipo: 'recorrente'|'tomador', item, valor, data, resto }.
function interpretarPedido(texto, { empresas, cadastros, hoje }) {
  const ativas = (empresas || []).filter((e) => e.ativo !== false)
  if (!ativas.length) return { erro: 'Nenhuma empresa está configurada para emitir NFS-e no gestor (Emitir NFS-e).' }
  const { data, valor, resto } = extrairDataValor(texto || '', hoje)

  const empresa = ativas.length === 1 ? ativas[0] : melhorPorNome(ativas, (e) => [e.nome], resto)
  if (!empresa) {
    return {
      erro: resto ? `Não sei de qual empresa é a nota ("${resto.slice(0, 60)}").` : 'Diga de qual empresa é a nota.',
      lista: { titulo: 'Empresas que emitem NFS-e pelo gestor', itens: ativas.map((e) => e.nome) },
    }
  }

  const cad = (cadastros || {})[empresa.cliente_id] || {}
  const modelos = (cad.modelos || []).filter((m) => m.ativo !== false && m.periodicidade === 'semanal')
  const tomadores = (cad.tomadores || []).filter((t) => t.ativo !== false)
  const todos = [
    ...modelos.map((m) => ({ tipo: 'recorrente', item: m, nomes: [m.nome] })),
    ...tomadores.map((t) => ({ tipo: 'tomador', item: t, nomes: [t.nome, ...(Array.isArray(t.apelidos) ? t.apelidos : [])] })),
  ]
  const nomesListados = [
    ...modelos.map((m) => `${m.nome} (recorrente semanal)`),
    ...tomadores.map((t) => t.nome),
  ].slice(0, 30)
  if (!todos.length) return { erro: `${empresa.nome} não tem tomador cadastrado nem nota recorrente. Cadastre em Emitir NFS-e.` }

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
      empresa,
    }
  }

  const valorFinal = valor || (achado.item.valor != null ? String(Number(achado.item.valor).toFixed(2)) : null)
    || (achado.item.valor_padrao != null ? String(Number(achado.item.valor_padrao).toFixed(2)) : null)
  if (!valorFinal) return { erro: `Qual o valor da nota de ${achado.item.nome}? Mande de novo com o valor (ex.: "nfse ${empresa.nome} ${achado.item.nome} 150,00").`, empresa }
  if (data && data > hoje) return { erro: 'A data do atendimento não pode ser futura.', empresa }

  return { empresa, tipo: achado.tipo, item: achado.item, valor: valorFinal, data, resto }
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

// Prévia enviada no grupo. dados: o que vai em nfse_whatsapp_pedidos.dados.
function previa(dados) {
  const amb = dados.ambiente === 'producao' ? '' : '\n🧪 *Homologação (teste)* — a nota não tem validade.'
  const doc = dados.cpf ? `\n🪪 ${dados.cpf.length === 14 ? 'CNPJ' : 'CPF'} ${dados.cpf}` : '\n⚠️ Tomador sem CPF/CNPJ no cadastro.'
  const semana = dados.semana ? `\n🗓️ Semana de ${dataBR(dados.semana)} a ${dataBR(dados.semana_fim)}` : ''
  return `🧾 *Emitir NFS-e?*\n🏢 ${dados.empresa_nome}\n👤 ${dados.nome}${doc}\n💰 ${brl(dados.valor)}\n📅 Atendimento em ${dataBR(dados.data)}${semana}`
    + `${dados.descricao ? `\n📝 ${dados.descricao.slice(0, 300)}` : ''}${amb}`
    + '\n\nResponda *sim* para emitir ou *não* para cancelar.'
}

function textoLista(lista) {
  if (!lista?.itens?.length) return ''
  return `\n\n*${lista.titulo}:*\n${lista.itens.map((i) => `• ${i}`).join('\n')}`
}

function ajuda() {
  return 'Exemplos:\n• *nfse Simple Care Shopee 1.250,00* (nota recorrente da semana)\n• *nfse Simple Care Maria Souza 150,00* (tomador cadastrado, data de hoje)\n• *nfse Simple Care Maria 150 10/11* (com a data do atendimento)'
}

module.exports = {
  VALIDADE_HORAS, ESTADOS, lerComandoNfse, lerConfirmacao, extrairDataValor, escolherSemana,
  interpretarPedido, previa, textoLista, ajuda, palavras,
}
