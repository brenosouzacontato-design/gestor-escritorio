// relatorioDoDiaRegras.js
// Regras puras do mini relatório da aba da empresa (RelatorioDoDia.jsx): o que
// aconteceu na empresa hoje (ou nos últimos 7 dias) — NFS-e emitidas pelo
// gestor, notas de saída e de entrada sincronizadas do OneFlow
// (documentos_fiscais_erp), documentos recebidos, pagamentos confirmados,
// guias perto do vencimento e o que espera o escritório na NFS-e.
// Sem React nem banco: testado em src/lib/__tests__/relatorioDoDia.test.mjs.

export const PERIODOS = { hoje: 1, semana: 7 }
export const DIAS_GUIAS = 5 // guias que vencem nos próximos N dias
export const SYNC_ATRASADA_HORAS = 48 // o cron do OneFlow roda todo dia

const doisDig = (n) => String(n).padStart(2, '0')
export const isoLocal = (d) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`

// Janela do período no fuso do navegador: { inicio: 'AAAA-MM-DD', inicioTs: ISO da meia-noite local,
// hoje: 'AAAA-MM-DD', limiteGuias: 'AAAA-MM-DD' }
export function janelaRelatorio(periodo, agora = new Date()) {
  const dias = PERIODOS[periodo] || 1
  const ini = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1))
  const lim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + DIAS_GUIAS)
  return { inicio: isoLocal(ini), inicioTs: ini.toISOString(), hoje: isoLocal(agora), limiteGuias: isoLocal(lim) }
}

const soma = (itens, campo = 'valor') => itens.reduce((s, it) => s + (Number(it[campo]) || 0), 0)
const dataDe = (v) => (v ? isoLocal(new Date(v)) : null)
const soDigitos = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '')
const centavos = (v) => Math.round((Number(v) || 0) * 100)

// Nota do OneFlow que é a mesma NFS-e emitida pelo gestor (o OneFlow importa a nota do
// Ambiente Nacional): mesmo número e mesmo valor — não conta duas vezes.
function mesmaNota(erp, nfse) {
  return soDigitos(erp.numero) && soDigitos(erp.numero) === soDigitos(nfse.numero_nfse) && centavos(erp.valor_total) === centavos(nfse.valor)
}

// Entrada:
//   nfse: notas autorizadas do gestor [{ id, numero_nfse, valor, nome, atualizado_em }]
//   erp: documentos_fiscais_erp [{ id, tipo_movimento, numero, valor_total, data_emissao, razao_social_terceiro, situacao_documento }]
//   documentos: documentos da empresa [{ id, nome_arquivo, created_at, obrigacao_id, pago_em, valor_pago, valor_guia,
//               vencimento_guia, comprovante_path, baixa_manual, status }]
//   esperando: { pixRespondidos, notasProntas } | null (empresa sem NFS-e)
//   ultimaSync: ISO da última sincronização do OneFlow | null
export function montarRelatorio({ janela, nfse = [], erp = [], documentos = [], esperando = null, ultimaSync = null, agora = new Date() }) {
  const noPeriodo = (data) => !!data && data >= janela.inicio && data <= janela.hoje

  const emitidasGestor = nfse.filter((n) => noPeriodo(dataDe(n.atualizado_em)))
    .map((n) => ({ id: n.id, numero: n.numero_nfse, valor: Number(n.valor) || 0, quem: n.nome || '', data: dataDe(n.atualizado_em) }))

  const validoErp = (d) => !/cancel/i.test(d.situacao_documento || '')
  const doErp = (tipo) => erp.filter((d) => d.tipo_movimento === tipo && validoErp(d) && noPeriodo(String(d.data_emissao || '').slice(0, 10)))
  const saidasErp = doErp('saida').filter((d) => !nfse.some((n) => mesmaNota(d, n)))
    .map((d) => ({ id: d.id, numero: d.numero, valor: Number(d.valor_total) || 0, quem: d.razao_social_terceiro || '', data: String(d.data_emissao).slice(0, 10) }))
  const entradas = doErp('entrada')
    .map((d) => ({ id: d.id, numero: d.numero, valor: Number(d.valor_total) || 0, quem: d.razao_social_terceiro || '', data: String(d.data_emissao).slice(0, 10) }))

  const confirmados = documentos.filter((d) => !d.status || d.status === 'confirmado')
  const recebidos = confirmados.filter((d) => noPeriodo(dataDe(d.created_at)))
    .map((d) => ({ id: d.id, nome: d.nome_arquivo || 'documento', data: dataDe(d.created_at) }))
  const pagamentos = confirmados.filter((d) => d.obrigacao_id && noPeriodo(dataDe(d.pago_em)))
    .map((d) => ({ id: d.id, nome: d.nome_arquivo || 'guia', valor: Number(d.valor_pago ?? d.valor_guia) || 0, data: dataDe(d.pago_em),
      comprovante: !!d.comprovante_path, manual: !!d.baixa_manual || !d.comprovante_path }))
  const guiasAVencer = confirmados.filter((d) => d.obrigacao_id && !d.pago_em && d.vencimento_guia
    && d.vencimento_guia >= janela.hoje && d.vencimento_guia <= janela.limiteGuias)
    .map((d) => ({ id: d.id, nome: d.nome_arquivo || 'guia', valor: Number(d.valor_guia) || 0, vencimento: d.vencimento_guia }))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))

  const horasDesdeSync = ultimaSync ? (agora - new Date(ultimaSync)) / 3600000 : null
  return {
    emitidasGestor: { itens: emitidasGestor, valor: soma(emitidasGestor) },
    saidasErp: { itens: saidasErp, valor: soma(saidasErp) },
    entradas: { itens: entradas, valor: soma(entradas) },
    recebidos: { itens: recebidos },
    pagamentos: { itens: pagamentos, valor: soma(pagamentos) },
    guiasAVencer: { itens: guiasAVencer, valor: soma(guiasAVencer) },
    esperando: esperando && (esperando.pixRespondidos || esperando.notasProntas) ? esperando : null,
    sync: { em: ultimaSync, atrasada: horasDesdeSync == null || horasDesdeSync > SYNC_ATRASADA_HORAS },
  }
}
