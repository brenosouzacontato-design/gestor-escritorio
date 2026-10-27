// nfseEmitidasApi.js
// Todas as NFS-e emitidas pela empresa, lidas do Ambiente Nacional (netlify/functions/nfse-emitidas.js).
// No link público vai o token do painel; dentro do app, o login do escritório + o cliente_id.
import { cabecalhosFunctions } from '../../lib/supabase';

async function chamar(corpo) {
  return fetch('/.netlify/functions/nfse-emitidas', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify(corpo),
  });
}

// { empresa, sincronizadoEm, erro, notas: [{ id, numero, chave, competencia, emitidaEm, tomador, valor, valorLiquido, descricao, situacao }] }
export async function listarTodasNfse(clienteId, { atualizar = false } = {}) {
  const resp = await chamar({ acao: 'listar', cliente_id: clienteId, atualizar });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível carregar as notas.');
  return dados;
}

// formato: 'pdf' (DANFSe com QR Code) ou 'xml'
export async function baixarNfseEmitida(clienteId, nota, formato) {
  const resp = await chamar({ acao: formato, cliente_id: clienteId, nota_id: nota.id });
  if (!resp.ok) {
    const dados = await resp.json().catch(() => ({}));
    throw new Error(dados.error || 'Não foi possível baixar a nota.');
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NFS-e ${nota.numero || nota.chave}.${formato}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// Link público (assinado, 30 dias) do PDF, para mandar pelo WhatsApp
export async function linkPdfNfseEmitida(clienteId, notaId) {
  const resp = await chamar({ acao: 'link', cliente_id: clienteId, nota_id: notaId });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível gerar o link.');
  return dados;
}
