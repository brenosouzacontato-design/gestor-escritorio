// andamentoApi.js
// Camada de dados do "Andamento de Obrigações" — processos com etapas
// (rescisão, EFD-Contribuições etc), por cima da tabela "obrigacoes" já
// existente. Segue o mesmo padrão do módulo contábil: funções simples
// chamando o Supabase direto, sem passar pelo Zustand.
import { supabase } from '../../lib/supabase';

// ---------- DEPARTAMENTOS ----------

export async function listarDepartamentos() {
  const { data, error } = await supabase
    .from('departamentos')
    .select('*')
    .eq('ativo', true)
    .order('ordem');
  if (error) throw error;
  return data;
}

export async function criarDepartamento(nome, icone = null) {
  const { data, error } = await supabase
    .from('departamentos')
    .insert({ nome, icone })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------- TIPOS DE OBRIGAÇÃO / TEMPLATE DE ETAPAS ----------

export async function listarTiposObrigacao(departamentoId) {
  let query = supabase.from('tipos_obrigacao').select('*').eq('ativo', true).order('nome');
  if (departamentoId) query = query.eq('departamento_id', departamentoId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function listarEtapasTemplate(tipoObrigacaoId) {
  const { data, error } = await supabase
    .from('etapas_template')
    .select('*')
    .eq('tipo_obrigacao_id', tipoObrigacaoId)
    .order('ordem');
  if (error) throw error;
  return data;
}

// Todos os tipos de obrigação (pra tela de gerenciamento — "personalização
// de cada etapa"), com departamento e etapas já aninhados.
export async function listarTodosTiposObrigacaoComEtapas() {
  const { data, error } = await supabase
    .from('tipos_obrigacao')
    .select('*, departamentos(id, nome, icone), etapas_template(*)')
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  return data.map((t) => ({ ...t, etapas_template: (t.etapas_template || []).sort((a, b) => a.ordem - b.ordem) }));
}

// Cria um tipo de obrigação novo já com as etapas do template (nome +
// prazo em dias a partir do início de cada etapa, na ordem informada).
export async function criarTipoObrigacaoComEtapas({ departamentoId, nome, descricao, recorrente, etapas }) {
  const { data: tipo, error: errTipo } = await supabase
    .from('tipos_obrigacao')
    .insert({ departamento_id: departamentoId, nome, descricao: descricao || null, recorrente: !!recorrente })
    .select()
    .single();
  if (errTipo) throw errTipo;

  const linhas = etapas.map((et, i) => ({
    tipo_obrigacao_id: tipo.id, nome: et.nome, ordem: i + 1, prazo_dias_relativo: et.prazoDias ?? 0,
  }));
  const { error: errEtapas } = await supabase.from('etapas_template').insert(linhas);
  if (errEtapas) throw errEtapas;

  return tipo;
}

// Adiciona uma etapa no fim do template de um tipo já existente.
export async function adicionarEtapaTemplate(tipoObrigacaoId, nome, prazoDias) {
  const existentes = await listarEtapasTemplate(tipoObrigacaoId);
  const ordem = (existentes.at(-1)?.ordem || 0) + 1;
  const { error } = await supabase.from('etapas_template').insert({
    tipo_obrigacao_id: tipoObrigacaoId, nome, ordem, prazo_dias_relativo: prazoDias ?? 0,
  });
  if (error) throw error;
}

export async function excluirEtapaTemplate(id) {
  const { error } = await supabase.from('etapas_template').delete().eq('id', id);
  if (error) throw error;
}

// "Exclui" um tipo de obrigação — soft delete (ativo=false), preserva
// histórico de obrigações já criadas com esse tipo.
export async function arquivarTipoObrigacao(id) {
  const { error } = await supabase.from('tipos_obrigacao').update({ ativo: false }).eq('id', id);
  if (error) throw error;
}

// ---------- OBRIGAÇÕES COM ETAPAS ----------

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// "competencia" (formato MM/YYYY, igual ao resto do app) também é NOT NULL
// na tabela legada — processo com etapas não é mensal de verdade, usa o mês
// de início só pra satisfazer a constraint; nada no fluxo novo lê esse campo.
function competenciaAtual() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setDate(d.getDate() + (dias ?? 0));
  return d.toISOString().slice(0, 10);
}

// Cria a obrigação (linha em "obrigacoes") e já faz o snapshot das etapas do
// template em "etapas_obrigacao" — a 1ª etapa nasce em_andamento, o resto
// pendente. "tipo"/"competencia" da tabela legada são NOT NULL sem default
// (constraint que só existe em produção, não documentada em .sql) — nenhum
// dos dois é usado pelo fluxo novo, só preenchidos pra satisfazer a tabela.
export async function criarObrigacaoComEtapas({ clienteId, tipoObrigacaoId, departamentoId, titulo, responsavel, taskId }) {
  const template = await listarEtapasTemplate(tipoObrigacaoId);
  if (template.length === 0) throw new Error('Esse tipo de obrigação não tem etapas cadastradas.');

  const dataInicio = hoje();
  const { data: obrigacao, error: errObrig } = await supabase
    .from('obrigacoes')
    .insert({
      cliente_id: clienteId,
      tipo: titulo,
      competencia: competenciaAtual(),
      tipo_obrigacao_id: tipoObrigacaoId,
      departamento_id: departamentoId,
      titulo,
      responsavel: responsavel || null,
      task_id: taskId || null,
      // "obrigacoes.status" tem CHECK legado (pendente|concluido|vencido|
      // nao_aplica) — "pendente" aqui só significa "processo em andamento,
      // não concluído"; quem mostra o progresso real são as etapas.
      status: 'pendente',
      data_inicio: dataInicio,
    })
    .select()
    .single();
  if (errObrig) throw errObrig;

  const etapas = template.map((et, i) => ({
    obrigacao_id: obrigacao.id,
    etapas_template_id: et.id,
    nome: et.nome,
    ordem: et.ordem,
    status: i === 0 ? 'em_andamento' : 'pendente',
    data_prevista: somarDias(dataInicio, et.prazo_dias_relativo),
  }));
  const { error: errEtapas } = await supabase.from('etapas_obrigacao').insert(etapas);
  if (errEtapas) throw errEtapas;

  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: obrigacao.id,
    descricao: `Obrigação "${titulo}" iniciada`,
    autor: responsavel || null,
  });

  return obrigacao;
}

// Marca "entregue" / "a entregar" — independente do progresso das etapas
// (o trabalho pode estar concluído mas ainda não ter sido entregue/
// comunicado ao cliente).
export async function marcarEntregaObrigacao(obrigacaoId, entregue) {
  const { error } = await supabase.from('obrigacoes').update({ entregue }).eq('id', obrigacaoId);
  if (error) throw error;
  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: obrigacaoId,
    descricao: entregue ? 'Marcada como entregue' : 'Marcada como a entregar',
  });
}

// Obrigações "novas" (com tipo_obrigacao_id, i.e. processo com etapas) de um
// conjunto de clientes — já traz etapas e tipo/departamento aninhados pra
// alimentar a timeline direto.
export async function listarObrigacoesComEtapas(clienteIds) {
  if (!clienteIds || clienteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('obrigacoes')
    .select(`
      *,
      tipos_obrigacao(id, nome, departamento_id),
      etapas_obrigacao(*)
    `)
    .in('cliente_id', clienteIds)
    .not('tipo_obrigacao_id', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((o) => ({
    ...o,
    etapas_obrigacao: (o.etapas_obrigacao || []).sort((a, b) => a.ordem - b.ordem),
  }));
}

export async function listarHistoricoObrigacao(obrigacaoId) {
  const { data, error } = await supabase
    .from('historico_obrigacao')
    .select('*')
    .eq('obrigacao_id', obrigacaoId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

// Marca uma etapa como concluída e orquestra o resto do processo:
// 1) registra no histórico
// 2) avança a próxima etapa (por ordem) pra em_andamento, recalculando
//    data_prevista a partir do prazo_dias_relativo do template dela
// 3) se não houver próxima etapa, marca a obrigação inteira como concluída
export async function concluirEtapa(etapa, { responsavel, observacao } = {}) {
  const dataConclusao = hoje();

  const { error: errEtapa } = await supabase
    .from('etapas_obrigacao')
    .update({ status: 'concluido', data_conclusao: dataConclusao, responsavel: responsavel || etapa.responsavel || null })
    .eq('id', etapa.id);
  if (errEtapa) throw errEtapa;

  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: etapa.obrigacao_id,
    etapa_obrigacao_id: etapa.id,
    descricao: `Etapa "${etapa.nome}" concluída`,
    observacao: observacao || null,
    autor: responsavel || null,
  });

  const { data: etapasRestantes, error: errLista } = await supabase
    .from('etapas_obrigacao')
    .select('*, etapas_template(prazo_dias_relativo)')
    .eq('obrigacao_id', etapa.obrigacao_id)
    .order('ordem');
  if (errLista) throw errLista;

  const proxima = etapasRestantes.find((e) => e.ordem > etapa.ordem && e.status === 'pendente');

  if (proxima) {
    const prazo = proxima.etapas_template?.prazo_dias_relativo;
    await supabase
      .from('etapas_obrigacao')
      .update({ status: 'em_andamento', data_prevista: somarDias(dataConclusao, prazo) })
      .eq('id', proxima.id);
  } else {
    await supabase
      .from('obrigacoes')
      .update({ status: 'concluido', data_conclusao: dataConclusao })
      .eq('id', etapa.obrigacao_id);
    await supabase.from('historico_obrigacao').insert({
      obrigacao_id: etapa.obrigacao_id,
      descricao: 'Obrigação concluída',
      autor: responsavel || null,
    });
  }
}

// "Atrasado" é derivado no cliente (sem cron): etapa em_andamento cuja data
// prevista já passou.
export function etapaAtrasada(etapa) {
  return etapa.status === 'em_andamento' && etapa.data_prevista && etapa.data_prevista < hoje();
}

export function statusVisualEtapa(etapa) {
  if (etapa.status === 'concluido') return 'concluido';
  if (etapaAtrasada(etapa)) return 'atrasado';
  if (etapa.status === 'em_andamento') return 'em_andamento';
  return 'pendente';
}
