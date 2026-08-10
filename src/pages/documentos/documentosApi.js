// documentosApi.js
// Camada de dados dos anexos de documentos — upload pro Storage, listagem
// de candidatos (obrigações/tarefas em aberto) pra alimentar a identificação
// automática (netlify/functions/identificar-documento.js), e confirmação do
// match sugerido (que efetivamente dá baixa reaproveitando concluirEtapa já
// existente em andamentoApi.js, ou marcando a tarefa como concluída do mesmo
// jeito que toggleTarefa faz em store/index.js).
import { supabase } from '../../lib/supabase';
import { concluirEtapa } from '../andamento/andamentoApi';

const BUCKET = 'documentos';

// Título legível do item que o documento resolveu — usado tanto na aba
// "Concluídos" (DocumentosPage.jsx) quanto na página pública de
// compartilhamento (DocumentoCompartilhadoPage.jsx).
export function itemResolvido(doc) {
  if (doc.etapas_obrigacao) return `${doc.obrigacoes?.titulo || 'Obrigação'} — etapa "${doc.etapas_obrigacao.nome}"`;
  if (doc.tarefas) return `Tarefa: ${doc.tarefas.titulo}`;
  return null;
}

// ---------- UPLOAD ----------

export async function uploadArquivo(arquivo) {
  const ext = arquivo.name.includes('.') ? arquivo.name.split('.').pop() : 'bin';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo, {
    contentType: arquivo.type || 'application/octet-stream',
  });
  if (error) throw error;
  return path;
}

// ---------- CANDIDATOS (obrigações/tarefas em aberto pra IA escolher) ----------

// Só entram candidatos com cliente_id preenchido — sem empresa não dá pra
// casar com o cliente que a IA identificar no documento.
export async function listarCandidatos() {
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

// ---------- CRUD "documentos" ----------

export async function criarDocumento({ nomeArquivo, storagePath, tipoMime, tamanhoBytes, sugestao }) {
  const { data, error } = await supabase
    .from('documentos')
    .insert({
      nome_arquivo: nomeArquivo,
      storage_path: storagePath,
      tipo_mime: tipoMime,
      tamanho_bytes: tamanhoBytes,
      cliente_id: sugestao?.clienteId || null,
      tipo_documento_sugerido: sugestao?.tipoDocumento || null,
      confianca: sugestao?.confianca || null,
      observacao_ia: sugestao?.observacao || null,
      status: sugestao?.candidatoId ? 'identificado' : 'sem_match',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listarDocumentos() {
  const { data, error } = await supabase
    .from('documentos')
    .select('*, clientes(nome)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Documentos já confirmados (deram baixa ou foram arquivados), com o
// título do item resolvido — alimenta a aba "Concluídos" de
// DocumentosPage.jsx. Um documento só tem um dos três vínculos preenchido
// por vez (ver confirmarDocumento), por isso os três joins são todos
// opcionais (left join implícito do PostgREST quando a FK é nullable).
// Anexos de um cliente específico (qualquer status) — alimenta a aba
// "Anexos" do modal de empresa em Empresas.jsx.
export async function listarDocumentosPorCliente(clienteId) {
  const { data, error } = await supabase
    .from('documentos')
    .select('*, obrigacoes(titulo), etapas_obrigacao(nome), tarefas(titulo)')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Documentos ainda não confirmados, com a sugestão da IA já resolvida —
// alimenta a aba "A revisar" de DocumentosPage.jsx. Cobre tanto o upload
// manual quanto os que chegam pelo grupo "Documentos" do WhatsApp
// (whatsapp-webhook.js insere direto nessa mesma tabela, com o mesmo
// contrato de status usado aqui).
export async function listarDocumentosPendentes() {
  const { data, error } = await supabase
    .from('documentos')
    .select('*, clientes(nome)')
    .in('status', ['pendente_analise', 'identificado', 'sem_match'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listarDocumentosConfirmados() {
  const { data, error } = await supabase
    .from('documentos')
    .select('*, clientes(nome), obrigacoes(titulo), etapas_obrigacao(nome), tarefas(titulo)')
    .eq('status', 'confirmado')
    .order('confirmado_em', { ascending: false });
  if (error) throw error;
  return data;
}

// Signed URL avulsa (botão "Baixar" na aba Concluídos) — bucket é privado,
// não dá pra linkar direto pelo storage_path.
export async function criarLinkAssinado(storagePath, segundos = 60 * 5) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, segundos);
  if (error) throw error;
  return data.signedUrl;
}

// Usado pela página pública de compartilhamento (DocumentoCompartilhadoPage,
// acessada via ?doc=<id> — ver main.jsx). Gera uma signed URL nova a cada
// acesso (o bucket é privado, não dá pra usar getPublicUrl) — o link
// ?doc=<id> em si não expira, só o acesso ao arquivo dentro dele.
export async function obterDocumentoPublico(documentoId) {
  const { data: doc, error } = await supabase
    .from('documentos')
    .select('*, clientes(nome), obrigacoes(titulo), etapas_obrigacao(nome), tarefas(titulo)')
    .eq('id', documentoId)
    .single();
  if (error) throw error;

  const { data: signed, error: errSigned } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60 * 60); // 1h, renovado a cada visita
  if (errSigned) throw errSigned;

  return { ...doc, urlArquivo: signed.signedUrl };
}

// ---------- BACKUP WHATSAPP → DRIVE (só consulta, tabela "documentos_whatsapp") ----------
// Log dos arquivos enviados no grupo "Documentos" do WhatsApp e subidos
// automaticamente pro Drive (netlify/functions/whatsapp-webhook.js) — sistema
// separado do fluxo de upload manual + IA acima, sem vínculo com cliente.
export async function listarUploadsWhatsapp() {
  const { data, error } = await supabase
    .from('documentos_whatsapp')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

export async function excluirDocumento(id) {
  const { data: doc, error: errBusca } = await supabase.from('documentos').select('storage_path').eq('id', id).single();
  if (errBusca) throw errBusca;
  if (doc?.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from('documentos').delete().eq('id', id);
  if (error) throw error;
}

// Aplica de fato a baixa (etapa ou tarefa, conforme o candidato escolhido —
// sugerido pela IA ou trocado manualmente pelo usuário na revisão) e marca
// o documento como confirmado. candidato pode vir null (usuário decidiu que
// não há correspondência — o documento só fica arquivado, sem dar baixa em
// nada).
export async function confirmarDocumento(documentoId, { clienteId, candidato }) {
  const agora = new Date().toISOString();

  if (candidato?.tipo === 'etapa') {
    const { data: etapa, error: errEtapa } = await supabase
      .from('etapas_obrigacao')
      .select('*')
      .eq('id', candidato.id)
      .single();
    if (errEtapa) throw errEtapa;
    await concluirEtapa(etapa, { observacao: 'Baixa automática via documento anexado' });
  } else if (candidato?.tipo === 'tarefa') {
    const { error } = await supabase
      .from('tarefas')
      .update({ concluida: true, concluida_em: agora, updated_at: agora })
      .eq('id', candidato.id);
    if (error) throw error;
  }

  const { error: errDoc } = await supabase
    .from('documentos')
    .update({
      cliente_id: clienteId || null,
      obrigacao_id: candidato?.tipo === 'etapa' ? candidato.obrigacaoId ?? null : null,
      etapa_obrigacao_id: candidato?.tipo === 'etapa' ? candidato.id : null,
      tarefa_id: candidato?.tipo === 'tarefa' ? candidato.id : null,
      status: 'confirmado',
      confirmado_em: agora,
    })
    .eq('id', documentoId);
  if (errDoc) throw errDoc;
}
