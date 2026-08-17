// painelApi.js
// Camada de dados do painel consolidado do cliente (link compartilhável,
// ver PainelClientePage.jsx) — obrigações/tarefas do mês, resumo
// financeiro e upload+extração da Declaração do Simples Nacional. A
// página pública não tem store/sessão, então tudo aqui é query direta via
// supabase (anon key, sem RLS — mesmo modelo do resto do app).
import { supabase } from '../../lib/supabase';
import { calcularDREPorConta } from '../contabil/contabilApi';

const BUCKET = 'documentos'; // mesmo bucket já criado pra anexos de documentos

// "MM/YYYY" -> inteiro comparável (ano*100+mes) — competencia é texto, então
// comparação de string não ordena certo entre anos (ex: "09/2025" > "01/2026"
// como string). Usado tanto pro histórico de faturamento quanto pra achar
// pendências de competências anteriores.
function competenciaOrdinal(c) {
  const [mes, ano] = c.split('/').map(Number);
  return ano * 100 + mes;
}

// ---------- Obrigações / tarefas do mês ----------

export async function obterResumoObrigacoes(clienteId, competencia) {
  const { data, error } = await supabase
    .from('obrigacoes')
    .select('id, titulo, tipo, status, vencimento, departamento_id, departamentos(nome, icone)')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia);
  if (error) throw error;

  const ok = data.filter((o) => o.status === 'concluido' || o.status === 'nao_aplica').length;
  const vencido = data.filter((o) => o.status === 'vencido').length;
  const pendente = data.filter((o) => o.status === 'pendente').length;
  return { itens: data, total: data.length, ok, vencido, pendente };
}

export async function obterResumoTarefas(clienteId, competencia) {
  const { data, error } = await supabase
    .from('tarefas')
    .select('id, titulo, prioridade, vencimento, concluida, departamento')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia);
  if (error) throw error;

  const concluidas = data.filter((t) => t.concluida).length;
  return { itens: data, total: data.length, concluidas, pendentes: data.length - concluidas };
}

// ---------- Financeiro ----------

// ---------- Documentos do mês ----------

// Documentos confirmados daquele cliente enviados dentro do período —
// completa o "resumo de tudo que acontece com o cliente" no painel.
export async function obterDocumentosDoMes(clienteId, { dataInicio, dataFim }) {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, nome_arquivo, tipo_documento_sugerido, created_at')
    .eq('cliente_id', clienteId)
    .eq('status', 'confirmado')
    .gte('created_at', dataInicio)
    .lte('created_at', `${dataFim}T23:59:59`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Documentos confirmados vinculados a essas obrigações (pra oferecer o
// "baixar anexo" direto na lista de obrigações do painel) — indexado por
// obrigacao_id pra lookup rápido no render.
export async function obterDocumentosPorObrigacao(obrigacaoIds) {
  if (!obrigacaoIds || obrigacaoIds.length === 0) return {};
  const { data, error } = await supabase
    .from('documentos')
    .select('id, obrigacao_id, storage_path, nome_arquivo')
    .in('obrigacao_id', obrigacaoIds)
    .eq('status', 'confirmado');
  if (error) throw error;
  return Object.fromEntries(data.map((d) => [d.obrigacao_id, d]));
}

export async function obterResumoFinanceiro(clienteId, { dataInicio, dataFim }) {
  const [{ count: conciliados, error: errC }, { count: aConciliar, error: errA }, dre] = await Promise.all([
    supabase.from('lancamentos_contabeis').select('id', { count: 'exact', head: true })
      .eq('empresa_id', clienteId).eq('conciliado', true).gte('data', dataInicio).lte('data', dataFim),
    supabase.from('lancamentos_contabeis').select('id', { count: 'exact', head: true })
      .eq('empresa_id', clienteId).eq('conciliado', false).gte('data', dataInicio).lte('data', dataFim),
    calcularDREPorConta(clienteId, { dataInicio, dataFim }).catch(() => null),
  ]);
  if (errC) throw errC;
  if (errA) throw errA;
  return { conciliados: conciliados || 0, aConciliar: aConciliar || 0, resultado: dre?.resultado ?? null };
}

// ---------- Declaração do Simples ----------

async function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(arquivo);
  });
}

// Chave do Storage só com uuid + extensão — o nome original do arquivo
// (com acento/espaço/etc, ex: "Relatório Situação Fiscal GERALDO.pdf")
// não é uma "key" válida pro Supabase Storage ("Invalid key"). O nome
// legível não é exibido em lugar nenhum pra esses dois uploads (só os
// dados extraídos aparecem no painel), então não precisa ser preservado.
function chaveStorage(arquivo) {
  const ext = arquivo.name.includes('.') ? arquivo.name.split('.').pop() : 'pdf';
  return `${crypto.randomUUID()}.${ext}`;
}

// Sobe o PDF, chama a IA (netlify/functions/extrair-declaracao-simples.js)
// e grava/atualiza dados_gerenciais_simples pra competência identificada.
// Se a IA não conseguir identificar a competência, cai na competência
// informada (a que estava selecionada no Painel no momento do upload).
//
// A empresa vem de UMA das duas formas (nunca as duas):
//   { clienteId } — já sabida de antemão (upload de dentro do modal de
//     uma empresa aberta, ver Empresas.jsx).
//   { clientes } — lista [{id, nome, cnpj}] pra IA tentar identificar de
//     qual empresa é o documento (upload "detectar empresa" da topbar).
//     Lança erro se não conseguir identificar — nunca grava adivinhando.
export async function uploadDeclaracaoSimples(arquivo, competenciaFallback, { clienteId = null, clientes = null } = {}) {
  const path = chaveStorage(arquivo);
  const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo, {
    contentType: arquivo.type || 'application/pdf',
  });
  if (errUpload) throw errUpload;

  const pdfBase64 = await arquivoParaBase64(arquivo);
  const resp = await fetch('/.netlify/functions/extrair-declaracao-simples', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdfBase64, filename: arquivo.name, clientes: clienteId ? null : clientes }),
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao extrair a declaração.');
  }
  const extraido = await resp.json();

  const clienteFinal = clienteId || extraido.clienteId;
  if (!clienteFinal) {
    throw new Error('Não consegui identificar a empresa no documento — abra a empresa certa em Empresas e envie por lá.');
  }

  const competencia = extraido.competencia || competenciaFallback;
  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .upsert({
      cliente_id: clienteFinal,
      competencia,
      faturamento_periodo: extraido.faturamentoPeriodo,
      rbt12: extraido.rbt12,
      aliquota_efetiva: extraido.aliquotaEfetiva,
      valor_das: extraido.valorDas,
      anexo: extraido.anexo,
      receita_por_tipo: extraido.receitaPorTipo?.length > 0 ? extraido.receitaPorTipo : null,
      storage_path: path,
      observacao_ia: extraido.observacao,
    }, { onConflict: 'cliente_id,competencia' })
    .select()
    .single();
  if (error) throw error;

  const historicoPreenchido = extraido.historicoReceita?.length > 0
    ? await backfillHistoricoFaturamento(clienteFinal, competencia, extraido.historicoReceita).catch(() => 0)
    : 0;

  return { ...data, clienteDetectado: !clienteId, historicoPreenchido };
}

// Preenche automaticamente competências anteriores que ainda não têm
// registro, usando a tabela de receita mês a mês (RBT12) que já vem
// dentro da própria declaração — assim o gráfico de evolução do painel
// já nasce com histórico desde o primeiro envio, sem precisar perguntar
// se "é a primeira declaração". `ignoreDuplicates` garante que uma
// competência que já tem dados gravados (upload anterior, mais completo)
// nunca é sobrescrita por essa carga automática.
async function backfillHistoricoFaturamento(clienteId, competenciaAtual, historico) {
  const linhas = historico
    .filter((h) => h.competencia && h.competencia !== competenciaAtual && h.faturamento != null)
    .map((h) => ({
      cliente_id: clienteId,
      competencia: h.competencia,
      faturamento_periodo: h.faturamento,
      observacao_ia: `Preenchido automaticamente a partir do histórico de RBT12 da declaração de ${competenciaAtual}.`,
    }));
  if (linhas.length === 0) return 0;

  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .upsert(linhas, { onConflict: 'cliente_id,competencia', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data?.length || 0;
}

export async function obterDadosGerenciais(clienteId, competencia) {
  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Histórico do faturamento pra alimentar o gráfico de evolução no painel —
// uma competência por Declaração do Simples já enviada. "competencia" é
// texto "MM/YYYY", não dá pra ordenar direto no Postgres, então busca tudo
// e ordena no client convertendo pra ano*100+mes; mantém só os últimos 12
// pontos (mais recentes) pro gráfico não ficar espremido.
export async function obterHistoricoFaturamento(clienteId) {
  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .select('competencia, faturamento_periodo')
    .eq('cliente_id', clienteId)
    .not('faturamento_periodo', 'is', null);
  if (error) throw error;

  return (data || [])
    .sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia))
    .slice(-12);
}

// Obrigações e tarefas ainda pendentes/vencidas de competências ANTERIORES
// à selecionada — o painel é histórico: uma pendência não some só porque o
// mês virou, ela deve continuar visível até ser resolvida. Fica de fora do
// resumo/percentual da competência atual (obterResumoObrigacoes/Tarefas) de
// propósito, pra não distorcer o "% do mês" — mora numa seção à parte.
export async function obterPendenciasAnteriores(clienteId, competenciaAtual) {
  const ordAtual = competenciaOrdinal(competenciaAtual);
  const [{ data: obrigacoes, error: errObs }, { data: tarefas, error: errTar }] = await Promise.all([
    supabase
      .from('obrigacoes')
      .select('id, titulo, tipo, status, vencimento, competencia, departamento_id, departamentos(nome, icone)')
      .eq('cliente_id', clienteId)
      .in('status', ['pendente', 'vencido']),
    supabase
      .from('tarefas')
      .select('id, titulo, vencimento, departamento, competencia')
      .eq('cliente_id', clienteId)
      .eq('concluida', false),
  ]);
  if (errObs) throw errObs;
  if (errTar) throw errTar;

  return {
    obrigacoes: (obrigacoes || [])
      .filter((o) => o.competencia && competenciaOrdinal(o.competencia) < ordAtual)
      .sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia)),
    tarefas: (tarefas || [])
      .filter((t) => t.competencia && competenciaOrdinal(t.competencia) < ordAtual)
      .sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia)),
  };
}

// Valor do DAS das competências passadas que aparecem como pendência —
// obterPendenciasAnteriores não traz valor (obrigacoes não tem coluna de
// valor), então busca à parte em dados_gerenciais_simples pra quem já
// enviou a Declaração do Simples daquele mês. Indexado por competência
// pra lookup rápido no render; só entra quem tem valor_das preenchido.
export async function obterValoresDasPendencias(clienteId, competencias) {
  if (!competencias || competencias.length === 0) return {};
  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .select('competencia, valor_das')
    .eq('cliente_id', clienteId)
    .in('competencia', competencias);
  if (error) throw error;
  return Object.fromEntries((data || []).filter((d) => d.valor_das != null).map((d) => [d.competencia, d.valor_das]));
}

// ---------- Situação Fiscal (RFB) ----------

// Sobe o PDF, chama a IA (netlify/functions/extrair-situacao-fiscal.js) e
// grava/atualiza situacao_fiscal_rfb pra competência selecionada no
// Painel no momento do upload (o relatório não traz "competência" própria,
// é um retrato do momento — por isso não há fallback pra extrair do PDF
// aqui, diferente da Declaração do Simples).
//
// Mesma regra de origem da empresa que uploadDeclaracaoSimples: OU
// `clienteId` (já sabido) OU `clientes` (lista, pra IA detectar) — nunca
// os dois. Lança erro se não conseguir identificar via `clientes`.
export async function uploadSituacaoFiscal(arquivo, competencia, { clienteId = null, clientes = null } = {}) {
  const path = chaveStorage(arquivo);
  const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo, {
    contentType: arquivo.type || 'application/pdf',
  });
  if (errUpload) throw errUpload;

  const pdfBase64 = await arquivoParaBase64(arquivo);
  const resp = await fetch('/.netlify/functions/extrair-situacao-fiscal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdfBase64, filename: arquivo.name, clientes: clienteId ? null : clientes }),
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao extrair o relatório.');
  }
  const extraido = await resp.json();

  const clienteFinal = clienteId || extraido.clienteId;
  if (!clienteFinal) {
    throw new Error('Não consegui identificar a empresa no documento — abra a empresa certa em Empresas e envie por lá.');
  }

  const { data, error } = await supabase
    .from('situacao_fiscal_rfb')
    .upsert({
      cliente_id: clienteFinal,
      competencia,
      data_emissao: extraido.dataEmissao,
      situacao_geral: extraido.situacaoGeral,
      debitos: extraido.debitos,
      parcelamentos: extraido.parcelamentos,
      dividas_ativas: extraido.dividasAtivas,
      storage_path: path,
      observacao_ia: extraido.observacao,
    }, { onConflict: 'cliente_id,competencia' })
    .select()
    .single();
  if (error) throw error;
  return { ...data, clienteDetectado: !clienteId };
}

export async function obterSituacaoFiscal(clienteId, competencia) {
  const { data, error } = await supabase
    .from('situacao_fiscal_rfb')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- CND estadual/municipal (marcação manual) ----------

export async function obterCndManual(clienteId, competencia) {
  const { data, error } = await supabase
    .from('cnd_manual')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// anexoEstadual/anexoMunicipal (File, opcionais) — o PDF da própria
// certidão, guardado junto da marcação manual. Só entram no payload (e só
// sobem pro Storage) quando um arquivo novo é escolhido — sem isso, o
// upsert não mexe no anexo que já estava salvo (upsert do PostgREST só
// atualiza as colunas presentes no payload).
export async function salvarCndManual(clienteId, competencia, { situacaoEstadual, situacaoMunicipal, observacao, anexoEstadual, anexoMunicipal }) {
  const payload = {
    cliente_id: clienteId,
    competencia,
    situacao_estadual: situacaoEstadual || null,
    situacao_municipal: situacaoMunicipal || null,
    observacao: observacao || null,
    atualizado_em: new Date().toISOString(),
  };

  if (anexoEstadual) {
    const path = chaveStorage(anexoEstadual);
    const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, anexoEstadual, { contentType: anexoEstadual.type || 'application/pdf' });
    if (errUpload) throw errUpload;
    payload.anexo_estadual_path = path;
    payload.anexo_estadual_nome = anexoEstadual.name;
  }
  if (anexoMunicipal) {
    const path = chaveStorage(anexoMunicipal);
    const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, anexoMunicipal, { contentType: anexoMunicipal.type || 'application/pdf' });
    if (errUpload) throw errUpload;
    payload.anexo_municipal_path = path;
    payload.anexo_municipal_nome = anexoMunicipal.name;
  }

  const { data, error } = await supabase
    .from('cnd_manual')
    .upsert(payload, { onConflict: 'cliente_id,competencia' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
