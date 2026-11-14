// netlify/functions/documento-processar-background.mjs
//
// Processa o documento do grupo "Documentos" do WhatsApp conforme a opção
// escolhida no menu (whatsapp-webhook.js → processarEscolhaDocumento; menu em
// lib/processamentoDocumento.js):
//
//   simples ....... Declaração do Simples → painel do cliente (dados_gerenciais_simples),
//                   mesmo resultado do upload em Fechamento (painelApi.uploadDeclaracaoSimples)
//   cnd ........... CND federal/estadual/municipal → cnd_manual (PDF pro cliente baixar no
//                   painel); Relatório de Situação Fiscal → situacao_fiscal_rfb
//                   (mesmo resultado de painelApi.uploadSituacaoFiscal)
//   parcelamento .. guia PARCMEI/PGFN → cria/atualiza o parcelamento e liga a guia
//                   (mesmo código da tela Parcelamentos: src/lib/guiaParcelamento.js)
//   baixa ......... anexa à obrigação/tarefa e dá baixa (etapa concluída / tarefa feita),
//                   com valor e vencimento da guia (mesmo resultado de confirmarDocumento)
//   painel ........ anexa ao painel do cliente, seção Documentos (anexarDocumentoPainel)
//
// O arquivo já está no Storage (bucket "documentos") e na tabela documentos;
// aqui ele é lido de lá, processado e o documento sai da fila "A revisar".
// No fim responde no grupo. Se der erro, o documento volta a esperar escolha.
//
// Background Function (sufixo -background): ler PDF pela IA pode passar dos
// ~29s de uma function síncrona. Corpo: { documentoId, remoteJid, opcao,
// complemento, remetente }. Só a própria aplicação chama (x-segredo-interno).

import { createClient } from '@supabase/supabase-js'
import autenticacao from './lib/autenticacao.js'
import whatsapp from './lib/whatsapp.js'
import processamento from './lib/processamentoDocumento.js'
import extratoWhatsapp from './lib/extratoWhatsapp.js'
import avisoPainel from './lib/avisoPainel.js'
import declaracao from './lib/extrairDeclaracaoSimples.js'
import situacao from './lib/extrairSituacaoFiscal.js'
import valorGuia from './lib/extrairValorGuia.js'
import {
  interpretarTextoGuia, sugerirCliente, acharOuCriarParcelamento, acharObrigacaoParcelamento, camposGuiaParcelamento,
} from '../../src/lib/guiaParcelamento.js'

const { exigirEscritorio } = autenticacao
const { enviarMensagem } = whatsapp
const { AGUARDANDO, PROCESSANDO, PROCESSADO } = processamento
const { acharEmpresaPorTexto } = extratoWhatsapp
const { competenciaAtual } = avisoPainel
const { extrairDeclaracaoSimples } = declaracao
const { extrairSituacaoFiscal } = situacao
const { extrairValorGuia } = valorGuia

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const API_KEY = process.env.ANTHROPIC_API_KEY
const BUCKET = 'documentos'

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
const fmtPct = (v) => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + (n || 0))
  return d.toISOString().slice(0, 10)
}

// Erro com mensagem para o grupo (sem "Error:" na frente).
class Aviso extends Error {}

export const handler = async (event) => {
  if (await exigirEscritorio(event, 'documento-processar-background')) return

  let corpo
  try {
    corpo = JSON.parse(event.body || '{}')
  } catch {
    console.error('documento-processar-background: corpo inválido')
    return
  }
  const { documentoId, remoteJid, opcao, complemento = null, remetente = null } = corpo
  if (!documentoId || !opcao?.acao) return

  const { data: doc, error } = await supabase.from('documentos')
    .select('*, clientes(id, nome, cnpj)')
    .eq('id', documentoId).maybeSingle()
  if (error || !doc) {
    console.error('documento-processar-background: documento não encontrado:', error?.message || documentoId)
    return
  }
  if (doc.whatsapp_decisao !== PROCESSANDO) {
    console.log('documento-processar-background: documento fora do estado "processando", ignorado:', doc.whatsapp_decisao)
    return
  }

  try {
    const { data: clientes } = await supabase.from('clientes').select('id, nome, cnpj').eq('ativo', true)
    const ctx = { doc, opcao, complemento, remetente, clientes: clientes || [] }
    // empresa escrita junto da escolha ("1 Amanda Lima") vence a identificada pela IA
    ctx.empresa = empresaDaResposta(ctx)

    const fazer = { simples, cnd, parcelamento, baixa, painel }[opcao.acao]
    if (!fazer) throw new Aviso(`opção desconhecida (${opcao.acao}).`)
    const { mensagem, patch = {} } = await fazer(ctx)

    const agora = new Date().toISOString()
    const { error: errDoc } = await supabase.from('documentos').update({
      ...patch,
      whatsapp_decisao: PROCESSADO,
      whatsapp_decidido_em: agora,
      status: 'confirmado',
      confirmado_em: agora,
    }).eq('id', doc.id)
    if (errDoc) console.error('documento-processar-background: falha ao marcar o documento:', errDoc.message)

    if (remoteJid) await enviarMensagem(remoteJid, mensagem)
  } catch (e) {
    console.error('documento-processar-background:', opcao.acao, e.message)
    // volta a esperar escolha: dá pra responder de novo depois de corrigir
    await supabase.from('documentos').update({ whatsapp_decisao: AGUARDANDO, whatsapp_decidido_em: null }).eq('id', doc.id)
    if (remoteJid) {
      await enviarMensagem(remoteJid, `❌ *Não consegui processar* ${doc.nome_arquivo}: ${e.message}\n\nO documento continua esperando: responda de novo (ex.: "${opcao.n || opcao.acao} Nome da Empresa") ou trate em Gestor → Documentos → A revisar.`)
    }
  }
}

// ---------- apoio ----------

function empresaDaResposta({ complemento, clientes, doc, opcao }) {
  if (complemento && opcao.acao !== 'baixa') {
    if (opcao.acao === 'parcelamento' && /^avulso$/i.test(complemento)) return { avulso: true }
    const achada = acharEmpresaPorTexto(complemento, clientes)
    if (!achada) throw new Aviso(`não achei uma empresa só com "${complemento}". Escreva o nome completo ou o CNPJ.`)
    return achada
  }
  return doc.clientes || null
}

async function baixarArquivo(doc) {
  const { data, error } = await supabase.storage.from(BUCKET).download(doc.storage_path)
  if (error) throw new Aviso(`não consegui abrir o arquivo guardado (${error.message}).`)
  const bytes = new Uint8Array(await data.arrayBuffer())
  return { bytes, base64: Buffer.from(bytes).toString('base64') }
}

function exigirPdf(doc, oQue) {
  if (doc.tipo_mime !== 'application/pdf') throw new Aviso(`para ${oQue} preciso do PDF (chegou ${doc.tipo_mime || 'outro formato'}). Mande o PDF no grupo.`)
}

const semEmpresa = (n) => new Aviso(`não identifiquei a empresa no documento. Responda *${n} Nome da Empresa* (ou o CNPJ).`)

async function textoDoPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const pdf = await pdfjs.getDocument({ data: bytes, password: '', isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise
  const partes = []
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent()
    partes.push(items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(' '))
  }
  await pdf.destroy()
  return partes.join('\n')
}

// ---------- Declaração do Simples → painel ----------

async function simples({ doc, opcao, empresa, clientes }) {
  exigirPdf(doc, 'ler a Declaração do Simples')
  const { base64 } = await baixarArquivo(doc)
  const extraido = await extrairDeclaracaoSimples({
    pdfBase64: base64, filename: doc.nome_arquivo, clientes: empresa ? null : clientes, apiKey: API_KEY,
  })
  if (extraido.faturamentoPeriodo == null && extraido.rbt12 == null && extraido.valorDas == null) {
    throw new Aviso(`não parece uma Declaração do Simples Nacional${extraido.observacao ? ` (${extraido.observacao})` : ''}.`)
  }
  const clienteId = empresa?.id || extraido.clienteId
  if (!clienteId) throw semEmpresa(opcao.n || 'simples')
  const nome = empresa?.nome || clientes.find((c) => c.id === clienteId)?.nome || 'empresa'

  const competencia = extraido.competencia || competenciaAtual()
  const { error } = await supabase.from('dados_gerenciais_simples').upsert({
    cliente_id: clienteId,
    competencia,
    faturamento_periodo: extraido.faturamentoPeriodo,
    rbt12: extraido.rbt12,
    aliquota_efetiva: extraido.aliquotaEfetiva,
    valor_das: extraido.valorDas,
    anexo: extraido.anexo,
    receita_por_tipo: extraido.receitaPorTipo?.length > 0 ? extraido.receitaPorTipo : null,
    storage_path: doc.storage_path,
    observacao_ia: extraido.observacao,
  }, { onConflict: 'cliente_id,competencia' })
  if (error) throw new Error(error.message)

  const historico = extraido.historicoReceita?.length ? await preencherHistorico(clienteId, competencia, extraido.historicoReceita).catch(() => 0) : 0
  if (extraido.municipio || extraido.dataAbertura) await preencherCadastro(clienteId, extraido).catch(() => {})

  const linhas = [`✅ *Declaração do Simples carregada no painel*`, `👤 ${nome}`, `📅 Competência ${competencia}`]
  if (extraido.faturamentoPeriodo != null) linhas.push(`💵 Faturamento: ${fmtBRL(extraido.faturamentoPeriodo)}`)
  if (extraido.rbt12 != null) linhas.push(`📈 RBT12: ${fmtBRL(extraido.rbt12)}`)
  if (extraido.aliquotaEfetiva != null) linhas.push(`➗ Alíquota efetiva: ${fmtPct(extraido.aliquotaEfetiva)}${extraido.anexo ? ` (Anexo ${extraido.anexo})` : ''}`)
  if (extraido.valorDas != null) linhas.push(`🧾 DAS: ${fmtBRL(extraido.valorDas)}`)
  if (historico) linhas.push(`🗂️ ${historico} mês(es) anteriores preenchidos com o histórico da declaração.`)
  if (extraido.observacao) linhas.push(`ℹ️ ${extraido.observacao}`)
  return { mensagem: linhas.join('\n'), patch: { cliente_id: clienteId, tipo_documento_sugerido: 'Declaração do Simples Nacional' } }
}

// Mesmo critério de painelApi.js: só preenche competências que ainda não têm registro.
async function preencherHistorico(clienteId, competenciaAtualDoc, historico) {
  const linhas = historico
    .filter((h) => h.competencia && h.competencia !== competenciaAtualDoc && h.faturamento != null)
    .map((h) => ({
      cliente_id: clienteId,
      competencia: h.competencia,
      faturamento_periodo: h.faturamento,
      observacao_ia: `Preenchido automaticamente a partir do histórico de RBT12 da declaração de ${competenciaAtualDoc}.`,
    }))
  if (!linhas.length) return 0
  const { data, error } = await supabase.from('dados_gerenciais_simples')
    .upsert(linhas, { onConflict: 'cliente_id,competencia', ignoreDuplicates: true }).select()
  if (error) throw error
  return data?.length || 0
}

// Município e data de abertura no cadastro, só quando ainda estão vazios.
async function preencherCadastro(clienteId, { municipio, dataAbertura }) {
  const { data: atual } = await supabase.from('clientes').select('municipio, data_abertura').eq('id', clienteId).maybeSingle()
  const patch = {}
  if (municipio && !atual?.municipio) patch.municipio = municipio
  if (dataAbertura && !atual?.data_abertura) patch.data_abertura = dataAbertura
  if (Object.keys(patch).length) await supabase.from('clientes').update(patch).eq('id', clienteId)
}

// ---------- CND / Relatório de Situação Fiscal → painel ----------

const ESFERAS = { federal: 'federal', estadual: 'estadual', municipal: 'municipal' }

async function cnd({ doc, opcao, empresa, clientes }) {
  exigirPdf(doc, 'ler a certidão')
  const { base64 } = await baixarArquivo(doc)
  const extraido = await extrairSituacaoFiscal({
    pdfBase64: base64, filename: doc.nome_arquivo, clientes: empresa ? null : clientes, apiKey: API_KEY,
  })
  if (extraido.tipoDocumento === 'outro') throw new Aviso(`não parece CND nem Relatório de Situação Fiscal${extraido.observacao ? ` (${extraido.observacao})` : ''}.`)
  const clienteId = empresa?.id || extraido.clienteId
  if (!clienteId) throw semEmpresa(opcao.n || 'cnd')
  const nome = empresa?.nome || clientes.find((c) => c.id === clienteId)?.nome || 'empresa'
  const competencia = competenciaAtual()
  const situacaoTxt = extraido.situacaoGeral === 'regular' ? '🟢 Regular' : extraido.situacaoGeral === 'pendente' ? '🔴 Com pendências' : '⚪ Situação não lida'

  if (extraido.tipoDocumento.startsWith('cnd_')) {
    const esfera = ESFERAS[extraido.tipoDocumento.slice(4)]
    const base = {
      cliente_id: clienteId, competencia, atualizado_em: new Date().toISOString(),
      [`situacao_${esfera}`]: extraido.situacaoGeral || null,
      [`anexo_${esfera}_path`]: doc.storage_path, [`anexo_${esfera}_nome`]: doc.nome_arquivo,
    }
    const gravar = (payload) => supabase.from('cnd_manual').upsert(payload, { onConflict: 'cliente_id,competencia' })
    let { error } = await gravar({ ...base, [`validade_${esfera}`]: extraido.validade || null })
    const faltaColuna = (e) => ['42703', 'PGRST204'].includes(e?.code) || /column/i.test(e?.message || '')
    if (error && faltaColuna(error) && esfera !== 'federal') ({ error } = await gravar(base))
    if (error) {
      if (faltaColuna(error)) throw new Aviso('para guardar a CND federal, rode supabase-schema-cnd-federal.sql no SQL Editor do Supabase.')
      throw new Error(error.message)
    }
    const linhas = [
      `✅ *CND ${esfera} anexada ao painel do cliente*`, `👤 ${nome}`, situacaoTxt,
      extraido.validade ? `📅 Válida até ${fmtData(extraido.validade)}` : null,
      '📎 O PDF fica disponível para o cliente baixar no painel.',
    ]
    return { mensagem: linhas.filter(Boolean).join('\n'), patch: { cliente_id: clienteId, tipo_documento_sugerido: `CND ${esfera}` } }
  }

  const { error } = await supabase.from('situacao_fiscal_rfb').upsert({
    cliente_id: clienteId,
    competencia,
    data_emissao: extraido.dataEmissao,
    situacao_geral: extraido.situacaoGeral,
    debitos: extraido.debitos,
    parcelamentos: extraido.parcelamentos,
    dividas_ativas: extraido.dividasAtivas,
    storage_path: doc.storage_path,
    observacao_ia: extraido.observacao,
  }, { onConflict: 'cliente_id,competencia' })
  if (error) throw new Error(error.message)
  const linhas = [
    '✅ *Relatório de Situação Fiscal carregado no painel*', `👤 ${nome}`, situacaoTxt,
    `🧾 ${extraido.debitos.length} débito(s) · ${extraido.dividasAtivas.length} dívida(s) ativa(s) · ${extraido.parcelamentos.length} parcelamento(s)`,
    extraido.dataEmissao ? `📅 Emitido em ${fmtData(extraido.dataEmissao)}` : null,
  ]
  return { mensagem: linhas.filter(Boolean).join('\n'), patch: { cliente_id: clienteId, tipo_documento_sugerido: 'Relatório de Situação Fiscal' } }
}

// ---------- guia de parcelamento → cadastro do parcelamento ----------

async function parcelamento({ doc, opcao, complemento, empresa, clientes }) {
  exigirPdf(doc, 'ler a guia de parcelamento')
  const { bytes } = await baixarArquivo(doc)
  let texto
  try {
    texto = await textoDoPdf(bytes)
  } catch (e) {
    throw new Aviso(`não consegui ler o texto do PDF (${e.message}).`)
  }
  const dados = interpretarTextoGuia(texto)
  if (!dados) throw new Aviso('não parece guia de parcelamento (PARCMEI ou PGFN-SISPAR). Se for, cadastre pela tela Parcelamentos.')
  if (!dados.documentoDigitos || !dados.conta) throw new Aviso('não achei o CPF/CNPJ ou o número do parcelamento na guia.')

  if (dados.linhaDigitavel) {
    const { data: ja } = await supabase.from('documentos').select('id').eq('linha_digitavel', dados.linhaDigitavel).neq('id', doc.id).limit(1)
    if (ja?.length) throw new Aviso('essa guia já foi importada antes (mesma linha digitável).')
  }

  // empresa: a escrita na resposta ("3 Amanda Lima" / "3 avulso"); senão a do
  // CPF/CNPJ da guia (mesma regra da tela); senão a que a IA identificou
  let clienteId = null
  let avulso = false
  if (complemento) {
    avulso = !!empresa?.avulso
    clienteId = avulso ? null : empresa?.id || null
  } else {
    const { data: parcs } = await supabase.from('parcelamentos').select('cliente_id, documento_devedor')
    const sugestao = sugerirCliente(dados, clientes, parcs || [])
    clienteId = sugestao.clienteId || empresa?.id || null
    avulso = !clienteId && !!sugestao.avulso
  }
  if (!clienteId && !avulso) {
    throw new Aviso(`não achei a empresa do devedor ${dados.nome || ''} (${dados.documento || dados.documentoDigitos}). Responda *${opcao.n || 'parcelamento'} Nome da Empresa*, ou *${opcao.n || 'parcelamento'} avulso* se não for cliente.`)
  }

  const parc = await acharOuCriarParcelamento(supabase, dados, clienteId)
  const obrigacaoId = clienteId ? await acharObrigacaoParcelamento(supabase, clienteId, dados).catch(() => null) : null
  const nome = clienteId ? (clientes.find((c) => c.id === clienteId)?.nome || 'empresa') : `${dados.nome || dados.documento} (avulso)`

  const linhas = [
    `✅ *Parcelamento ${parc.criado ? 'cadastrado' : 'atualizado'}*`,
    `👤 ${nome}`,
    `📑 ${dados.origem === 'PARCMEI' ? 'PARCMEI' : 'PGFN-SISPAR'} nº ${dados.conta}${dados.parcela ? ` — parcela ${dados.parcela}${dados.totalParcelas ? `/${dados.totalParcelas}` : ''}` : ''}`,
    dados.valor != null ? `💰 ${fmtBRL(dados.valor)}${dados.vencimento ? ` — vence ${fmtData(dados.vencimento)}` : ''}` : null,
    obrigacaoId ? '🔗 Guia ligada à obrigação de parcelamento do mês (aparece no painel e na baixa de pagamentos).' : null,
    'Veja em Gestor → Parcelamentos.',
  ]
  return {
    mensagem: linhas.filter(Boolean).join('\n'),
    patch: { cliente_id: clienteId, ...camposGuiaParcelamento(dados, parc.id, obrigacaoId) },
  }
}

// ---------- boleto/guia → baixa da obrigação ou tarefa ----------

async function baixa({ doc, opcao, remetente }) {
  const alvo = opcao.alvo
  if (!alvo?.id) throw new Aviso('não sei em qual obrigação ou tarefa dar baixa.')
  const agora = new Date().toISOString()
  let clienteId = alvo.clienteId || doc.cliente_id || null
  let obrigacaoId = null

  if (alvo.tipo === 'etapa') {
    const { data: etapa, error } = await supabase.from('etapas_obrigacao').select('*, obrigacoes(cliente_id)').eq('id', alvo.id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!etapa) throw new Aviso('a etapa não existe mais.')
    if (etapa.status !== 'concluido') await concluirEtapa(etapa, remetente)
    obrigacaoId = etapa.obrigacao_id
    clienteId = etapa.obrigacoes?.cliente_id || clienteId
  } else {
    const { data: tarefa, error } = await supabase.from('tarefas')
      .update({ concluida: true, concluida_em: agora, updated_at: agora }).eq('id', alvo.id).select('id, cliente_id').maybeSingle()
    if (error) throw new Error(error.message)
    if (!tarefa) throw new Aviso('a tarefa não existe mais.')
    clienteId = tarefa.cliente_id || clienteId
  }

  // valor e vencimento da guia (painel do cliente); sem leitura, segue sem eles
  const patchGuia = {}
  let infoGuia = ''
  try {
    const { base64 } = await baixarArquivo(doc)
    const g = await extrairValorGuia({ arquivoBase64: base64, mimeType: doc.tipo_mime, filename: doc.nome_arquivo, apiKey: API_KEY })
    if (g.ehGuia && (g.valor != null || g.vencimento)) {
      Object.assign(patchGuia, { valor_guia: g.valor, vencimento_guia: g.vencimento, valor_guia_extraido_em: agora })
      infoGuia = `\n💰 ${g.valor != null ? fmtBRL(g.valor) : 'valor não lido'}${g.vencimento ? ` — vence ${fmtData(g.vencimento)}` : ''}`
    }
  } catch (e) {
    console.warn('documento-processar-background: valor da guia não lido:', e.message)
  }

  return {
    mensagem: `✅ *Baixa dada*\n📌 ${alvo.rotulo}${infoGuia}\n📎 ${doc.nome_arquivo} anexado${alvo.tipo === 'etapa' ? ' — já aparece no painel do cliente' : ' à tarefa'}.`,
    patch: {
      cliente_id: clienteId,
      obrigacao_id: alvo.tipo === 'etapa' ? obrigacaoId : null,
      etapa_obrigacao_id: alvo.tipo === 'etapa' ? alvo.id : null,
      tarefa_id: alvo.tipo === 'tarefa' ? alvo.id : null,
      ...patchGuia,
    },
  }
}

// Mesma regra de concluirEtapa (src/pages/andamento/andamentoApi.js): conclui a
// etapa, abre a próxima ou, se era a última, conclui a obrigação.
async function concluirEtapa(etapa, remetente) {
  const hoje = hojeSP()
  const autor = remetente ? `WhatsApp (${remetente})` : 'WhatsApp'
  const { error } = await supabase.from('etapas_obrigacao')
    .update({ status: 'concluido', data_conclusao: hoje, responsavel: etapa.responsavel || null }).eq('id', etapa.id)
  if (error) throw new Error(error.message)
  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: etapa.obrigacao_id, etapa_obrigacao_id: etapa.id,
    descricao: `Etapa "${etapa.nome}" concluída`, observacao: 'Baixa pelo grupo Documentos do WhatsApp', autor,
  })
  const { data: etapas, error: errLista } = await supabase.from('etapas_obrigacao')
    .select('*, etapas_template(prazo_dias_relativo)').eq('obrigacao_id', etapa.obrigacao_id).order('ordem')
  if (errLista) throw new Error(errLista.message)
  const proxima = (etapas || []).find((e) => e.ordem > etapa.ordem && e.status === 'pendente')
  if (proxima) {
    await supabase.from('etapas_obrigacao')
      .update({ status: 'em_andamento', data_prevista: somarDias(hoje, proxima.etapas_template?.prazo_dias_relativo) }).eq('id', proxima.id)
  } else {
    await supabase.from('obrigacoes').update({ status: 'concluido', data_conclusao: hoje }).eq('id', etapa.obrigacao_id)
    await supabase.from('historico_obrigacao').insert({ obrigacao_id: etapa.obrigacao_id, descricao: 'Obrigação concluída', autor })
  }
}

// ---------- qualquer documento → painel do cliente (seção Documentos) ----------

async function painel({ doc, opcao, empresa }) {
  if (!empresa?.id) throw semEmpresa(opcao.n || 'painel')
  const titulo = doc.tipo_documento_sugerido && doc.tipo_documento_sugerido !== 'Documento não identificado'
    ? doc.tipo_documento_sugerido : doc.nome_arquivo.replace(/\.[a-z0-9]+$/i, '')
  const competencia = opcao.fixo ? null : competenciaAtual()
  return {
    mensagem: `✅ *Anexado ao painel do cliente*\n👤 ${empresa.nome}\n📎 ${titulo}${competencia ? ` — competência ${competencia}` : ' — fica em todas as competências'}\nPara avisar o cliente, use "Notificar cliente" no painel.`,
    patch: { cliente_id: empresa.id, painel_visivel: true, painel_titulo: titulo.slice(0, 200), painel_competencia: competencia },
  }
}
