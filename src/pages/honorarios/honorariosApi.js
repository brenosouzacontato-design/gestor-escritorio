// honorariosApi.js
// Camada de dados do módulo de Honorários — cobrança mensal recorrente por
// cliente, com lembrete automático de WhatsApp direto pro celular do
// cliente (não pro grupo interno, diferente de lembretes.js) trazendo a
// chave PIX do escritório.
import { supabase } from '../../lib/supabase';

// "MM/YYYY" -> data do vencimento daquele mês, no dia configurado (ou 10
// como padrão quando o cliente ainda não tem um dia escolhido).
function calcularVencimento(competencia, diaVencimento) {
  const [mes, ano] = competencia.split('/').map(Number);
  const dia = diaVencimento || 10;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// ---------- Honorários do mês ----------

export async function listarHonorariosDoMes(competencia) {
  const { data, error } = await supabase
    .from('honorarios')
    .select('*, clientes(nome, telefone)')
    .eq('competencia', competencia)
    .order('vencimento');
  if (error) throw error;
  return data;
}

// Clientes com cobrança configurada (valor_honorario preenchido) — usados
// tanto pra saber quem entra na geração automática do mês quanto pra
// mostrar na tela quem ainda não tem honorário configurado.
export async function listarClientesConfigurados() {
  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, telefone, valor_honorario, dia_vencimento_honorario')
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  return data;
}

// Cria a cobrança da competência pra cada cliente com valor_honorario
// configurado que ainda não tem uma linha nesse mês — ignora quem já tem
// (não sobrescreve status já marcado como pago, nem redefine o valor de
// quem já foi cobrado manualmente com outro valor naquele mês).
export async function gerarHonorariosDoMes(competencia) {
  const { data: clientes, error: errClientes } = await supabase
    .from('clientes')
    .select('id, valor_honorario, dia_vencimento_honorario')
    .eq('ativo', true)
    .not('valor_honorario', 'is', null);
  if (errClientes) throw errClientes;
  if (!clientes || clientes.length === 0) return 0;

  const linhas = clientes.map((c) => ({
    cliente_id: c.id,
    competencia,
    valor: c.valor_honorario,
    vencimento: calcularVencimento(competencia, c.dia_vencimento_honorario),
  }));

  const { data, error } = await supabase
    .from('honorarios')
    .upsert(linhas, { onConflict: 'cliente_id,competencia', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data?.length || 0;
}

export async function marcarStatusHonorario(honorarioId, status) {
  const { error } = await supabase
    .from('honorarios')
    .update({ status, data_pagamento: status === 'pago' ? new Date().toISOString().slice(0, 10) : null })
    .eq('id', honorarioId);
  if (error) throw error;
}

export async function atualizarHonorario(honorarioId, { valor, vencimento }) {
  const { error } = await supabase.from('honorarios').update({ valor, vencimento }).eq('id', honorarioId);
  if (error) throw error;
}

export async function atualizarConfigCliente(clienteId, { valorHonorario, diaVencimento }) {
  const { error } = await supabase
    .from('clientes')
    .update({ valor_honorario: valorHonorario, dia_vencimento_honorario: diaVencimento || null })
    .eq('id', clienteId);
  if (error) throw error;
}

// ---------- Configuração da chave PIX (tabela configuracoes, chave/valor) ----------

export async function obterConfigPix() {
  const { data, error } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', ['honorarios_pix_chave', 'honorarios_pix_favorecido']);
  if (error) throw error;
  const porChave = Object.fromEntries((data || []).map((r) => [r.chave, r.valor]));
  return { chavePix: porChave.honorarios_pix_chave || '', favorecido: porChave.honorarios_pix_favorecido || '' };
}

export async function salvarConfigPix({ chavePix, favorecido }) {
  const { error } = await supabase.from('configuracoes').upsert([
    { chave: 'honorarios_pix_chave', valor: chavePix || null },
    { chave: 'honorarios_pix_favorecido', valor: favorecido || null },
  ], { onConflict: 'chave' });
  if (error) throw error;
}

// ---------- Envio manual do lembrete (fora do cron) ----------

export async function enviarLembreteAgora(honorarioId) {
  const resp = await fetch('/.netlify/functions/honorarios-enviar-lembrete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ honorarioId }),
  });
  const resultado = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(resultado.error || 'Falha ao enviar o lembrete.');
  return resultado;
}
