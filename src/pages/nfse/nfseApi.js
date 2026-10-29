import { supabase } from '../../lib/supabase'

// Escrita: sempre pela function nfse (servidor aplica estados, numeração e duplicidade).
export async function chamarNfse(acao, dados = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session && data.session.access_token
  if (!token) throw new Error('Sessão expirada. Entre de novo no gestor.')
  const r = await fetch('/.netlify/functions/nfse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ acao, ...dados }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`)
  return corpo
}

// Leitura: direto do Supabase (RLS libera só leitura para o usuário logado).
const CAMPOS_NOTA = 'id,lote_id,estado,status_validacao,pendencias,erros,avisos,nome,cpf,endereco,cep,data,competencia,valor,' +
  'descricao,autor,data_mensagem,texto_original,observacao_cliente,serie,n_dps,chave_acesso,numero_nfse,mensagem_sefin,copiada_para,criado_em'

export async function listarLotes(clienteId, ambiente) {
  const { data, error } = await supabase.from('nfse_lotes').select('*')
    .eq('cliente_id', clienteId).eq('ambiente', ambiente).order('criado_em', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  return data || []
}

// duplicidade_liberada / ciente_em: supabase-schema-nfse-conferencia.sql (sem ele, lê sem as duas)
export async function listarNotas(loteId) {
  const ler = (campos) => supabase.from('nfse_notas').select(campos).eq('lote_id', loteId).order('criado_em').order('id')
  let { data, error } = await ler(`${CAMPOS_NOTA},duplicidade_liberada,ciente_em`)
  if (error && /duplicidade_liberada|ciente_em|column/i.test(error.message || '')) ({ data, error } = await ler(CAMPOS_NOTA))
  if (error) throw new Error(error.message)
  return data || []
}

// Cadastro de clientes do prestador (tomadores)
export async function listarTomadores(clienteId) {
  const { data, error } = await supabase.from('nfse_tomadores').select('*').eq('cliente_id', clienteId).order('nome')
  if (error) throw new Error(error.message)
  return data || []
}

export async function baixarXml(notaId, campo) {
  const { data, error } = await supabase.from('nfse_notas').select(`${campo}, chave_acesso, id_dps`).eq('id', notaId).single()
  if (error) throw new Error(error.message)
  const xml = data[campo]
  if (!xml) throw new Error('XML ainda não disponível')
  const nome = campo === 'xml_retorno' ? `${data.chave_acesso}-nfse.xml` : `${data.id_dps}-dps.xml`
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

export function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(String(leitor.result).split(',')[1])
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo'))
    leitor.readAsDataURL(arquivo)
  })
}

// Totais do lote: rejeitada refeita em cópia não conta duas vezes.
export function totais(notas) {
  let servico = 0
  let emitido = 0
  for (const n of notas) {
    if (n.copiada_para || n.valor === null || n.estado === 'cancelada') continue
    if ((n.erros || []).some((e) => e.startsWith('Já emitida:'))) continue // emitida antes, em outra nota
    const c = Math.round(Number(n.valor) * 100)
    servico += c
    if (n.estado === 'autorizada') emitido += c
  }
  return { servico: servico / 100, emitido: emitido / 100, faltando: (servico - emitido) / 100 }
}
