// documentosFiscaisApi.js
// Camada de dados das notas fiscais (entrada/saída) importadas da
// Omie/OneFlow — a sincronização em si roda no servidor (cron diário +
// botão manual, ver netlify/functions/documentos-fiscais-*.js e
// lib/oneflowFiscal.js); aqui é só leitura da tabela já sincronizada e o
// disparo do botão "Sincronizar agora".
import { supabase } from '../../lib/supabase';

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
