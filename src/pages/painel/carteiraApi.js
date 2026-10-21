// Link da carteira (?carteira=<token>) — a pessoa responsável pela carteira
// abre o painel de cada empresa dela sem login (PainelCarteiraPage.jsx).
// Tabela carteira_links + RPC carteira_painel: supabase-schema-painel-carteira.sql.
import { supabase } from '../../lib/supabase';
import { urlPublica } from '../../lib/linksPublicos';

export const SEM_SQL_CARTEIRA = 'O link da carteira precisa do script supabase-schema-painel-carteira.sql rodado no Supabase.';

function faltaSql(error) {
  return !!error && ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error.code);
}

// Token atual da carteira (null se ainda não gerou). Dentro do gestor.
export async function obterTokenCarteira(carteira) {
  const { data, error } = await supabase.from('carteira_links').select('token').eq('carteira', carteira).maybeSingle();
  if (faltaSql(error)) throw new Error(SEM_SQL_CARTEIRA);
  if (error) throw error;
  return data?.token || null;
}

// Gera (ou troca) o token da carteira — o link anterior para de funcionar.
export async function gerarTokenCarteira(carteira) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await supabase.from('carteira_links')
    .upsert({ carteira, token, atualizado_em: new Date().toISOString() }, { onConflict: 'carteira' });
  if (faltaSql(error)) throw new Error(SEM_SQL_CARTEIRA);
  if (error) throw error;
  return token;
}

// Sem competência no link de propósito: a página abre no mês anterior (mesmo
// padrão do gestor), então o mesmo link serve todo mês.
export function urlCarteira(token) {
  return urlPublica({ carteira: token });
}

// Página pública: empresas da carteira dona do token.
export async function listarEmpresasCarteira(token) {
  const { data, error } = await supabase.rpc('carteira_painel', { p_token: token });
  if (faltaSql(error)) throw new Error('Este link ainda não está ativo. Avise o escritório.');
  if (error) throw error;
  return data || [];
}

// ---------- Tarefas, obrigações e anexos pelo link da carteira ----------
// Tudo passa por netlify/functions/carteira-acao.js, que confere o token da
// carteira e se a empresa é dela antes de ler ou gravar (a página não tem login).

async function chamarCarteira(token, acao, dados = {}) {
  const resp = await fetch('/.netlify/functions/carteira-acao', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-carteira-token': token },
    body: JSON.stringify({ acao, ...dados }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || `Falha (${resp.status}). Tente de novo.`);
  return json;
}

// { carteira, empresas, obrigacoes, tarefas, anexos } da competência
export const listarItensCarteira = (token, competencia) => chamarCarteira(token, 'listar', { competencia });
export const mudarStatusObrigacaoCarteira = (token, id, status) => chamarCarteira(token, 'status_obrigacao', { id, status });
export const concluirTarefaCarteira = (token, id, concluida) => chamarCarteira(token, 'concluir_tarefa', { id, concluida });
export const criarTarefaCarteira = (token, tarefa) => chamarCarteira(token, 'criar_tarefa', tarefa);

// alvo = { tipo: 'obrigacao' | 'tarefa', id }. O arquivo vai direto pro
// Storage por uma URL de upload assinada que a function gera — o navegador
// não tem permissão de escrita no bucket.
export async function anexarArquivoCarteira(token, alvo, arquivo, { darBaixa = false } = {}) {
  const dados = { alvo, nomeArquivo: arquivo.name, tipoMime: arquivo.type || null, tamanho: arquivo.size };
  const { path, token: tokenUpload } = await chamarCarteira(token, 'url_upload', dados);
  const { error } = await supabase.storage.from('documentos').uploadToSignedUrl(path, tokenUpload, arquivo, {
    contentType: arquivo.type || 'application/octet-stream',
  });
  if (error) throw new Error(`Não consegui enviar o arquivo: ${error.message}`);
  const { anexo } = await chamarCarteira(token, 'registrar_anexo', { ...dados, storagePath: path, darBaixa });
  return anexo;
}

export async function abrirAnexoCarteira(token, documentoId) {
  // abre a aba antes da chamada: navegador de celular bloqueia window.open
  // feito depois de um await (não conta mais como clique do usuário)
  const aba = window.open('', '_blank');
  try {
    const { url } = await chamarCarteira(token, 'url_download', { documentoId });
    if (aba) aba.location.href = url; else window.location.href = url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}
