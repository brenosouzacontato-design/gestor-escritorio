// documentosFiscaisApi.js
// Camada de dados das notas fiscais (entrada/saída) importadas da
// Omie/OneFlow — a sincronização em si roda no servidor (cron diário +
// botão manual, ver netlify/functions/documentos-fiscais-*.js e
// lib/oneflowFiscal.js); aqui é leitura da tabela já sincronizada, o
// disparo do botão "Sincronizar agora" e a geração de lançamento contábil
// a partir de um documento.
import { supabase } from '../../lib/supabase';
import { listarContas, criarContaFilha, criarLancamento, listarRegrasClassificacao, encontrarRegraAplicavel, salvarRegraClassificacao } from './contabilApi';

export async function listarDocumentosFiscais({ competencia, clienteId, tipoMovimento } = {}) {
  let query = supabase
    .from('documentos_fiscais_erp')
    .select('*, clientes(nome)')
    .order('data_emissao', { ascending: false });
  if (competencia) query = query.eq('competencia', competencia);
  if (clienteId) query = query.eq('cliente_id', clienteId);
  if (tipoMovimento) query = query.eq('tipo_movimento', tipoMovimento);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function obterUltimaSincronizacao() {
  const { data, error } = await supabase
    .from('documentos_fiscais_erp')
    .select('sincronizado_em')
    .order('sincronizado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.sincronizado_em || null;
}

export async function sincronizarDocumentosFiscaisAgora() {
  const resp = await fetch('/.netlify/functions/documentos-fiscais-sincronizar', { method: 'POST' });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(body.error || 'Falha ao sincronizar.');
  return body;
}

// "MM/YYYY" -> inteiro comparável (ano*100+mes) — mesma conversão usada em
// painelApi.js pra ordenar competência-texto cronologicamente.
function competenciaOrdinal(c) {
  const [mes, ano] = c.split('/').map(Number);
  return ano * 100 + mes;
}

// Totais de entrada/saída por competência, de todas as empresas — alimenta
// o gráfico de evolução da visão geral. Só cobre as competências que já
// têm documento sincronizado (o cron só busca a atual + anterior, então o
// histórico cresce mês a mês a partir de quando isso foi ligado).
export async function obterEvolucaoMensal(meses = 6) {
  const { data, error } = await supabase
    .from('documentos_fiscais_erp')
    .select('competencia, tipo_movimento, valor_total');
  if (error) throw error;

  const porCompetencia = new Map();
  (data || []).forEach((d) => {
    if (!porCompetencia.has(d.competencia)) porCompetencia.set(d.competencia, { competencia: d.competencia, entrada: 0, saida: 0 });
    const g = porCompetencia.get(d.competencia);
    if (d.tipo_movimento === 'entrada') g.entrada += Number(d.valor_total || 0);
    else if (d.tipo_movimento === 'saida') g.saida += Number(d.valor_total || 0);
  });

  return [...porCompetencia.values()]
    .sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia))
    .slice(-meses);
}

// ---------- GERAR LANÇAMENTO A PARTIR DE UM DOCUMENTO ----------

// Acha a sub-conta do fornecedor dentro do grupo sintético "Fornecedores"
// (criado pela reformulação do plano de contas, ver
// scripts/reformular-plano-contas.cjs) — cria uma nova se ainda não
// existir uma com esse nome pra essa empresa. Reaproveita criarContaFilha
// (mesma lógica de numeração/hierarquia da tela Plano de Contas).
export async function obterOuCriarContaFornecedor(empresaId, nomeFornecedor) {
  const nome = (nomeFornecedor || 'Fornecedor não identificado').trim();
  const contas = await listarContas(empresaId);
  const grupoFornecedores = contas.find((c) => c.nome === 'Fornecedores' && !c.aceita_lancamento);
  if (!grupoFornecedores) {
    throw new Error('Grupo "Fornecedores" não encontrado no plano de contas dessa empresa — rode a reformulação do plano de contas primeiro.');
  }
  const nomeNormalizado = nome.toLowerCase();
  const existente = contas.find((c) => c.conta_pai_id === grupoFornecedores.id && c.nome.trim().toLowerCase() === nomeNormalizado);
  if (existente) return existente;
  return criarContaFilha(empresaId, nome, grupoFornecedores.id, false);
}

// Sugere a conta de débito com base nas regras de classificação já
// cadastradas (mesmo mecanismo usado na importação de extrato) — casa
// pelo nome do fornecedor/cliente do documento.
export async function sugerirContaDebito(empresaId, documento) {
  const regras = await listarRegrasClassificacao(empresaId);
  const regra = encontrarRegraAplicavel(documento.razao_social_terceiro || '', regras);
  return regra?.conta_id || null;
}

// Gera o lançamento (débito escolhido na tela, crédito sempre a sub-conta
// do fornecedor) e marca o documento como lançado — evita gerar de novo
// pro mesmo documento. Também grava/atualiza a regra de classificação
// pra sugerir sozinho da próxima vez que aparecer esse fornecedor.
export async function gerarLancamentoDeDocumento(documento, contaDebitoId) {
  const contaFornecedor = await obterOuCriarContaFornecedor(documento.cliente_id, documento.razao_social_terceiro);
  const historico = `${documento.razao_social_terceiro || 'Fornecedor'} — ${documento.modelo || 'Documento'} ${documento.numero || ''}`.trim();

  const lancamento = await criarLancamento({
    empresaId: documento.cliente_id,
    data: documento.data_emissao,
    historico,
    numeroDocumento: documento.numero,
    origem: 'manual',
    partidas: [
      { conta_id: contaDebitoId, tipo: 'debito', valor: documento.valor_total },
      { conta_id: contaFornecedor.id, tipo: 'credito', valor: documento.valor_total },
    ],
  });

  await salvarRegraClassificacao(documento.cliente_id, documento.razao_social_terceiro || '', contaDebitoId).catch(() => {});

  const { error } = await supabase
    .from('documentos_fiscais_erp')
    .update({ lancamento_id: lancamento.id })
    .eq('id', documento.id);
  if (error) throw error;

  return lancamento;
}
