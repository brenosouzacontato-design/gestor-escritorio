// netlify/functions/painel-codigos-guia.js
//
// Grava o código de barras (linha digitável) e o PIX copia e cola de uma guia
// anexada, pros botões "copiar" do painel do cliente. A leitura é feita no
// navegador (src/pages/painel/codigosGuia.js: texto do PDF + QR code da
// guia); aqui só entra o que passar na conferência matemática do próprio
// código (lib/codigosGuia.js) — leitura errada nunca vira botão de pagar.
//
// POST { documentoId, linhasDigitaveis: [string], pixCopiaCola: string|null }
//   → { documentoId, linhaDigitavel, pixCopiaCola }
// Cada guia é lida uma vez só: codigos_extraidos_em marca a tentativa, mesmo
// quando nada válido foi achado (guia sem QR, foto sem texto...).
//
// Quem pode chamar: o escritório logado ou o cliente do painel (x-painel-token),
// e o cliente só pras guias dele (mesma regra de extrair-valor-guia.js).
//
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js')
const { usuarioEscritorio, chamadaInterna, clienteDoPainel, modoEstrito, negar } = require('./lib/autenticacao')
const { linhaDigitavelValida, pixValido } = require('./lib/codigosGuia')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' })

  let documentoId, linhas, pix
  try {
    const body = JSON.parse(event.body)
    documentoId = body.documentoId
    linhas = Array.isArray(body.linhasDigitaveis) ? body.linhasDigitaveis.slice(0, 5).map(String) : []
    pix = body.pixCopiaCola ? String(body.pixCopiaCola) : null
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { documentoId, linhasDigitaveis, pixCopiaCola }.' })
  }
  if (!documentoId) return resposta(400, { error: 'documentoId não informado.' })

  try {
    const { data: doc, error: errDoc } = await supabase
      .from('documentos').select('*').eq('id', documentoId).maybeSingle()
    if (errDoc) throw errDoc
    if (!doc) return resposta(404, { error: 'Documento não encontrado.' })
    if (!('codigos_extraidos_em' in doc)) {
      return resposta(503, { error: 'Falta criar as colunas dos códigos — rode supabase-schema-guia-codigos.sql no Supabase.' })
    }

    const escritorio = chamadaInterna(event) || await usuarioEscritorio(event)
    if (!escritorio) {
      const cliente = await clienteDoPainel(event)
      if (cliente && cliente.id !== doc.cliente_id) return resposta(404, { error: 'Documento não encontrado.' })
      if (!cliente) {
        if (modoEstrito()) return negar('painel-codigos-guia', 'sem login e sem token do painel')
        console.warn('painel-codigos-guia: chamada sem login nem token — aceito porque EXIGIR_AUTENTICACAO não está ligado')
      }
    }

    // já lida antes: devolve o que tem, sem regravar
    if (doc.codigos_extraidos_em) {
      return resposta(200, { documentoId, linhaDigitavel: doc.linha_digitavel, pixCopiaCola: doc.pix_copia_cola, cache: true })
    }

    const linhaDigitavel = linhas.map(linhaDigitavelValida).find(Boolean) || null
    const pixCopiaCola = pixValido(pix)
    const patch = { codigos_extraidos_em: new Date().toISOString() }
    // nunca apaga um código já gravado com o resultado vazio de uma leitura nova
    if (linhaDigitavel) patch.linha_digitavel = linhaDigitavel
    if (pixCopiaCola) patch.pix_copia_cola = pixCopiaCola

    const { error: errUpdate } = await supabase.from('documentos').update(patch).eq('id', documentoId)
    if (errUpdate) throw errUpdate

    return resposta(200, {
      documentoId,
      linhaDigitavel: linhaDigitavel || doc.linha_digitavel || null,
      pixCopiaCola: pixCopiaCola || doc.pix_copia_cola || null,
    })
  } catch (e) {
    console.error('painel-codigos-guia:', e.message)
    return resposta(500, { error: e.message })
  }
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
