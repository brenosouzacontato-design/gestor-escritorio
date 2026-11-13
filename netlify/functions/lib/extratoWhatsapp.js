// netlify/functions/lib/extratoWhatsapp.js
//
// Extrato bancário enviado no grupo "Documentos" do WhatsApp: o robô
// reconhece o extrato, identifica a empresa e pergunta se é pra importar.
// Com "sim", importar-extrato-background.mjs importa o extrato na
// contabilidade da empresa (plano padrão OneFlow, regras de classificação,
// "Valores a Identificar"), gera os lançamentos e devolve a DRE do período.
//
// Aqui ficam as regras sem banco nem rede (testes em
// __tests__/extratoWhatsapp.test.cjs); o fluxo está em whatsapp-webhook.js.

// Quanto tempo a pergunta vale para uma resposta que não cita a mensagem.
const VALIDADE_HORAS = 24

// Estados em documentos.whatsapp_decisao (supabase-schema-documentos-extrato-whatsapp.sql)
const AGUARDANDO = 'aguardando_extrato'
const IMPORTANDO = 'extrato_importando'
const IMPORTADO = 'extrato_importado'

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const digitos = (s) => String(s || '').replace(/\D/g, '')

// Palavras que não ajudam a achar a empresa pelo nome.
const PALAVRAS_VAZIAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S', 'A', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'MEI', 'CIA', 'EI', 'SLU'])

function palavras(nome) {
  return semAcento(nome).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/)
    .filter((p) => p && !/^\d+$/.test(p) && !PALAVRAS_VAZIAS.has(p))
}

// Empresa (cliente) do extrato. Ordem: CNPJ do titular igual ao do cadastro;
// raiz do CNPJ (8 dígitos — MEI costuma vir com ela no nome, ex. "48.976.362
// AMANDA LIMA GONCALVES"); nome do titular batendo com um cliente só; e, por
// último, o cliente que a identificação geral sugeriu.
// clientes: [{ id, nome, cnpj }] → cliente ou null
function acharEmpresaDoExtrato(extrato, clientes, clienteIdSugerido = null) {
  const lista = clientes || []
  const doc = digitos(extrato?.titularDocumento)
  if (doc.length === 14) {
    const igual = lista.find((c) => digitos(c.cnpj) === doc)
    if (igual) return igual
    const raiz = lista.filter((c) => digitos(c.cnpj).slice(0, 8) === doc.slice(0, 8) || digitos(c.nome).startsWith(doc.slice(0, 8)))
    if (raiz.length === 1) return raiz[0]
  }
  if (doc.length === 8) {
    const raiz = lista.filter((c) => digitos(c.cnpj).slice(0, 8) === doc || digitos(c.nome).startsWith(doc))
    if (raiz.length === 1) return raiz[0]
  }
  const pelaNome = acharEmpresaPorTexto(extrato?.titularNome, lista)
  if (pelaNome) return pelaNome
  return (clienteIdSugerido && lista.find((c) => c.id === clienteIdSugerido)) || null
}

// "Amanda", "amanda lima", "48976362", "48.976.362/0001-49" → cliente, se
// só um bater. Nome: todas as palavras digitadas aparecem no nome do
// cliente (ou todas as do cliente no texto, pra nome do titular mais longo).
function acharEmpresaPorTexto(texto, clientes) {
  const lista = clientes || []
  const t = String(texto || '').trim()
  if (!t) return null
  const d = digitos(t)
  if (d.length >= 8 && d.length >= t.replace(/[\s./-]/g, '').length - 1) {
    const achados = lista.filter((c) => digitos(c.cnpj).startsWith(d.slice(0, Math.min(d.length, 14))) || digitos(c.nome).startsWith(d.slice(0, 8)))
    return achados.length === 1 ? achados[0] : null
  }
  const alvo = palavras(t)
  if (!alvo.length) return null
  const candidatos = lista.filter((c) => {
    const nome = palavras(c.nome)
    if (!nome.length) return false
    const nomeSet = new Set(nome)
    const alvoSet = new Set(alvo)
    return alvo.every((p) => nomeSet.has(p)) || nome.every((p) => alvoSet.has(p))
  })
  return candidatos.length === 1 ? candidatos[0] : null
}

// Resposta à pergunta "importar o extrato?".
// "sim", "s", "importar", "pode importar", "sim amanda lima" → { acao: 'importar', empresa: 'amanda lima' | null }
// "não", "nao", "n", "não importar" → { acao: 'recusar' }; outra coisa → null
function lerRespostaExtrato(texto) {
  const t = String(texto || '').trim()
  if (!t) return null
  const sim = /^(?:sim|s|importar?|pode importar)(?![\p{L}\d])[\s,:.\-–—!]*([\s\S]*)$/iu.exec(t)
  if (sim) {
    const resto = sim[1].replace(/\s+/g, ' ').trim()
    // "sim, pode" / "sim por favor" não é nome de empresa
    const empresa = resto && !/^(pode|por favor|obrigad[oa]|importa(r)?)\b/i.test(resto) ? resto.slice(0, 120) : null
    return { acao: 'importar', empresa }
  }
  if (/^(?:n[aã]o|n)(?![\p{L}\d])[\s.!]*(?:importa(?:r)?)?[\s.!]*$/iu.test(t)) return { acao: 'recusar' }
  return null
}

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

function textoPeriodo(extrato) {
  if (extrato?.periodoInicio && extrato?.periodoFim) return `${fmtData(extrato.periodoInicio)} a ${fmtData(extrato.periodoFim)}`
  return extrato?.periodoInicio ? `a partir de ${fmtData(extrato.periodoInicio)}` : ''
}

// Bloco anexado à resposta "Documento salvo" quando o arquivo é um extrato.
function perguntaExtrato(extrato, empresa) {
  const banco = extrato?.banco ? ` — ${extrato.banco}` : ''
  const periodo = textoPeriodo(extrato)
  const cabecalho = `\n\n🏦 *Extrato bancário*${banco}${periodo ? `\n📅 ${periodo}` : ''}`
  if (empresa) {
    return `${cabecalho}\n👤 ${empresa.nome}\n\n❓ *Importo para a contabilidade dessa empresa?*\nResponda *sim* para importar, gerar os lançamentos (padrão OneFlow) e a DRE, ou *não* para só arquivar.`
  }
  const titular = extrato?.titularNome ? ` (titular no extrato: ${extrato.titularNome})` : ''
  return `${cabecalho}\n⚠️ Não identifiquei a empresa${titular}.\n\n❓ *Importo para a contabilidade?*\nResponda *sim* + o nome ou CNPJ da empresa (ex.: *sim Amanda Lima*) ou *não* para só arquivar.`
}

function respostaImportando(empresa) {
  return `⏳ *Importando o extrato de ${empresa.nome}…*\nLendo as transações, gerando os lançamentos e a DRE. Aviso aqui quando terminar.`
}

function respostaRecusado(doc) {
  return `🗄️ *Ok, não importei.*\n📄 ${doc.nome_arquivo} ficou arquivado em Documentos → Concluídos.`
}

function respostaSemEmpresa(texto) {
  return texto
    ? `⚠️ Não achei uma empresa só com "${texto}". Responda *sim* + o nome completo ou o CNPJ da empresa.`
    : '⚠️ Preciso saber de qual empresa é o extrato. Responda *sim* + o nome ou CNPJ da empresa (ex.: *sim Amanda Lima*).'
}

// Resumo enviado no grupo quando a importação termina.
// res: retorno de importarExtrato (lib/importarExtrato.mjs) + linkDre
function resultadoImportacao(empresa, res) {
  const linhas = [`✅ *Extrato importado — ${empresa.nome}*`]
  linhas.push(`🏦 ${res.contaBanco.nome} (${res.contaBanco.codigo})${res.contaBancoCriada ? ' — conta criada agora' : ''}`)
  if (res.periodo) linhas.push(`📅 ${fmtData(res.periodo.dataInicio)} a ${fmtData(res.periodo.dataFim)}`)
  linhas.push(`📥 ${res.criados} lançamento${res.criados === 1 ? '' : 's'} gerado${res.criados === 1 ? '' : 's'}${res.pulados ? ` (${res.pulados} já tinha${res.pulados === 1 ? '' : 'm'} sido importado${res.pulados === 1 ? '' : 's'})` : ''}`)
  linhas.push(`✔️ ${res.classificadas} classificado${res.classificadas === 1 ? '' : 's'} pelas regras · ⏳ ${res.pendentes} em Valores a Identificar`)
  linhas.push(`💰 Entradas ${fmtBRL(res.totalEntradas)} · Saídas ${fmtBRL(res.totalSaidas)}`)
  if (res.planoCriado) linhas.push('🗂️ A empresa não tinha plano de contas: apliquei o plano padrão OneFlow.')
  if (res.avisos?.length) linhas.push(...res.avisos.slice(0, 3).map((a) => `⚠️ ${a}`))
  if (res.dre) {
    linhas.push('', '📊 *DRE do período*')
    linhas.push(`Receitas: ${fmtBRL(res.dre.totalReceitas)}`)
    if (res.dre.totalCustos) linhas.push(`Custos: ${fmtBRL(res.dre.totalCustos)}`)
    linhas.push(`Despesas: ${fmtBRL(res.dre.totalDespesas)}`)
    linhas.push(`*Resultado: ${fmtBRL(res.dre.resultado)}*`)
    if (res.linkDre) linhas.push(`🔗 ${res.linkDre}`)
  }
  if (res.pendentes) linhas.push('', 'Classifique os pendentes em Gestor → Contábil → Lançamentos para completar a DRE.')
  return linhas.join('\n')
}

module.exports = {
  VALIDADE_HORAS, AGUARDANDO, IMPORTANDO, IMPORTADO,
  acharEmpresaDoExtrato, acharEmpresaPorTexto, lerRespostaExtrato,
  perguntaExtrato, respostaImportando, respostaRecusado, respostaSemEmpresa, resultadoImportacao,
}
