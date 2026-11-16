// Central de Mensagens — modelos padrão, variáveis e montagem do texto.
// Usado pela tela (src/pages/mensagens/MensagensPage.jsx). Os mesmos modelos
// padrão entram no banco por supabase-schema-central-mensagens.sql; aqui
// ficam para "Restaurar o texto padrão". A cobrança automática de honorários
// (netlify/functions/lib/honorariosLembrete.js) usa o modelo de chave
// 'cobranca_honorario' do banco, com as mesmas variáveis {nome}, {referencia},
// {valor}, {vencimento}, {pix_chave} e {pix_favorecido}.

export const VARIAVEIS = [
  { id: 'nome', desc: 'Nome da empresa' },
  { id: 'socio', desc: 'Nome do sócio (ou da empresa, se não tiver)' },
  { id: 'cnpj', desc: 'CNPJ/CPF' },
  { id: 'competencia', desc: 'Competência (ex.: 10/2026)' },
  { id: 'referencia', desc: 'Honorário em aberto (ex.: honorário de 10/2026)' },
  { id: 'valor', desc: 'Valor do honorário em aberto' },
  { id: 'vencimento', desc: 'Vencimento do honorário em aberto' },
  { id: 'pix_chave', desc: 'Chave PIX do escritório' },
  { id: 'pix_favorecido', desc: 'Favorecido do PIX' },
  { id: 'data_hoje', desc: 'Data de hoje' },
]

export const MODELOS_PADRAO = [
  {
    chave: 'cobranca_honorario', categoria: 'Honorários', nome: 'Cobrança de honorário vencido',
    texto: '🧾 *Lembrete de honorário contábil*\nOlá, {nome}! O {referencia} no valor de {valor} venceu em {vencimento}.\n\n💳 Chave PIX: {pix_chave}\n👤 {pix_favorecido}\n\nSe já pagou, pode desconsiderar. Qualquer dúvida, é só chamar por aqui.',
  },
  {
    chave: 'honorario_a_vencer', categoria: 'Honorários', nome: 'Honorário vence em breve',
    texto: 'Olá, {nome}! Passando para lembrar que o {referencia}, no valor de {valor}, vence em {vencimento}.\n\n💳 Chave PIX: {pix_chave}\n👤 {pix_favorecido}\n\nObrigado!',
  },
  {
    chave: 'reajuste_honorario', categoria: 'Honorários', nome: 'Aviso de reajuste de honorários',
    texto: 'Olá, {nome}! Informamos que, a partir da próxima competência, os honorários contábeis serão reajustados conforme o contrato. Qualquer dúvida, estamos à disposição.',
  },
  {
    chave: 'documentos_mes', categoria: 'Documentos', nome: 'Pedido de documentos do mês',
    texto: 'Olá, {nome}! Para fecharmos a competência {competencia}, precisamos dos documentos do mês: extratos bancários, notas fiscais de entrada e saída e comprovantes de despesas. Pode mandar por aqui mesmo. Obrigado!',
  },
  {
    chave: 'guias_disponiveis', categoria: 'Impostos', nome: 'Guias do mês disponíveis',
    texto: 'Olá, {nome}! As guias da competência {competencia} já estão disponíveis no seu painel. Confira os valores e vencimentos e, depois de pagar, mande o comprovante por aqui.',
  },
  {
    chave: 'lembrete_das', categoria: 'Impostos', nome: 'Lembrete de vencimento do DAS',
    texto: 'Olá, {nome}! Lembrete: o DAS da competência {competencia} vence no dia 20. Se já pagou, pode desconsiderar e, se puder, mande o comprovante por aqui.',
  },
  {
    chave: 'recesso', categoria: 'Avisos', nome: 'Aviso de recesso do escritório',
    texto: 'Olá, {nome}! Informamos que o escritório estará em recesso nos próximos dias. Os atendimentos voltam ao normal no próximo dia útil. Em caso de urgência, deixe sua mensagem por aqui.',
  },
  {
    chave: 'boas_vindas', categoria: 'Avisos', nome: 'Boas-vindas ao cliente',
    texto: 'Olá, {socio}! Seja bem-vindo(a) ao nosso escritório. Por este número você fala direto com a equipe: pode mandar documentos, tirar dúvidas e receber suas guias. Conte com a gente!',
  },
]

// Nome sem o CNPJ/CPF que alguns cadastros têm na frente ("12.345.678 FULANO")
export const nomeCurto = (nome) => String(nome || '').replace(/^[\d./-]+\s+/, '').trim()

const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

// Valores das variáveis para uma empresa. honorario: o pendente mais antigo dela (ou null)
export function valoresDoCliente(cliente, { competencia, honorario = null, pix = {} } = {}) {
  return {
    nome: nomeCurto(cliente?.nome),
    socio: cliente?.socio_nome || nomeCurto(cliente?.nome),
    cnpj: cliente?.cnpj || cliente?.cpf || '',
    competencia: competencia || '',
    referencia: honorario ? (honorario.tipo === 'avulso' ? (honorario.descricao || 'serviço avulso') : `honorário de ${honorario.competencia}`) : '',
    valor: honorario?.valor != null ? moeda(honorario.valor) : '',
    vencimento: dataBR(honorario?.vencimento),
    pix_chave: pix.chave || '',
    pix_favorecido: pix.favorecido || '',
    data_hoje: new Date().toLocaleDateString('pt-BR'),
  }
}

// Troca {variavel} pelo valor. Devolve o texto e as variáveis usadas que ficaram sem valor.
// Linha que só tinha uma variável vazia (ex.: "👤 {pix_favorecido}") some.
export function montarTexto(modelo, valores) {
  const faltando = new Set()
  const linhas = String(modelo || '').split('\n').map((linha) => {
    let vazia = false
    const nova = linha.replace(/\{(\w+)\}/g, (inteiro, v) => {
      if (!(v in valores)) return inteiro
      const val = valores[v]
      if (val === '' || val == null) { faltando.add(v); vazia = true; return '' }
      return String(val)
    })
    return vazia && !nova.replace(/[^\p{L}\p{N}]/gu, '') ? null : nova
  })
  return { texto: linhas.filter((l) => l !== null).join('\n').trim(), faltando: [...faltando] }
}

// Mesmo critério de netlify/functions/lib/telefone.js: só celular com DDD (sem chute)
export function celularWhatsapp(bruto) {
  let d = String(bruto || '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 11) return null
  const ddd = Number(d.slice(0, 2))
  if (ddd < 11 || ddd > 99 || d[2] !== '9') return null
  return `55${d}`
}
