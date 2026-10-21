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
