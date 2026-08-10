// netlify/functions/lib/candidatosDocumento.js
//
// Versão backend (service-role client, sem RLS) da mesma consulta de
// "candidatos" que documentosApi.js faz no frontend (listarCandidatos) —
// etapas de obrigação em andamento + tarefas pendentes, só as que já têm
// cliente_id preenchido. Usada por whatsapp-webhook.js pra montar a lista
// que vai pra identificarDocumento junto com o arquivo.

async function listarCandidatosDocumento(supabase) {
  const [{ data: etapas, error: errEtapas }, { data: tarefas, error: errTarefas }] = await Promise.all([
    supabase
      .from('etapas_obrigacao')
      .select('id, nome, obrigacao_id, obrigacoes!inner(cliente_id, titulo, clientes(nome))')
      .eq('status', 'em_andamento'),
    supabase
      .from('tarefas')
      .select('id, titulo, cliente_id, clientes(nome)')
      .eq('concluida', false),
  ]);
  if (errEtapas) throw errEtapas;
  if (errTarefas) throw errTarefas;

  const candidatosEtapas = (etapas || [])
    .filter((e) => e.obrigacoes?.cliente_id)
    .map((e) => ({
      id: e.id,
      tipo: 'etapa',
      obrigacaoId: e.obrigacao_id,
      clienteId: e.obrigacoes.cliente_id,
      clienteNome: e.obrigacoes.clientes?.nome || '—',
      rotulo: `${e.obrigacoes.titulo} — etapa "${e.nome}"`,
    }));

  const candidatosTarefas = (tarefas || [])
    .filter((t) => t.cliente_id)
    .map((t) => ({
      id: t.id,
      tipo: 'tarefa',
      clienteId: t.cliente_id,
      clienteNome: t.clientes?.nome || '—',
      rotulo: `Tarefa: ${t.titulo}`,
    }));

  return [...candidatosEtapas, ...candidatosTarefas];
}

module.exports = { listarCandidatosDocumento };
