// Dados que o Assessor lê do Supabase. Só leitura, sem tabela nova.
// Cada consulta falha em silêncio (lista vazia / null): uma tabela que
// ainda não existe no banco só desliga o alerta correspondente.

import { supabase, cabecalhosFunctions } from '../../lib/supabase'

async function seguro(promessa, padrao) {
  try {
    const { data, error } = await promessa
    if (error) { console.warn('assessor:', error.message); return padrao }
    return data ?? padrao
  } catch (e) {
    console.warn('assessor:', e?.message || e)
    return padrao
  }
}

export async function carregarDadosAssessor() {
  const desde = new Date(Date.now() - 60 * 86400000).toISOString()
  const [empresasNfse, obrigacoes, notas, eventosPainel] = await Promise.all([
    seguro(supabase.from('nfse_empresas')
      .select('cliente_id, ambiente, ativo, servico_padrao, cert_valido_ate, gabarito_xml'), []),
    seguro(supabase.from('obrigacoes')
      .select('id, cliente_id, status, vencimento, tipos_obrigacao(eh_imposto)')
      .in('status', ['pendente', 'vencido']), []),
    // sem nome/CPF do tomador: o Assessor só conta
    seguro(supabase.from('nfse_notas')
      .select('cliente_id, estado, status_validacao, criado_em')
      .eq('ambiente', 'producao')
      .in('estado', ['importada', 'validada', 'rejeitada', 'indeterminada'])
      .limit(2000), []),
    seguro(supabase.from('painel_eventos').select('cliente_id').gte('criado_em', desde).limit(5000), null),
  ])

  const obrigacoesAbertas = obrigacoes.map((o) => ({
    id: o.id, cliente_id: o.cliente_id, status: o.status, vencimento: o.vencimento,
    eh_imposto: !!o.tipos_obrigacao?.eh_imposto,
  }))

  // guias anexadas (documentos ligados às obrigações de imposto em aberto)
  const idsImposto = obrigacoesAbertas.filter((o) => o.eh_imposto).map((o) => o.id)
  const guiasAnexadas = new Set()
  for (let i = 0; i < idsImposto.length; i += 200) {
    const docs = await seguro(supabase.from('documentos').select('obrigacao_id').in('obrigacao_id', idsImposto.slice(i, i + 200)), [])
    for (const d of docs) guiasAnexadas.add(d.obrigacao_id)
  }

  return { empresasNfse, obrigacoesAbertas, guiasAnexadas, notas, eventosPainel }
}

export async function pedirResumoAssessor(resumo) {
  const resp = await fetch('/.netlify/functions/assessor-resumo', {
    method: 'POST',
    headers: await cabecalhosFunctions(),
    body: JSON.stringify({ resumo }),
  })
  const corpo = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(corpo.error || `Falha ao gerar o resumo (${resp.status}).`)
  return corpo
}
