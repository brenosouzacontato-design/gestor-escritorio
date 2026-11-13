// netlify/functions/importar-extrato-background.mjs
//
// Importa na contabilidade o extrato bancário que chegou no grupo
// "Documentos" do WhatsApp, depois que alguém respondeu "sim" à pergunta do
// robô (whatsapp-webhook.js → processarRespostaExtrato). Lê o PDF guardado
// em Storage, gera os lançamentos no padrão OneFlow, calcula a DRE do
// período e responde no grupo com o resumo e o link da DRE.
//
// Background Function (sufixo -background): o Netlify responde 202 pra quem
// chamou e deixa esta rodar até 15 minutos — ler um extrato de várias
// páginas pela IA não cabe nos ~29s de uma function síncrona.
//
// Corpo: { documentoId, remoteJid }. Só a própria aplicação chama
// (cabeçalho x-segredo-interno, lib/autenticacao.js).

import { createClient } from '@supabase/supabase-js'
import autenticacao from './lib/autenticacao.js'
import whatsapp from './lib/whatsapp.js'
import extratoWhatsapp from './lib/extratoWhatsapp.js'
import { importarExtrato } from './lib/importarExtrato.mjs'

const { exigirEscritorio } = autenticacao
const { enviarMensagem } = whatsapp
const { AGUARDANDO, IMPORTANDO, IMPORTADO, resultadoImportacao } = extratoWhatsapp

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// Link público da DRE (mesmo do botão "Compartilhar via WhatsApp" da aba DRE).
function linkDre(cliente, periodo) {
  const base = (process.env.PAINEL_URL_BASE || process.env.URL || '').replace(/\/+$/, '')
  if (!base || !periodo) return null
  const busca = new URLSearchParams({ share: 'dre', empresa: cliente.painel_token || cliente.id, inicio: periodo.dataInicio, fim: periodo.dataFim })
  return `${base}/?${busca.toString()}`
}

export const handler = async (event) => {
  if (await exigirEscritorio(event, 'importar-extrato-background')) return

  let documentoId, remoteJid
  try {
    ({ documentoId, remoteJid } = JSON.parse(event.body || '{}'))
  } catch {
    console.error('importar-extrato-background: corpo inválido')
    return
  }
  if (!documentoId) return

  const { data: doc, error } = await supabase.from('documentos')
    .select('id, cliente_id, nome_arquivo, storage_path, tipo_mime, observacao_ia, whatsapp_decisao, whatsapp_extrato, clientes(*)')
    .eq('id', documentoId).maybeSingle()
  if (error || !doc) {
    console.error('importar-extrato-background: documento não encontrado:', error?.message || documentoId)
    return
  }
  if (doc.whatsapp_decisao !== IMPORTANDO) {
    console.log('importar-extrato-background: documento fora do estado "importando", ignorado:', doc.whatsapp_decisao)
    return
  }
  const cliente = doc.clientes

  try {
    if (!cliente) throw new Error('o extrato não está vinculado a nenhuma empresa.')
    const { data: arquivo, error: errArq } = await supabase.storage.from('documentos').download(doc.storage_path)
    if (errArq) throw new Error(`não consegui abrir o arquivo guardado: ${errArq.message}`)
    const pdfBytes = new Uint8Array(await arquivo.arrayBuffer())

    const res = await importarExtrato({
      supabase,
      empresaId: cliente.id,
      pdfBytes,
      nomeArquivo: doc.nome_arquivo,
      banco: doc.whatsapp_extrato?.banco || null,
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
    console.log('importar-extrato-background: importado', JSON.stringify({ documentoId, empresa: cliente.id, ...res, dre: undefined }))

    const agora = new Date().toISOString()
    const { error: errDoc } = await supabase.from('documentos').update({
      whatsapp_decisao: IMPORTADO,
      whatsapp_decidido_em: agora,
      status: 'confirmado',
      confirmado_em: agora,
      observacao_ia: [doc.observacao_ia, `[Extrato importado na contabilidade: ${res.criados} lançamento(s) na conta ${res.contaBanco.codigo} ${res.contaBanco.nome}.]`].filter(Boolean).join(' '),
    }).eq('id', doc.id)
    if (errDoc) console.error('importar-extrato-background: falha ao marcar o documento:', errDoc.message)

    if (remoteJid) await enviarMensagem(remoteJid, resultadoImportacao(cliente, { ...res, linkDre: linkDre(cliente, res.periodo) }))
  } catch (e) {
    console.error('importar-extrato-background:', e.message)
    // volta a esperar resposta: dá pra mandar "sim" de novo depois de corrigir
    await supabase.from('documentos').update({ whatsapp_decisao: AGUARDANDO, whatsapp_decidido_em: null }).eq('id', doc.id)
    if (remoteJid) await enviarMensagem(remoteJid, `❌ Não consegui importar o extrato${cliente ? ` de ${cliente.nome}` : ''}: ${e.message}\nCorrija e responda *sim* de novo, ou importe pela tela Contábil → Importar Extrato.`)
  }
}
