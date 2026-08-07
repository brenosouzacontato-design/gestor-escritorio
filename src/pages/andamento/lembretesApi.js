// lembretesApi.js
// Camada de dados dos lembretes com data/hora própria (independente do
// vencimento) numa obrigação ou tarefa — disparados por WhatsApp pela
// Netlify Scheduled Function netlify/functions/lembretes-cron.js.
import { supabase } from '../../lib/supabase';

export async function criarLembrete({ obrigacaoId, tarefaId, dataHora, mensagem }) {
  const { data, error } = await supabase
    .from('lembretes')
    .insert({
      obrigacao_id: obrigacaoId || null,
      tarefa_id: tarefaId || null,
      data_hora: dataHora,
      mensagem: mensagem || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Lembretes ainda não enviados de um item — usado pra mostrar o indicador
// (sino preenchido) na linha da obrigação/tarefa.
export async function listarLembretes({ obrigacaoId, tarefaId }) {
  let query = supabase.from('lembretes').select('*').eq('enviado', false);
  query = obrigacaoId ? query.eq('obrigacao_id', obrigacaoId) : query.eq('tarefa_id', tarefaId);
  const { data, error } = await query.order('data_hora', { ascending: true });
  if (error) throw error;
  return data;
}

// Lembretes pendentes de vários itens de uma vez — alimenta o indicador
// (sino preenchido) nas linhas de obrigações/tarefas do modal de empresa,
// sem precisar de uma query por linha.
export async function listarLembretesPorItens({ obrigacaoIds = [], tarefaIds = [] }) {
  if (obrigacaoIds.length === 0 && tarefaIds.length === 0) return [];
  let query = supabase.from('lembretes').select('*').eq('enviado', false);
  if (obrigacaoIds.length > 0 && tarefaIds.length > 0) {
    query = query.or(`obrigacao_id.in.(${obrigacaoIds.join(',')}),tarefa_id.in.(${tarefaIds.join(',')})`);
  } else if (obrigacaoIds.length > 0) {
    query = query.in('obrigacao_id', obrigacaoIds);
  } else {
    query = query.in('tarefa_id', tarefaIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function excluirLembrete(id) {
  const { error } = await supabase.from('lembretes').delete().eq('id', id);
  if (error) throw error;
}
