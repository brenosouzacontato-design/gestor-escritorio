// pagamentosApi.js
// Camada de dados da tela Pagamentos (PagamentosPage.jsx) — baixa das guias
// de imposto anexadas, a partir dos comprovantes que chegam pelo grupo
// "Pagamentos" do WhatsApp (fila comprovantes_pagamento, alimentada por
// netlify/functions/lib/comprovantePagamento.js) ou na mão, com
// justificativa. Schema: supabase-schema-comprovantes-pagamento.sql.
import { supabase } from '../../lib/supabase';

const BUCKET = 'documentos';

// Mesmo critério de "é imposto" do painel e do webhook — anexo de obrigação
// que não é imposto (ex: holerites) não é guia a pagar.
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i;

// Tolerância de valor igual à da baixa automática (lib/comprovantePagamento.js):
// igual (centavos) ou até 30% maior (multa e juros de quem pagou atrasado).
export function valorCompativel(valorPago, valorGuia) {
  if (valorPago == null || valorGuia == null) return true;
  return valorPago >= valorGuia - 0.05 && valorPago <= valorGuia * 1.3;
}

// "Tabela/coluna ainda não existe" — schema novo não aplicado.
export function faltaSchema(e) {
  return /comprovantes_pagamento|baixa_justificativa|baixa_manual|baixa_por|baixa_registrada_em/.test(e?.message || '')
    || ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(e?.code);
}

async function emailUsuario() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email || 'escritório';
}

// ---------- Fila de comprovantes ----------

export async function listarComprovantes(status) {
  const { data, error } = await supabase
    .from('comprovantes_pagamento')
    .select('*, clientes(nome, cnpj)')
    .eq('status', status)
    .order('criado_em', { ascending: false })
    .limit(status === 'pendente' ? 200 : 100);
  if (error) throw error;
  return data || [];
}

export async function contarComprovantesPendentes() {
  const { count, error } = await supabase
    .from('comprovantes_pagamento')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pendente');
  if (error) throw error;
  return count || 0;
}

// Guias de imposto anexadas da empresa que ainda não têm pagamento — as
// únicas opções de baixa depois que a empresa é escolhida.
export async function listarGuiasPendentes(clienteId) {
  if (!clienteId) return [];
  const { data, error } = await supabase
    .from('documentos')
    .select('id, nome_arquivo, storage_path, valor_guia, vencimento_guia, created_at, obrigacoes!inner(titulo, tipo, competencia, vencimento, cliente_id)')
    .eq('status', 'confirmado')
    .eq('obrigacoes.cliente_id', clienteId)
    .not('obrigacao_id', 'is', null)
    .is('pago_em', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || [])
    .filter((d) => TITULO_IMPOSTO.test(`${d.obrigacoes.titulo || ''} ${d.obrigacoes.tipo || ''}`))
    .map((d) => ({
      id: d.id,
      titulo: d.obrigacoes.titulo || d.obrigacoes.tipo,
      competencia: d.obrigacoes.competencia || null,
      valor: d.valor_guia != null ? Number(d.valor_guia) : null,
      vencimento: d.vencimento_guia || d.obrigacoes.vencimento || null,
      storagePath: d.storage_path,
      nomeArquivo: d.nome_arquivo,
    }))
    .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
}

// Baixa da guia com o comprovante da fila: a guia fica paga com o comprovante
// disponível no painel do cliente (mesmo resultado da baixa automática).
// `justificativa` é obrigatória na tela quando o valor não bate com a guia.
export async function darBaixaComComprovante(comprovante, guiaId, { justificativa = null, clienteId = null } = {}) {
  const por = await emailUsuario();
  const agora = new Date().toISOString();
  const { data: guiaAtualizada, error: errGuia } = await supabase
    .from('documentos')
    .update({
      pago_em: comprovante.data_pagamento ? `${comprovante.data_pagamento}T12:00:00Z` : agora,
      valor_pago: comprovante.valor_pago,
      comprovante_path: comprovante.storage_path,
      comprovante_nome: comprovante.nome_arquivo,
      baixa_manual: false,
      baixa_justificativa: justificativa || null,
      baixa_por: por,
      baixa_registrada_em: agora,
    })
    .eq('id', guiaId)
    .is('pago_em', null)
    .select('id');
  if (errGuia) throw errGuia;
  if (!guiaAtualizada?.length) throw new Error('Essa guia já recebeu baixa — atualize a lista.');

  const { error } = await supabase
    .from('comprovantes_pagamento')
    .update({
      status: 'baixado', guia_id: guiaId, cliente_id: clienteId || comprovante.cliente_id,
      justificativa: justificativa || null, resolvido_por: por, resolvido_em: agora,
    })
    .eq('id', comprovante.id);
  if (error) throw error;
}

export async function descartarComprovante(comprovanteId, motivo) {
  const { error } = await supabase
    .from('comprovantes_pagamento')
    .update({ status: 'descartado', motivo_descarte: motivo, resolvido_por: await emailUsuario(), resolvido_em: new Date().toISOString() })
    .eq('id', comprovanteId);
  if (error) throw error;
}

// Volta um comprovante descartado pra fila.
export async function reabrirComprovante(comprovanteId) {
  const { error } = await supabase
    .from('comprovantes_pagamento')
    .update({ status: 'pendente', motivo_descarte: null, resolvido_por: null, resolvido_em: null })
    .eq('id', comprovanteId);
  if (error) throw error;
}

// ---------- Baixa manual (sem comprovante da fila) ----------

// Justificativa obrigatória. `arquivo` (opcional) é um comprovante que o
// escritório tem em mãos — sobe pro Storage e fica disponível no painel.
export async function darBaixaManual({ guiaId, dataPagamento, valorPago, justificativa, arquivo = null }) {
  if (!justificativa?.trim()) throw new Error('Informe a justificativa da baixa manual.');
  let comprovante = {};
  if (arquivo) {
    const ext = arquivo.name.includes('.') ? arquivo.name.split('.').pop() : 'pdf';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: arquivo.type || 'application/pdf' });
    if (errUpload) throw errUpload;
    comprovante = { comprovante_path: path, comprovante_nome: arquivo.name };
  }
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from('documentos')
    .update({
      pago_em: dataPagamento ? `${dataPagamento}T12:00:00Z` : agora,
      valor_pago: valorPago ?? null,
      ...comprovante,
      baixa_manual: true,
      baixa_justificativa: justificativa.trim(),
      baixa_por: await emailUsuario(),
      baixa_registrada_em: agora,
    })
    .eq('id', guiaId)
    .is('pago_em', null)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Essa guia já recebeu baixa — atualize a lista.');
}

// ---------- Baixas feitas (histórico) ----------

export async function listarBaixas({ limite = 150 } = {}) {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, pago_em, valor_pago, valor_guia, comprovante_path, comprovante_nome, baixa_manual, baixa_justificativa, baixa_por, baixa_registrada_em, obrigacoes!inner(titulo, tipo, competencia, cliente_id, clientes(nome))')
    .not('pago_em', 'is', null)
    .order('pago_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return (data || []).map((d) => ({
    id: d.id,
    clienteId: d.obrigacoes.cliente_id,
    clienteNome: d.obrigacoes.clientes?.nome || '—',
    titulo: d.obrigacoes.titulo || d.obrigacoes.tipo,
    competencia: d.obrigacoes.competencia,
    pagoEm: d.pago_em,
    valorPago: d.valor_pago != null ? Number(d.valor_pago) : null,
    valorGuia: d.valor_guia != null ? Number(d.valor_guia) : null,
    comprovantePath: d.comprovante_path,
    comprovanteNome: d.comprovante_nome,
    manual: !!d.baixa_manual,
    justificativa: d.baixa_justificativa,
    por: d.baixa_por,
    registradaEm: d.baixa_registrada_em,
  }));
}

// Desfaz a baixa da guia. Se ela veio de um comprovante da fila, o
// comprovante volta pra fila (pendente) pra ser conferido de novo; o arquivo
// do comprovante continua no Storage, ligado à fila.
export async function desfazerBaixa(guiaId) {
  const { data: comps, error: errComps } = await supabase
    .from('comprovantes_pagamento')
    .select('id')
    .eq('guia_id', guiaId)
    .eq('status', 'baixado');
  if (errComps && !faltaSchema(errComps)) throw errComps;

  const { error } = await supabase
    .from('documentos')
    .update({
      pago_em: null, valor_pago: null, comprovante_path: null, comprovante_nome: null,
      baixa_manual: false, baixa_justificativa: null, baixa_por: null, baixa_registrada_em: null,
    })
    .eq('id', guiaId);
  if (error) throw error;

  if (comps?.length) {
    const { error: errFila } = await supabase
      .from('comprovantes_pagamento')
      .update({ status: 'pendente', guia_id: null, baixa_automatica: false, justificativa: null, resolvido_por: null, resolvido_em: null })
      .in('id', comps.map((c) => c.id));
    if (errFila) throw errFila;
  }
}
