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

// Notas ainda não emitidas, com o que falta: [{ id, nome, cpf, data, valor, descricao, pronta, pendencias, erros, avisos }]
export async function listarNfsePendentes(clienteId) {
  const resp = await chamar({ acao: 'pendentes', cliente_id: clienteId });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível carregar as notas pendentes.');
  return dados.notas || [];
}

// O cliente completa a nota (cpf / nome / descrição). Devolve a nota revalidada.
export async function completarNfse(clienteId, notaId, campos) {
  const resp = await chamar({ acao: 'completar', cliente_id: clienteId, nota_id: notaId, ...campos });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível salvar.');
  return dados.nota;
}

// Link público (assinado, com validade) do PDF da nota, para mandar ao tomador
export async function linkPdfNfse(clienteId, notaId) {
  const resp = await chamar({ acao: 'link', cliente_id: clienteId, nota_id: notaId });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.error || 'Não foi possível gerar o link.');
  return dados;
}

// Número digitado → só dígitos com DDI 55. null se não parecer celular/fixo brasileiro.
export function numeroWhatsapp(digitado) {
  let d = String(digitado || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (!d.startsWith('55') || d.length < 12) d = `55${d}`;
  return d.length === 12 || d.length === 13 ? d : null;
}
