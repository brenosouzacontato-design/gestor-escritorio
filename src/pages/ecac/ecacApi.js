// ecacApi.js
// Dados da tela Fiscal → Situação e-CAC (EcacPage.jsx). Quem alimenta é o
// robô do servidor 24h (deploy/robo-parcelamentos/ecac.py): situação fiscal
// em situacao_fiscal_rfb (mesma tabela do upload manual), status por empresa
// em ecac_empresas e pagamentos achados em ecac_pagamentos — os que bateram
// com uma guia já deram baixa nela (documentos.pago_em, baixa_por = 'robô e-CAC').
// Schema: supabase-schema-ecac.sql.
import { supabase } from '../../lib/supabase';

const BUCKET = 'documentos';
export const DIAS_PAGAMENTOS = 120;

// "Tabela ainda não existe" — supabase-schema-ecac.sql não aplicado.
export function faltaSchema(e) {
  return /ecac_empresas|ecac_pagamentos/.test(e?.message || '') || ['42P01', 'PGRST205'].includes(e?.code);
}

const ordinal = (c) => {
  const [m, a] = String(c || '').split('/').map(Number);
  return (a || 0) * 100 + (m || 0);
};

const soma = (lista) => (Array.isArray(lista) ? lista.reduce((s, i) => s + (Number(i?.valor) || 0), 0) : 0);

// Uma linha por empresa ativa: último relatório de situação fiscal, status do
// robô e pagamentos dos últimos DIAS_PAGAMENTOS dias.
export async function listarSituacaoEcac(clientes) {
  const desde = new Date(Date.now() - DIAS_PAGAMENTOS * 86400000).toISOString().slice(0, 10);
  const [empresas, situacoes, pagamentos] = await Promise.all([
    supabase.from('ecac_empresas').select('*'),
    supabase.from('situacao_fiscal_rfb')
      .select('cliente_id, competencia, data_emissao, situacao_geral, debitos, parcelamentos, dividas_ativas, storage_path, observacao_ia, created_at'),
    supabase.from('ecac_pagamentos')
      .select('*, guia:documentos(id, nome_arquivo, storage_path, obrigacoes(titulo, tipo, competencia))')
      .gte('data_arrecadacao', desde)
      .order('data_arrecadacao', { ascending: false }),
  ]);
  for (const r of [empresas, situacoes, pagamentos]) if (r.error) throw r.error;

  const statusPor = new Map((empresas.data || []).map((e) => [e.cliente_id, e]));
  const situacaoPor = new Map();
  for (const s of situacoes.data || []) {
    const atual = situacaoPor.get(s.cliente_id);
    const maisNova = !atual
      || ordinal(s.competencia) > ordinal(atual.competencia)
      || (ordinal(s.competencia) === ordinal(atual.competencia) && (s.created_at || '') > (atual.created_at || ''));
    if (maisNova) situacaoPor.set(s.cliente_id, s);
  }
  const pagamentosPor = new Map();
  for (const p of pagamentos.data || []) {
    if (!pagamentosPor.has(p.cliente_id)) pagamentosPor.set(p.cliente_id, []);
    pagamentosPor.get(p.cliente_id).push(p);
  }

  return (clientes || []).map((c) => {
    const situacao = situacaoPor.get(c.id) || null;
    const pags = pagamentosPor.get(c.id) || [];
    const ecac = statusPor.get(c.id) || null;
    const cnpj = String(c.cnpj || '').replace(/\D/g, '');
    return {
      id: c.id,
      nome: c.nome,
      cnpj,
      temCnpj: cnpj.length === 14,
      monitorar: ecac ? ecac.monitorar !== false : true,
      ecac,
      situacao,
      totalDebitos: situacao ? soma(situacao.debitos) : 0,
      totalDividaAtiva: situacao ? soma(situacao.dividas_ativas) : 0,
      qtdParcelamentos: Array.isArray(situacao?.parcelamentos) ? situacao.parcelamentos.length : 0,
      pagamentos: pags,
      pagamentosSemGuia: pags.filter((p) => !p.guia_id).length,
    };
  });
}

export async function definirMonitorar(clienteId, monitorar) {
  const { error } = await supabase.from('ecac_empresas')
    .upsert({ cliente_id: clienteId, monitorar, atualizado_em: new Date().toISOString() }, { onConflict: 'cliente_id' });
  if (error) throw error;
}

export async function urlArquivo(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}
