// netlify/functions/entregas-enviar.js
//
// Central de Entregas (src/pages/entregas): manda UMA guia anexada (linha de
// `documentos`) pelo WhatsApp do escritório pro cliente e marca como
// entregue. Uma guia por chamada — a tela manda as selecionadas uma de cada
// vez, assim nenhuma chamada passa do limite de tempo do Netlify.
//   POST { documentoId, destino? }  → { ok, destino } | { error }
// `destino` (opcional) troca o número/grupo só desse envio; sem ele vale
// clientes.whatsapp_entrega e, se vazio, clientes.telefone.
// Exige login do escritório. Colunas em supabase-schema-central-entregas.sql.

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio } = require('./lib/autenticacao')
const { enviarDocumento, numeroWhatsapp } = require('./lib/whatsapp')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' })
  const negado = await exigirEscritorio(event, 'entregas-enviar')
  if (negado) return negado

  let documentoId, destinoPedido
  try {
    const body = JSON.parse(event.body || '{}')
    documentoId = body.documentoId
    destinoPedido = body.destino ? String(body.destino).slice(0, 60) : null
  } catch {
    return resposta(400, { error: 'Body inválido.' })
  }
  if (!UUID.test(documentoId || '')) return resposta(400, { error: 'Guia inválida.' })

  try {
    const { data: doc, error } = await supabase.from('documentos')
      .select('*, clientes(id, nome, telefone, whatsapp_entrega), obrigacoes(titulo, tipo, competencia), parcelamentos(origem, descricao)')
      .eq('id', documentoId).maybeSingle()
    if (error) throw error
    if (!doc?.storage_path) return resposta(404, { error: 'Guia não encontrada.' })
    if (!doc.clientes) return resposta(400, { error: 'A guia não está ligada a uma empresa.' })

    const destino = numeroWhatsapp(destinoPedido || doc.clientes.whatsapp_entrega || doc.clientes.telefone)
    if (!destino) {
      return resposta(400, { error: `${doc.clientes.nome}: sem WhatsApp de entrega. Cadastre o número na aba Empresas da Central.` })
    }

    const { data: assinado, error: errAssinar } = await supabase.storage.from('documentos')
      .createSignedUrl(doc.storage_path, 60 * 60)
    if (errAssinar) throw errAssinar

    const envio = await enviarDocumento(destino, {
      media: assinado.signedUrl,
      fileName: nomeArquivo(doc),
      caption: legenda(doc),
      mimetype: doc.tipo_mime || 'application/pdf',
    })

    const agora = new Date().toISOString()
    const marca = envio.sucesso
      ? { entregue_em: agora, entrega_canal: 'whatsapp', entrega_destino: destino, entrega_erro: null }
      : { entrega_erro: `${agora.slice(0, 10)}: ${envio.erro}`.slice(0, 300) }
    const { error: errMarca } = await supabase.from('documentos').update(marca).eq('id', documentoId)
    if (errMarca) throw errMarca

    if (!envio.sucesso) return resposta(502, { error: envio.erro })
    return resposta(200, { ok: true, destino })
  } catch (e) {
    console.error('entregas-enviar:', e.message)
    return resposta(500, { error: e.message })
  }
}

function tituloGuia(doc) {
  if (doc.obrigacoes) return doc.obrigacoes.titulo || doc.obrigacoes.tipo || 'Guia'
  if (doc.parcelamentos) return `Parcelamento ${doc.parcelamentos.origem || ''}`.trim()
  return doc.tipo_documento_sugerido || 'Guia'
}

function legenda(doc) {
  const comp = doc.obrigacoes?.competencia
  const linhas = [
    `Olá! Segue a guia *${tituloGuia(doc)}*${comp ? ` (competência ${comp})` : ''} de *${doc.clientes.nome}*.`,
  ]
  if (doc.valor_guia != null) linhas.push(`💰 Valor: ${Number(doc.valor_guia).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`)
  if (doc.vencimento_guia) {
    const [a, m, d] = String(doc.vencimento_guia).slice(0, 10).split('-')
    linhas.push(`📅 Vencimento: ${d}/${m}/${a}`)
  }
  if (doc.pix_copia_cola) linhas.push(`\nPix copia e cola:\n${doc.pix_copia_cola}`)
  else if (doc.linha_digitavel) linhas.push(`\nCódigo de barras:\n${doc.linha_digitavel}`)
  return linhas.join('\n')
}

function nomeArquivo(doc) {
  const base = String(doc.nome_arquivo || 'guia.pdf')
  return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}.pdf`
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
