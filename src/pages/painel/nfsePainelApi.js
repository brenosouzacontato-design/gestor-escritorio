// nfsePainelApi.js
// Notas fiscais de serviço emitidas pelo gestor, no painel do cliente
// (netlify/functions/painel-nfse.js). No link público vai o token do painel;
// dentro do app, o login do escritório + o cliente_id.
import { cabecalhosFunctions } from '../../lib/supabase';

async function chamar(corpo) {
  return fetch('/.netlify/functions/painel-nfse', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify(corpo),
  });
}

// [{ id, numero, chave, competencia, emitidaEm, tomador, valor, descricao, ambiente }]
export async function listarNfseEmitidas(clienteId, competencia, { incluirHomologacao = false } = {}) {
  const resp = await chamar({ acao: 'listar', cliente_id: clienteId, competencia, incluir_homologacao: incluirHomologacao });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível carregar as notas emitidas.');
  return dados.notas || [];
}

// formato: 'pdf' (DANFSe) ou 'xml'. Baixa como arquivo — download por link
// de blob não cai no bloqueio de pop-up, mesmo depois do await.
// incluirHomologacao: só vale para o escritório (tela de emissão).
export async function baixarNfse(clienteId, nota, formato, { incluirHomologacao = false } = {}) {
  const resp = await chamar({ acao: formato, cliente_id: clienteId, nota_id: nota.id, incluir_homologacao: incluirHomologacao });
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
