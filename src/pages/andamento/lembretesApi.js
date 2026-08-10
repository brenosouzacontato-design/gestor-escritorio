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

export async function atualizarLembrete(id, { dataHora, mensagem }) {
  const { error } = await supabase
    .from('lembretes')
    .update({ data_hora: dataHora, mensagem: mensagem || null })
    .eq('id', id);
  if (error) throw error;
}

export async function marcarLembreteEnviado(id, enviado = true) {
  const { error } = await supabase
    .from('lembretes')
    .update({ enviado, enviado_em: enviado ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// Todos os lembretes de todos os clientes, com o nome do cliente e o
// título do item (obrigação ou tarefa) já resolvidos — alimenta a tela
// Notificacoes.jsx (visão tipo lista/planilha, com interações direto na
// linha). Um lembrete só tem um dos dois vínculos preenchido por vez (ver
// constraint lembretes_um_item), por isso os dois embeds abaixo são
// sempre um "left join" implícito do PostgREST.
export async function listarTodosLembretes() {
  const { data, error } = await supabase
    .from('lembretes')
    .select('*, obrigacoes(titulo, cliente_id, clientes(nome)), tarefas(titulo, cliente_id, clientes(nome))')
    .order('data_hora', { ascending: false });
  if (error) throw error;
  return data.map((l) => {
    const item = l.obrigacoes || l.tarefas;
    return {
      id: l.id,
      tipo: l.obrigacao_id ? 'obrigacao' : 'tarefa',
      dataHora: l.data_hora,
      mensagem: l.mensagem,
      enviado: l.enviado,
      enviadoEm: l.enviado_em,
      itemTitulo: item?.titulo || '—',
      clienteNome: item?.clientes?.nome || '—',
    };
  });
}
