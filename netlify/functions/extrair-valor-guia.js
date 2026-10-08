// netlify/functions/extrair-valor-guia.js
//
// Recebe { documentoId } de um documento já anexado (tabela documentos),
// baixa o arquivo do Storage, lê valor e vencimento da guia com a IA
// (lib/extrairValorGuia.js) e grava em documentos.valor_guia /
// vencimento_guia. Chamado pela nova versão do painel do cliente
// (PainelCompartilhadoPage.jsx) pras guias que ainda não têm valor — cada
// documento é lido UMA vez só (valor_guia_extraido_em marca a tentativa,
// mesmo quando a IA não acha valor), então abrir o painel de novo não gera
// nova chamada. Um documento por requisição pra caber no timeout da função.
//
// Variáveis de ambiente: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');
const { extrairValorGuia } = require('./lib/extrairValorGuia');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' });

  let documentoId;
  try {
    documentoId = JSON.parse(event.body).documentoId;
  } catch {
    return resposta(400, { error: 'Body inválido: esperado JSON com { documentoId }.' });
  }
  if (!documentoId) return resposta(400, { error: 'documentoId não informado.' });

  try {
    const { data: doc, error: errDoc } = await supabase
      .from('documentos')
      .select('id, storage_path, nome_arquivo, tipo_mime, valor_guia, vencimento_guia, valor_guia_extraido_em')
      .eq('id', documentoId)
      .maybeSingle();
    if (errDoc) throw errDoc;
    if (!doc) return resposta(404, { error: 'Documento não encontrado.' });

    // já lido antes — devolve o que tem, sem chamar a IA de novo
    if (doc.valor_guia_extraido_em) {
      return resposta(200, { documentoId, valor: doc.valor_guia, vencimento: doc.vencimento_guia, cache: true });
    }

    const { data: arquivo, error: errArquivo } = await supabase.storage.from('documentos').download(doc.storage_path);
    if (errArquivo) throw errArquivo;
    const arquivoBase64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64');

    const extraido = await extrairValorGuia({
      arquivoBase64,
      mimeType: doc.tipo_mime || arquivo.type || 'application/pdf',
      filename: doc.nome_arquivo,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const { error: errUpdate } = await supabase
      .from('documentos')
      .update({ valor_guia: extraido.valor, vencimento_guia: extraido.vencimento, valor_guia_extraido_em: new Date().toISOString() })
      .eq('id', documentoId);
    if (errUpdate) throw errUpdate;

    return resposta(200, { documentoId, valor: extraido.valor, vencimento: extraido.vencimento, observacao: extraido.observacao });
  } catch (e) {
    return resposta(500, { error: e.message });
  }
};

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
