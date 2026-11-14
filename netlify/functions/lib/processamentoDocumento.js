// netlify/functions/lib/processamentoDocumento.js
//
// Grupo "Documentos" do WhatsApp: todo arquivo que chega (menos comprovante
// de pagamento e extrato bancário, que já têm fluxo próprio) recebe um menu
// numerado com o que dá pra fazer com ele, conforme o tipo que a IA leu:
//
//   Declaração do Simples ... carregar no painel do cliente (faturamento, RBT12, DAS)
//   CND / Situação Fiscal ... anexar a certidão (ou o relatório) ao painel do cliente
//   Guia de parcelamento .... cadastrar/atualizar o parcelamento
//   Boletos e guias ......... anexar e dar baixa na obrigação ou tarefa em aberto
//   qualquer documento ...... anexar ao painel do cliente, criar tarefa, só arquivar
//
// O grupo responde com o número (ou a palavra: "simples", "cnd",
// "parcelamento", "baixa", "painel", "tarefa", "arquivar"). Junto do número
// dá pra escrever o nome ou CNPJ da empresa quando a IA não achou
// ("1 Amanda Lima"), ou a descrição da tarefa ("5 pedir extrato").
//
// Aqui ficam as regras sem banco nem rede (testes em
// __tests__/processamentoDocumento.test.cjs). O fluxo está em
// whatsapp-webhook.js (menu e escolha) e documento-processar-background.mjs
// (o processamento em si).

// Estados em documentos.whatsapp_decisao (supabase-schema-documentos-processamento-whatsapp.sql)
const AGUARDANDO = 'aguardando'
const PROCESSANDO = 'processando'
const PROCESSADO = 'processado'

// Ações que rodam na background function (as outras, tarefa e arquivar, são
// rápidas e ficam no próprio webhook).
const ACOES_BACKGROUND = ['simples', 'cnd', 'parcelamento', 'baixa', 'painel']

// Máximo de obrigações/tarefas oferecidas para baixa no mesmo menu.
const MAX_BAIXAS = 3

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Categoria do documento: a que a IA devolveu (identificarDocumento) ou,
// se ela não veio, a que dá pra deduzir do tipo e do nome do arquivo.
function categoriaDoDocumento({ categoria, tipoDocumento, nomeArquivo } = {}) {
  if (categoria && categoria !== 'outro') return categoria
  const t = semAcento(`${tipoDocumento || ''} ${nomeArquivo || ''}`).toLowerCase()
  if (/extrato (bancario|de conta)/.test(t)) return 'extrato'
  if (/parcmei|sispar|parcelamento/.test(t)) return 'parcelamento'
  if (/pgdas|declaracao (do )?simples|apuracao do simples|extrato do simples/.test(t)) return 'declaracao_simples'
  if (/situacao fiscal/.test(t)) return 'situacao_fiscal'
  if (/\bcnd\b|certidao|cpen/.test(t)) return 'cnd'
  if (/\bguia\b|boleto|\bdas\b|das-?mei|darf|\bgps\b|fgts|dctfweb|\biss\b|icms|\bdae\b|\bgare\b/.test(t)) return 'guia'
  return categoria || 'outro'
}

const ROTULOS = {
  simples: '📊 Carregar no painel do cliente (faturamento, RBT12, alíquota e DAS)',
  cnd: '🧾 Anexar a CND ao painel do cliente',
  situacao_fiscal: '🧾 Carregar o Relatório de Situação Fiscal no painel do cliente',
  parcelamento: '📑 Cadastrar/atualizar o parcelamento',
  painel: '📎 Anexar ao painel do cliente (Documentos)',
  tarefa: '📝 Criar uma tarefa',
  arquivar: '🗄️ Só arquivar',
}

function rotuloBaixa(c) {
  return `✅ Anexar e dar baixa: ${c.rotulo}${c.clienteNome ? ` (${c.clienteNome})` : ''}`
}

const alvoDe = (c) => ({ tipo: c.tipo, id: c.id, obrigacaoId: c.obrigacaoId || null, rotulo: c.rotulo, clienteId: c.clienteId || null })

// Menu do documento. Devolve [{ n, acao, rotulo, alvo?, fixo? }], na ordem em
// que aparece no grupo (n = 1, 2, 3...).
//   categoria .......... categoriaDoDocumento(...)
//   pdf ................ o arquivo é PDF (Simples, CND e parcelamento só leem PDF)
//   candidato .......... obrigação/tarefa que a IA sugeriu (listarCandidatosDocumento), ou null
//   candidatosDoCliente  outras obrigações/tarefas em aberto da mesma empresa
function montarOpcoes({ categoria = 'outro', pdf = true, candidato = null, candidatosDoCliente = [] } = {}) {
  const itens = []
  const baixas = []
  if (candidato) baixas.push(candidato)
  // boleto/guia: além da sugerida, as outras em aberto da empresa
  if (categoria === 'guia' || categoria === 'parcelamento') {
    for (const c of candidatosDoCliente) {
      if (baixas.length >= MAX_BAIXAS) break
      if (!baixas.some((b) => b.id === c.id)) baixas.push(c)
    }
  }

  if (pdf && categoria === 'declaracao_simples') itens.push({ acao: 'simples', rotulo: ROTULOS.simples })
  if (pdf && categoria === 'cnd') itens.push({ acao: 'cnd', rotulo: ROTULOS.cnd })
  if (pdf && categoria === 'situacao_fiscal') itens.push({ acao: 'cnd', rotulo: ROTULOS.situacao_fiscal })
  if (pdf && categoria === 'parcelamento') itens.push({ acao: 'parcelamento', rotulo: ROTULOS.parcelamento })
  for (const c of baixas) itens.push({ acao: 'baixa', rotulo: rotuloBaixa(c), alvo: alvoDe(c) })
  // documento avulso (contrato, alvará...) fica fixo no painel; guia fica na competência
  itens.push({ acao: 'painel', rotulo: ROTULOS.painel, fixo: !['guia', 'parcelamento'].includes(categoria) })
  itens.push({ acao: 'tarefa', rotulo: ROTULOS.tarefa })
  itens.push({ acao: 'arquivar', rotulo: ROTULOS.arquivar })
  return itens.map((o, i) => ({ n: i + 1, ...o }))
}

// Bloco de texto do menu, anexado à resposta "Documento recebido".
function textoMenu(opcoes) {
  const linhas = (opcoes || []).map((o) => `*${o.n}* ${o.rotulo}`)
  const nTarefa = (opcoes || []).find((o) => o.acao === 'tarefa')?.n
  const nPrimeira = opcoes?.[0]?.n || 1
  return `\n\n❓ *O que faço com ele?* Responda com o número:\n${linhas.join('\n')}`
    + `\n\n_Se a empresa não foi identificada, escreva junto (ex.: "${nPrimeira} Amanda Lima")${nTarefa ? `; para a tarefa, a descrição (ex.: "${nTarefa} pedir extrato")` : ''}._`
}

// Palavras aceitas no lugar do número.
const PALAVRAS = [
  { acao: 'simples', re: /^(?:simples|declara[cç][aã]o(?:\s+do\s+simples)?|pgdas(?:-?d)?)/iu },
  { acao: 'cnd', re: /^(?:cnd|certid[aã]o|situa[cç][aã]o\s+fiscal|relat[oó]rio)/iu },
  { acao: 'parcelamento', re: /^(?:parcelamento|parcelar)/iu },
  { acao: 'baixa', re: /^(?:dar\s+)?baix(?:ar|a)/iu },
  { acao: 'painel', re: /^(?:painel|anexar(?:\s+(?:ao|no)\s+painel)?)/iu },
  { acao: 'tarefa', re: /^tarefa/iu },
  { acao: 'arquivar', re: /^arquiv(?:ado|ar|a|e|o)/iu },
]

// Ações que fazem sentido sem estar no menu (pela palavra): ex. a IA não
// reconheceu a declaração do Simples, mas o grupo sabe que é.
const AVULSAS = ['simples', 'cnd', 'parcelamento', 'painel', 'tarefa', 'arquivar']

const limparComplemento = (s) => String(s || '').replace(/^[\s:.\-–—)]+/, '').replace(/\s+/g, ' ').trim().slice(0, 200)

// Resposta do grupo ao menu → { opcao, complemento } ou null (não é escolha).
// "3", "3 - Amanda Lima", "tarefa: pedir extrato", "simples", "baixa"...
// "baixa" e "arquivar" não levam complemento: "2 guias anexas" é conversa.
function lerEscolha(texto, opcoes) {
  const t = String(texto || '').trim()
  if (!t || !Array.isArray(opcoes) || !opcoes.length) return null

  let opcao = null
  let resto = ''
  const num = /^(\d{1,2})(?![\d.,/])([\s\S]*)$/.exec(t)
  if (num) {
    if (num[2] && !/^[\s:.\-–—)]/.test(num[2])) return null // "1ª", "2x"...
    opcao = opcoes.find((o) => o.n === Number(num[1])) || null
    if (!opcao) return null
    resto = num[2]
  } else {
    const palavra = PALAVRAS.find((p) => p.re.test(t))
    if (!palavra) return null
    const m = palavra.re.exec(t)
    resto = t.slice(m[0].length)
    if (resto && /^[\p{L}\d]/u.test(resto)) return null // "tarefas de hoje", "painelzinho"
    opcao = opcoes.find((o) => o.acao === palavra.acao)
      || (AVULSAS.includes(palavra.acao) ? { n: null, acao: palavra.acao, rotulo: ROTULOS[palavra.acao] || palavra.acao, fixo: true } : null)
    if (!opcao) return null
  }
  const complemento = limparComplemento(resto)
  if (complemento && (opcao.acao === 'arquivar' || opcao.acao === 'baixa')) return null
  return { opcao, complemento: complemento || null }
}

module.exports = {
  AGUARDANDO, PROCESSANDO, PROCESSADO, ACOES_BACKGROUND, MAX_BAIXAS, ROTULOS,
  categoriaDoDocumento, montarOpcoes, textoMenu, lerEscolha,
}
