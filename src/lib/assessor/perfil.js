// Características de cada cliente que o Assessor usa: regime, atividade
// (pelo código de serviço da NFS-e) e município.

// 'SN' | 'MEI' | 'LP' | 'LR' | null
export function siglaRegime(regime) {
  const r = String(regime || '').toLowerCase()
  if (!r) return null
  if (r.includes('mei')) return 'MEI'
  if (r.includes('simples')) return 'SN'
  if (r.includes('presumido')) return 'LP'
  if (r.includes('real')) return 'LR'
  return null
}

// opSimpNac do XML de gabarito (1 = não optante, 2 = MEI, 3 = ME/EPP).
export function opSimplesDoGabarito(xml) {
  const m = /<opSimpNac>\s*(\d)\s*<\/opSimpNac>/.exec(String(xml || ''))
  return m ? m[1] : null
}

// Item da lista de serviços (LC 116) pelo cTribNac ("IISSDD" -> "II.SS").
export function itemServico(cTribNac) {
  const c = String(cTribNac || '').replace(/\D/g, '')
  if (c.length < 4) return null
  return `${Number(c.slice(0, 2))}.${c.slice(2, 4)}`
}

// Itens de profissões intelectuais regulamentadas mais comuns no escritório.
const REGULAMENTADAS = {
  '7.01': 'engenharia/arquitetura',
  '17.14': 'advocacia',
  '17.15': 'auditoria',
  '17.19': 'contabilidade',
  '17.20': 'consultoria econômica',
}

// 'saude' | 'regulamentada' | null
export function grupoAtividade(cTribNac) {
  const item = itemServico(cTribNac)
  if (!item) return null
  if (item.startsWith('4.')) return 'saude'
  if (REGULAMENTADAS[item]) return 'regulamentada'
  return null
}

// Perfil consolidado por cliente: junta o cadastro e a configuração da NFS-e.
export function perfilCliente(cliente, empresaNfse) {
  const opSimp = opSimplesDoGabarito(empresaNfse?.gabarito_xml)
  let regime = siglaRegime(cliente?.regime)
  if (opSimp === '2') regime = 'MEI'
  else if (opSimp === '3' && !regime) regime = 'SN'
  const sp = empresaNfse?.servico_padrao || {}
  return {
    id: cliente.id,
    nome: cliente.nome,
    regime,
    municipio: (cliente.municipio || '').trim() || null,
    dataAbertura: cliente.data_abertura || null,
    atividade: grupoAtividade(sp.cTribNac),
    itemServico: itemServico(sp.cTribNac),
    nfse: empresaNfse ? {
      ambiente: empresaNfse.ambiente,
      ativo: empresaNfse.ativo !== false,
      certValidoAte: empresaNfse.cert_valido_ate || null,
      faltaIbsCbs: !sp.cIndOp || !sp.CST || !sp.cClassTrib,
      faltaSimples: (opSimp === '3' || opSimp === '4' || regime === 'SN') && (!sp.regApIBSCBSSN || !sp.cAtvSN),
      regApIBSCBSSN: sp.regApIBSCBSSN || null,
    } : null,
  }
}
