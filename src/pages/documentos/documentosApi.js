// documentosApi.js
// Camada de dados dos anexos de documentos — upload pro Storage, listagem
// de candidatos (obrigações/tarefas em aberto) pra alimentar a identificação
// automática (netlify/functions/identificar-documento.js), e confirmação do
// match sugerido (que efetivamente dá baixa reaproveitando concluirEtapa já
// existente em andamentoApi.js, ou marcando a tarefa como concluída do mesmo
// jeito que toggleTarefa faz em store/index.js).
import { supabase, tokenPainelAtivo, cabecalhosFunctions, rpcAusente } from '../../lib/supabase';
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

async function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(arquivo);
  });
}

// Chama netlify/functions/identificar-documento.js -- a IA sugere tipo de
// documento, cliente e qual candidato (etapa de obrigação ou tarefa em
// aberto) ele resolve. candidatos: [{id, clienteId, clienteNome, rotulo}],
// ver listarCandidatos abaixo (reaproveitada tanto pela fila de upload
// genérica de DocumentosPage.jsx quanto pelo atalho por empresa em
// Empresas.jsx, que já filtra os candidatos pro cliente do card aberto).
export async function identificarDocumento(arquivo, candidatos) {
  const arquivoBase64 = await arquivoParaBase64(arquivo);
  const resp = await fetch('/.netlify/functions/identificar-documento', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify({ arquivoBase64, filename: arquivo.name, mimeType: arquivo.type, candidatos }),
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao identificar o documento.');
  }
  return resp.json();
}

// ---------- CANDIDATOS (obrigações/tarefas em aberto pra IA escolher) ----------

// Só entram candidatos com cliente_id preenchido — sem empresa não dá pra
// casar com o cliente que a IA identificar no documento.
export async function listarCandidatos() {
  const [{ data: etapas, error: errEtapas }, { data: tarefas, error: errTarefas }] = await Promise.all([
    supabase
      .from('etapas_obrigacao')
      .select('id, nome, obrigacao_id, obrigacoes!inner(cliente_id, titulo, competencia, clientes(nome))')
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
      competencia: e.obrigacoes.competencia || null,
      rotulo: `${e.obrigacoes.titulo}${e.obrigacoes.competencia ? ` ${e.obrigacoes.competencia}` : ''} — etapa "${e.nome}"`,
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

// Anexo direto numa obrigação ou tarefa (botão 📎 do card em Empresas.jsx) —
// o item já é conhecido, então não passa pela IA: sobe o arquivo e grava o
// documento já confirmado e vinculado. alvo = { tipo: 'obrigacao' | 'tarefa', id }.
// darBaixa marca a obrigação como concluída / a tarefa como feita.
export async function anexarDocumentoAoItem({ clienteId, alvo, arquivo, darBaixa = false }) {
  const storagePath = await uploadArquivo(arquivo);
  const agora = new Date().toISOString();
  const { data, error } = await supabase.from('documentos').insert({
    cliente_id: clienteId,
    nome_arquivo: arquivo.name,
    storage_path: storagePath,
    tipo_mime: arquivo.type || null,
    tamanho_bytes: arquivo.size,
    obrigacao_id: alvo.tipo === 'obrigacao' ? alvo.id : null,
    tarefa_id: alvo.tipo === 'tarefa' ? alvo.id : null,
    status: 'confirmado',
    confirmado_em: agora,
  }).select().single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
  if (darBaixa) {
    const { error: errBaixa } = alvo.tipo === 'obrigacao'
      ? await supabase.from('obrigacoes').update({ status: 'concluido', updated_at: agora }).eq('id', alvo.id)
      : await supabase.from('tarefas').update({ concluida: true, concluida_em: agora, updated_at: agora }).eq('id', alvo.id);
    if (errBaixa) throw errBaixa;
  }
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

// ---------- Comprovante de pagamento → guia paga ----------

// Mesmo critério de "é imposto" do painel (PainelCompartilhadoPage.jsx) e
// do webhook (netlify/functions/lib/comprovantePagamento.js).
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia|maed|multa/i;

// Guias de imposto anexadas que ainda não têm pagamento marcado — opções do
// "Dar baixa em" da aba "A revisar" quando o documento é um comprovante que
// o WhatsApp não conseguiu casar sozinho com a guia.
export async function listarGuiasEmAberto() {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, valor_guia, nome_arquivo, tipo_documento_sugerido, obrigacoes!inner(titulo, tipo, competencia, cliente_id)')
    .eq('status', 'confirmado')
    .not('obrigacao_id', 'is', null)
    .is('pago_em', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || [])
    .filter((d) => TITULO_IMPOSTO.test(`${d.obrigacoes.titulo || ''} ${d.obrigacoes.tipo || ''} ${d.tipo_documento_sugerido || ''} ${d.nome_arquivo || ''}`))
    .map((d) => ({
      id: d.id,
      clienteId: d.obrigacoes.cliente_id,
      rotulo: `${d.obrigacoes.titulo || d.obrigacoes.tipo}${d.obrigacoes.competencia ? ` ${d.obrigacoes.competencia}` : ''}`
        + (d.valor_guia != null ? ` — ${Number(d.valor_guia).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''),
    }));
}

// Liga na mão um comprovante da fila "A revisar" à guia que ele paga: a guia
// fica como paga com o comprovante disponível no painel do cliente (mesmo
// resultado da baixa automática do WhatsApp). O arquivo passa a pertencer à
// guia — o registro do documento sai da fila sem apagar o arquivo.
export async function pagarGuiaComComprovante(documentoId, guiaId) {
  const { data: doc, error: errDoc } = await supabase
    .from('documentos').select('storage_path, nome_arquivo').eq('id', documentoId).single();
  if (errDoc) throw errDoc;

  const { error: errGuia } = await supabase
    .from('documentos')
    .update({ pago_em: new Date().toISOString(), comprovante_path: doc.storage_path, comprovante_nome: doc.nome_arquivo })
    .eq('id', guiaId);
  if (errGuia) throw errGuia;

  const { error: errRemover } = await supabase.from('documentos').delete().eq('id', documentoId);
  if (errRemover) throw errRemover;
}

// Signed URL avulsa (botão "Baixar" na aba Concluídos) — bucket é privado,
// não dá pra linkar direto pelo storage_path.
//
// No link público do painel o cliente não acessa o Storage (só o escritório
// tem policy no bucket): a URL sai da function painel-arquivo, que confere se
// o arquivo é do cliente do token. Ver docs/seguranca-rls.md.
export async function criarLinkAssinado(storagePath, segundos = 60 * 5) {
  if (tokenPainelAtivo()) return assinarPeloServidor({ storagePath, segundos });
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, segundos);
  if (error) throw error;
  return data.signedUrl;
}

// Abre o anexo numa aba nova a partir de um clique. Não dá pra só fazer
// `await criarLinkAssinado(...)` e depois `window.open(url)` — o navegador
// só reconhece um `window.open` como iniciado pelo usuário se ele rodar
// *síncrono* dentro do handler de clique; depois de um `await` (a ida ao
// Storage pra assinar a URL) a aba já não conta mais como gesto do usuário
// e é bloqueada como pop-up, silenciosamente (sem erro pra cair no catch) —
// por isso os anexos pareciam simplesmente não baixar. Abrindo a aba em
// branco antes do await e só preenchendo o destino depois contorna isso.
export async function abrirLinkAssinado(storagePath, segundos = 60 * 5) {
  const aba = window.open('', '_blank');
  try {
    const url = await criarLinkAssinado(storagePath, segundos);
    if (aba) aba.location.href = url;
    else window.open(url, '_blank');
    return url;
  } catch (e) {
    aba?.close();
    throw e;
  }
}

// Usado pela página pública de compartilhamento (DocumentoCompartilhadoPage,
// acessada via ?doc=<id> — ver main.jsx). Gera uma signed URL nova a cada
// acesso (o bucket é privado, não dá pra usar getPublicUrl) — o link
// ?doc=<id> em si não expira, só o acesso ao arquivo dentro dele.
//
// Com RLS ligado o anônimo não lê a tabela documentos: os dados vêm da RPC
// documento_publico (só o documento daquele id) e a URL assinada da function
// painel-arquivo. Sem a RPC no banco ainda, cai na leitura direta de antes.
export async function obterDocumentoPublico(documentoId) {
  let doc;
  const { data: viaRpc, error: errRpc } = await supabase.rpc('documento_publico', { p_documento_id: documentoId });
  if (rpcAusente(errRpc)) {
    const { data, error } = await supabase
      .from('documentos')
      .select('*, clientes(nome), obrigacoes(titulo), etapas_obrigacao(nome), tarefas(titulo)')
      .eq('id', documentoId)
      .single();
    if (error) throw error;
    doc = data;
  } else {
    if (errRpc) throw errRpc;
    doc = viaRpc;
  }
  if (!doc) throw new Error('Documento não encontrado.');

  let urlArquivo;
  try {
    urlArquivo = await assinarPeloServidor({ documentoId }); // 1h, renovado a cada visita
  } catch (e) {
    // function fora do ar (ex.: `vite` local sem `netlify dev`) — tenta direto
    // no Storage, o que só funciona enquanto o bucket ainda estiver aberto
    const { data: signed, error: errSigned } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60 * 60);
    if (errSigned) throw e;
    urlArquivo = signed.signedUrl;
  }
  return { ...doc, urlArquivo };
}

// netlify/functions/painel-arquivo.js — { storagePath } (link do painel, com
// o token no cabeçalho) ou { documentoId } (link ?doc=). Devolve a URL assinada.
async function assinarPeloServidor(corpo) {
  const resp = await fetch('/.netlify/functions/painel-arquivo', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || !dados.url) throw new Error(dados.error || 'Não foi possível abrir o arquivo.');
  return dados.url;
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

// Desfaz a baixa que um documento causou — etapa volta a em_andamento (e a
// obrigação dela volta a pendente), ou tarefa volta a não concluída.
// Usado antes de excluir um documento vinculado errado (pra não deixar a
// obrigação/tarefa marcada como feita por engano) e antes de reatribuir
// pra outro vínculo (reatribuirDocumento) — sem isso, trocar o vínculo
// deixava a baixa antiga "grudada" enquanto aplicava a nova.
async function desfazerBaixa({ obrigacao_id, etapa_obrigacao_id, tarefa_id }) {
  if (etapa_obrigacao_id) {
    await supabase.from('etapas_obrigacao').update({ status: 'em_andamento', data_conclusao: null }).eq('id', etapa_obrigacao_id);
    if (obrigacao_id) {
      await supabase.from('obrigacoes').update({ status: 'pendente', data_conclusao: null }).eq('id', obrigacao_id);
    }
  } else if (tarefa_id) {
    await supabase.from('tarefas').update({ concluida: false, concluida_em: null }).eq('id', tarefa_id);
  }
}

// desfazerVinculo=true também reverte a baixa que o documento causou —
// use quando o documento foi vinculado errado (a obrigação/tarefa não
// devia ter sido dada como feita). Sem isso, excluir só remove o arquivo
// e mantém a baixa já aplicada (útil pra só limpar um anexo duplicado,
// por exemplo).
export async function excluirDocumento(id, { desfazerVinculo = false } = {}) {
  const { data: doc, error: errBusca } = await supabase
    .from('documentos')
    .select('storage_path, obrigacao_id, etapa_obrigacao_id, tarefa_id')
    .eq('id', id)
    .single();
  if (errBusca) throw errBusca;
  if (desfazerVinculo) await desfazerBaixa(doc);
  if (doc?.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from('documentos').delete().eq('id', id);
  if (error) throw error;
}

// Troca o vínculo de um documento já confirmado (a IA errou o candidato,
// ou o usuário quer apontar pra outro) -- desfaz a baixa antiga (se
// houver) e aplica a nova via confirmarDocumento, mantendo o mesmo
// arquivo. candidatoNovo pode vir null (documento passa a não dar baixa
// em nada, só fica arquivado).
export async function reatribuirDocumento(documentoId, candidatoNovo) {
  const { data: doc, error: errBusca } = await supabase
    .from('documentos')
    .select('cliente_id, obrigacao_id, etapa_obrigacao_id, tarefa_id')
    .eq('id', documentoId)
    .single();
  if (errBusca) throw errBusca;
  await desfazerBaixa(doc);
  await confirmarDocumento(documentoId, { clienteId: doc.cliente_id, candidato: candidatoNovo });
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
