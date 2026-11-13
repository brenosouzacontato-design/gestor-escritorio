// netlify/functions/lib/importarExtrato.mjs
//
// Importa um extrato bancário (PDF) na contabilidade de uma empresa, do
// mesmo jeito que a aba Contábil → Importar Extrato faz (e como está a
// contabilidade da AMANDA LIMA GONÇALVES):
//   1. lê as transações — extrato Nubank por regra (sem IA, mesmo leitor da
//      tela), os demais bancos pela IA em partes de poucas páginas;
//   2. garante o plano de contas padrão OneFlow (empresa sem plano recebe uma
//      cópia do plano da empresa-modelo);
//   3. acha a conta do banco no grupo 1.1.01.003 (Bancos Conta Movimento) ou
//      cria uma nova lá;
//   4. classifica pelas regras aprendidas da empresa; o que não tem regra vai
//      pra "Valores a Identificar" (não conciliado) pra classificar depois;
//   5. grava os lançamentos sem duplicar (mesma extrato_referencia da tela);
//   6. devolve o resumo do extrato (DRE fica no OneFlow).
// Diferente da tela, aqui ninguém confere antes de gravar: por isso só regra
// cadastrada/aprendida classifica (a sugestão "por palavras parecidas" da
// tela fica de fora) e nenhuma regra nova é aprendida.
//
// Usado por importar-extrato-background.mjs (extrato do grupo Documentos).

import { PDFDocument } from '@cantoo/pdf-lib'
import extrairExtratoIA from './extrairExtratoIA.js'
import {
  corrigirTipoPelaDescricao, transacaoValida, encontrarRegraAplicavel, montarItensExtrato,
  inserirLancamentosEmLote, identificarBanco, acharContaBanco, proximoCodigoBanco, PREFIXO_BANCOS,
  acharContaPendente, periodoDoExtrato,
} from '../../../src/lib/contabilExtrato.js'
import { agruparEmLinhas, pareceExtratoNubank, interpretarExtratoNubank } from '../../../src/lib/extratoNubankRegras.js'

const { extrairTransacoesIA } = extrairExtratoIA

// Empresa cujo plano de contas (padrão OneFlow) é copiado pra quem ainda não
// tem plano: AMANDA LIMA GONÇALVES, salvo CONTABIL_EMPRESA_MODELO_ID no Netlify.
const EMPRESA_MODELO_PADRAO = '4a856bfc-c19f-4c2c-8062-1451d0ed2136'

// Sem o limite de ~29s das functions síncronas: partes maiores que na tela
// (lá é 1 página por chamada), sem sobreposição — então sem o descarte de
// "duplicatas" por data+valor, que apagaria transações iguais legítimas.
const PAGINAS_POR_PARTE = 2
const PARTES_SIMULTANEAS = 3

// ---------- leitura ----------

async function lerLinhasPdfServidor(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // worker no mesmo processo (não há Web Worker no Node); importado aqui pra o
  // empacotador do Netlify levar o arquivo junto
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes), password: '', isEvalSupported: false, useSystemFonts: false, verbosity: 0,
  }).promise
  const paginas = []
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent()
    paginas.push(agruparEmLinhas(tc.items))
  }
  await doc.destroy()
  return paginas
}

// Extrato Nubank lido por regra; null quando não é Nubank (ou não deu pra ler).
export async function lerExtratoNubank(bytes) {
  let paginas
  try {
    paginas = await lerLinhasPdfServidor(bytes)
  } catch (e) {
    console.warn('importarExtrato: pdf.js não abriu o PDF, seguindo pela IA:', e.message)
    return null
  }
  if (!pareceExtratoNubank(paginas)) return null
  const { transacoes, totais, avisos } = interpretarExtratoNubank(paginas)
  if (!transacoes.length) return null
  const soma = (tipo) => transacoes.filter((t) => t.tipo === tipo).reduce((s, t) => s + t.valor, 0)
  const confere = (total, calculado) => total == null || Math.abs(Math.abs(total) - calculado) < 0.01
  const ok = totais != null && confere(totais.entradas, soma('entrada')) && confere(totais.saidas, soma('saida'))
  return {
    transacoes,
    leitura: 'nubank',
    avisos: [
      ...(ok ? [] : ['A soma das transações do Nubank não bate com os totais do extrato — confira na aba Lançamentos.']),
      ...avisos.slice(0, 2),
    ],
  }
}

async function partesDoPdf(bytes) {
  const doc = await PDFDocument.load(bytes, { password: '' })
  const total = doc.getPageCount()
  if (total <= PAGINAS_POR_PARTE) return [Buffer.from(bytes).toString('base64')]
  const partes = []
  for (let inicio = 0; inicio < total; inicio += PAGINAS_POR_PARTE) {
    const indices = Array.from({ length: Math.min(PAGINAS_POR_PARTE, total - inicio) }, (_, i) => inicio + i)
    const parte = await PDFDocument.create()
    const paginas = await parte.copyPages(doc, indices)
    paginas.forEach((p) => parte.addPage(p))
    partes.push(Buffer.from(await parte.save()).toString('base64'))
  }
  return partes
}

export async function lerExtratoPelaIA(bytes, nomeArquivo, apiKey) {
  const partes = await partesDoPdf(bytes)
  const transacoes = []
  const falhas = []
  let truncado = false
  for (let i = 0; i < partes.length; i += PARTES_SIMULTANEAS) {
    const lote = partes.slice(i, i + PARTES_SIMULTANEAS)
    const resultados = await Promise.allSettled(lote.map((pdfBase64, j) => extrairTransacoesIA({
      pdfBase64, apiKey, filename: partes.length > 1 ? `${nomeArquivo} (parte ${i + j + 1}/${partes.length})` : nomeArquivo,
    })))
    resultados.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        transacoes.push(...r.value.transacoes)
        truncado = truncado || r.value.truncado
      } else {
        falhas.push(`parte ${i + j + 1}/${partes.length}: ${r.reason?.message || 'falha desconhecida'}`)
      }
    })
  }
  if (!transacoes.length && falhas.length) throw new Error(`Não consegui ler o extrato: ${falhas[0]}`)
  const avisos = []
  if (falhas.length) avisos.push(`${falhas.length} trecho(s) do extrato não foram lidos (${falhas.join('; ').slice(0, 200)}) — confira o total.`)
  else if (truncado) avisos.push('O extrato tinha transações demais em algum trecho e parte delas pode ter ficado de fora — confira o total.')
  return { transacoes: transacoes.map(corrigirTipoPelaDescricao), leitura: 'ia', avisos }
}

// ---------- plano de contas ----------

async function listarTodas(supabase, tabela, filtro, colunas = '*') {
  const linhas = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(supabase.from(tabela).select(colunas)).order('codigo').range(de, de + 999)
    if (error) throw error
    linhas.push(...data)
    if (data.length < 1000) return linhas
  }
}

const listarContas = (supabase, empresaId) =>
  listarTodas(supabase, 'contas_contabeis', (q) => q.eq('empresa_id', empresaId))

// Fornecedor individual (2.1.06.001.NNN.NNN, criado pela aba Notas Fiscais)
// é da empresa-modelo, não do plano padrão: não copia.
const ehDaEmpresaModelo = (c) => String(c.codigo).startsWith('2.1.06.001.') && String(c.codigo).split('.').length >= 6

// Copia o plano da empresa-modelo (códigos, nomes, tipos, natureza, grupo da
// DRE e hierarquia) pra empresa que ainda não tem nenhuma conta.
export async function garantirPlanoDeContas(supabase, empresaId) {
  const atuais = await listarContas(supabase, empresaId)
  if (atuais.length) return { contas: atuais, planoCriado: false }

  const modeloId = process.env.CONTABIL_EMPRESA_MODELO_ID || EMPRESA_MODELO_PADRAO
  const modelo = (await listarContas(supabase, modeloId)).filter((c) => c.ativo !== false && !ehDaEmpresaModelo(c))
  if (!modelo.length) throw new Error('A empresa não tem plano de contas e a empresa-modelo também não — aplique o plano na tela Contábil → Plano de Contas.')
  const codigoDoId = new Map(modelo.map((c) => [c.id, c.codigo]))

  const novas = modelo.map((c) => ({
    empresa_id: empresaId, codigo: c.codigo, nome: c.nome, tipo: c.tipo, natureza: c.natureza,
    nivel: c.nivel, aceita_lancamento: c.aceita_lancamento, grupo_dre: c.grupo_dre ?? null, ativo: true,
  }))
  for (let i = 0; i < novas.length; i += 200) {
    const { error } = await supabase.from('contas_contabeis').upsert(novas.slice(i, i + 200), { onConflict: 'empresa_id,codigo', ignoreDuplicates: true })
    if (error) throw error
  }

  // hierarquia (conta_pai_id) pelos códigos
  const criadas = await listarContas(supabase, empresaId)
  const idDoCodigo = new Map(criadas.map((c) => [c.codigo, c.id]))
  const porPai = new Map()
  for (const c of modelo) {
    const paiCodigo = c.conta_pai_id ? codigoDoId.get(c.conta_pai_id) : null
    const paiId = paiCodigo ? idDoCodigo.get(paiCodigo) : null
    const id = idDoCodigo.get(c.codigo)
    if (!paiId || !id) continue
    if (!porPai.has(paiId)) porPai.set(paiId, [])
    porPai.get(paiId).push(id)
  }
  for (const [paiId, ids] of porPai) {
    const { error } = await supabase.from('contas_contabeis').update({ conta_pai_id: paiId }).in('id', ids)
    if (error) throw error
  }
  return { contas: await listarContas(supabase, empresaId), planoCriado: true }
}

// Conta do banco do extrato; cria no grupo 1.1.01.003 quando não existe.
export async function garantirContaBanco(supabase, empresaId, contas, nomeBanco) {
  const banco = identificarBanco(nomeBanco)
  const existente = acharContaBanco(contas, banco)
  if (existente) return { conta: existente, criada: false }

  const grupo = contas.find((c) => c.codigo === PREFIXO_BANCOS)
  const { data, error } = await supabase.from('contas_contabeis').insert({
    empresa_id: empresaId,
    codigo: proximoCodigoBanco(contas),
    nome: banco?.nome || 'Banco (extrato pelo WhatsApp)',
    tipo: 'ativo',
    natureza: 'devedora',
    conta_pai_id: grupo?.id ?? null,
    nivel: PREFIXO_BANCOS.split('.').length + 1,
    aceita_lancamento: true,
    ativo: true,
  }).select().single()
  if (error) throw error
  return { conta: data, criada: true }
}

// ---------- importação ----------

export async function importarExtrato({ supabase, empresaId, pdfBytes, nomeArquivo = 'extrato.pdf', banco = null, apiKey }) {
  const lido = (await lerExtratoNubank(pdfBytes)) || (await lerExtratoPelaIA(pdfBytes, nomeArquivo, apiKey))
  const transacoes = lido.transacoes.filter(transacaoValida).map((t) => ({ ...t, valor: Math.abs(Number(t.valor)) }))
  if (!transacoes.length) throw new Error('Não achei nenhuma transação no arquivo — confira se é mesmo um extrato bancário.')
  const ignoradas = lido.transacoes.length - transacoes.length

  const { contas, planoCriado } = await garantirPlanoDeContas(supabase, empresaId)
  const { conta: contaBanco, criada: contaBancoCriada } = await garantirContaBanco(
    supabase, empresaId, contas, banco || (lido.leitura === 'nubank' ? 'Nubank' : null),
  )
  const contaPendente = acharContaPendente(contas)
  if (!contaPendente) throw new Error('O plano de contas da empresa não tem a conta "Valores a Identificar".')

  const { data: regras, error: errRegras } = await supabase.from('regras_classificacao').select('padrao, conta_id').eq('empresa_id', empresaId)
  if (errRegras) console.warn('importarExtrato: sem regras de classificação:', errRegras.message)
  // regra só vale se apontar pra uma conta ativa que aceita lançamento e não
  // é o próprio banco nem a transitória (as regras da AMANDA, por exemplo,
  // mandam aplicação RDB pra 1.1.01.005.006 e a Shopee pro Caixa)
  const classificaveis = new Set(contas
    .filter((c) => c.ativo !== false && c.aceita_lancamento && c.id !== contaBanco.id && c.id !== contaPendente.id)
    .map((c) => c.id))
  const regrasValidas = (regras || []).filter((r) => classificaveis.has(r.conta_id))

  const classificadas = transacoes.map((t) => {
    const regra = encontrarRegraAplicavel(t.descricao, regrasValidas)
    return { ...t, conta_id: regra?.conta_id || '' }
  })
  const itens = montarItensExtrato(classificadas, { contaBancoId: contaBanco.id, contaPendenteId: contaPendente.id })
  const { criados, pulados } = await inserirLancamentosEmLote(supabase, empresaId, itens)

  // DRE e demais demonstrações ficam no OneFlow: aqui só o resumo do extrato
  const periodo = periodoDoExtrato(transacoes)

  const soma = (tipo) => transacoes.filter((t) => t.tipo === tipo).reduce((s, t) => s + t.valor, 0)
  const avisos = [...lido.avisos]
  if (ignoradas) avisos.push(`${ignoradas} linha(s) sem data/valor legível ficaram de fora.`)
  return {
    leitura: lido.leitura,
    total: transacoes.length,
    criados,
    pulados,
    classificadas: classificadas.filter((t) => t.conta_id).length,
    pendentes: classificadas.filter((t) => !t.conta_id).length,
    totalEntradas: soma('entrada'),
    totalSaidas: soma('saida'),
    contaBanco: { id: contaBanco.id, codigo: contaBanco.codigo, nome: contaBanco.nome },
    contaBancoCriada,
    planoCriado,
    periodo,
    avisos,
  }
}
