// netlify/functions/painel-arquivo.js
//
// URL assinada dos arquivos do bucket "documentos" pras páginas públicas. O
// cliente não tem acesso direto ao Storage (só o escritório tem policy no
// bucket — ver docs/seguranca-rls.md), então o painel pede aqui:
//   POST { storagePath, segundos? } + cabeçalho x-painel-token
//        → só se o arquivo for do cliente do token (guia/comprovante em
//          documentos, declaração em dados_gerenciais_simples, relatório em
//          situacao_fiscal_rfb ou anexo de cnd_manual). Escritório logado
//          (Authorization) pode qualquer arquivo.
//   POST { documentoId } → link ?doc=<id> (DocumentoCompartilhadoPage): o id
//        do documento é o segredo do link; devolve o arquivo dele, por 1h.
// Resposta: { url }.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { clienteDoPainel, usuarioEscritorio } = require('./lib/autenticacao')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const BUCKET = 'documentos'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Onde cada tipo de arquivo do painel fica registrado: [tabela, colunas de caminho]
const ORIGENS = [
  ['documentos', ['storage_path', 'comprovante_path']],
  ['dados_gerenciais_simples', ['storage_path']],
  ['situacao_fiscal_rfb', ['storage_path']],
  ['cnd_manual', ['anexo_federal_path', 'anexo_estadual_path', 'anexo_municipal_path']],
]

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resposta(405, { error: 'Método não permitido, use POST.' })
  }

  let storagePath, documentoId, segundos
  try {
    const body = JSON.parse(event.body || '{}')
    storagePath = body.storagePath ? String(body.storagePath) : null
    documentoId = body.documentoId ? String(body.documentoId) : null
    segundos = Math.min(Math.max(parseInt(body.segundos, 10) || 300, 60), 60 * 60)
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { storagePath } ou { documentoId }.' })
  }

  try {
    if (documentoId) {
      if (!UUID.test(documentoId)) return resposta(404, { error: 'Documento não encontrado.' })
      const { data: doc, error } = await supabase.from('documentos').select('storage_path').eq('id', documentoId).maybeSingle()
      if (error) throw error
      if (!doc?.storage_path) return resposta(404, { error: 'Documento não encontrado.' })
      return resposta(200, { url: await assinar(doc.storage_path, 60 * 60) })
    }

    if (!storagePath) return resposta(400, { error: 'Informe storagePath ou documentoId.' })

    if (await usuarioEscritorio(event)) {
      return resposta(200, { url: await assinar(storagePath, segundos) })
    }

    const cliente = await clienteDoPainel(event)
    if (!cliente) return resposta(401, { error: 'Link inválido ou expirado. Peça um link novo ao escritório.' })
    if (!(await arquivoDoCliente(storagePath, cliente.id))) {
      return resposta(404, { error: 'Arquivo não encontrado.' })
    }
    return resposta(200, { url: await assinar(storagePath, segundos) })
  } catch (e) {
    console.error('painel-arquivo:', e.message)
    return resposta(500, { error: e.message })
  }
}

async function arquivoDoCliente(storagePath, clienteId) {
  // uma consulta por coluna com .eq() (e não um .or() montado com o caminho):
  // o caminho vem do navegador e não pode virar sintaxe de filtro
  for (const [tabela, colunas] of ORIGENS) {
    for (const coluna of colunas) {
      const { count, error } = await supabase.from(tabela)
        .select('id', { count: 'exact', head: true })
        .eq('cliente_id', clienteId)
        .eq(coluna, storagePath)
      // tabela/coluna que ainda não existe nesse banco: só não é a origem
      if (error) continue
      if (count > 0) return true
    }
  }
  return false
}

async function assinar(storagePath, segundos) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, segundos)
  if (error) throw error
  return data.signedUrl
}

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
