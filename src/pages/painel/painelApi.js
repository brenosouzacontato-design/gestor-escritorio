// painelApi.js
// Camada de dados do painel consolidado do cliente (link compartilhável,
// ver PainelClientePage.jsx) — obrigações/tarefas do mês, resumo
// financeiro e upload+extração da Declaração do Simples Nacional. A
// página pública não tem store/sessão, então tudo aqui é query direta via
// supabase (anon key, sem RLS — mesmo modelo do resto do app).
import { supabase } from '../../lib/supabase';
import { calcularDREPorConta } from '../contabil/contabilApi';

const BUCKET = 'documentos'; // mesmo bucket já criado pra anexos de documentos

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

// Sobe o PDF, chama a IA (netlify/functions/extrair-declaracao-simples.js)
// e grava/atualiza dados_gerenciais_simples pra competência identificada.
// Se a IA não conseguir identificar a competência, cai na competência
// informada (a que estava selecionada no Painel no momento do upload).
export async function uploadDeclaracaoSimples(clienteId, arquivo, competenciaFallback) {
  const path = `${crypto.randomUUID()}-${arquivo.name}`;
  const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo, {
    contentType: arquivo.type || 'application/pdf',
  });
  if (errUpload) throw errUpload;

  const pdfBase64 = await arquivoParaBase64(arquivo);
  const resp = await fetch('/.netlify/functions/extrair-declaracao-simples', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pdfBase64, filename: arquivo.name }),
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({}));
    throw new Error(erro.error || 'Falha ao extrair a declaração.');
  }
  const extraido = await resp.json();

  const competencia = extraido.competencia || competenciaFallback;
  const { data, error } = await supabase
    .from('dados_gerenciais_simples')
    .upsert({
      cliente_id: clienteId,
      competencia,
      faturamento_periodo: extraido.faturamentoPeriodo,
      rbt12: extraido.rbt12,
      aliquota_efetiva: extraido.aliquotaEfetiva,
      valor_das: extraido.valorDas,
      anexo: extraido.anexo,
      storage_path: path,
      observacao_ia: extraido.observacao,
    }, { onConflict: 'cliente_id,competencia' })
    .select()
    .single();
  if (error) throw error;
  return data;
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
