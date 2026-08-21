// netlify/functions/lib/oneflowFiscal.js
//
// Sincroniza documentos fiscais (NF-e/NFS-e de entrada e saída) da
// Omie/OneFlow pra dentro do Gestor — usado pelo cron diário
// (documentos-fiscais-cron.js) e pelo botão "Sincronizar agora"
// (documentos-fiscais-sincronizar.js).
//
// Diferente do restante da integração OneFlow (src/lib/oneflow.js, que só
// roda no navegador via oneflow-proxy.js por causa de CORS), aqui roda
// direto no servidor — uma Netlify Function chama a API da Omie sem
// precisar de proxy.

const OMIE_BASE = 'https://app.omie.com.br/api/portal'
const ONEFLOW_BASE = 'https://rest.oneflow.com.br/api/oneflow'

async function chamar(url, token) {
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  })
  const texto = await resp.text()
  let json
  try { json = JSON.parse(texto) } catch { json = { erro: texto.slice(0, 300) } }
  if (!resp.ok) {
    const msg = json?.details?.message?.message || json?.message || texto.slice(0, 200)
    throw new Error(`Omie/OneFlow respondeu ${resp.status}: ${msg}`)
  }
  return json
}

// Renova o token de uma empresa específica usando o token de sessão do
// escritório (of_user_token, salvo em `configuracoes` quando alguém loga
// no modal "Configure o token OneFlow") — mesma chamada que o botão
// "Sincronizar" do FechamentosERP.jsx faz no navegador, só que do servidor.
async function renovarTokenEmpresa(appHash, userToken) {
  const r = await chamar(`${OMIE_BASE}/apps/${appHash}/token/`, userToken)
  return r.token
}

// "17/07/2026" -> "2026-07-17" (formato date do Postgres); null se vazio.
function dataBrParaIso(dataBr) {
  if (!dataBr) return null
  const [d, m, a] = dataBr.split('/')
  if (!d || !m || !a) return null
  return `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

// NF-e usa "Entrada"/"Saída"; NFS-e usa um vocabulário diferente pro mesmo
// conceito: "Tomado" (serviço tomado = entrada) / "Prestado" (serviço
// prestado = saída).
function normalizarMovimento(tipoMovimento) {
  const v = (tipoMovimento || '').toLowerCase()
  if (v.startsWith('entr') || v.startsWith('tomad')) return 'entrada'
  if (v.startsWith('sa') || v.startsWith('prest')) return 'saida'
  return null
}

// "07/2026" -> "202607" — o resto do app usa MM/YYYY (mesmo formato que a
// própria API devolve no campo `competencia` de cada documento), mas o
// PARÂMETRO de consulta desse endpoint espera AAAAMM (documentado assim no
// Swagger). Passar MM/YYYY não dá erro nenhum — só devolve lista vazia
// silenciosamente, o que é bem mais traiçoeiro que um 400.
function competenciaParaAAAAMM(competencia) {
  const [mes, ano] = competencia.split('/')
  return `${ano}${mes}`
}

// Busca todas as páginas de documentos fiscais escriturados numa
// competência — a API pagina, mas não documenta um jeito confiável de
// saber quando parar, então segue lendo até vir uma página vazia.
async function buscarDocumentosFiscais(token, competencia) {
  const competenciaApi = competenciaParaAAAAMM(competencia)
  let todos = []
  let pagina = 1
  while (pagina <= 50) { // trava de segurança — nunca deve chegar perto disso
    const r = await chamar(`${ONEFLOW_BASE}/empresa/fiscal/documentos/listar?competencia=${competenciaApi}&pagina=${pagina}`, token)
    const documentos = r.result?.documentos || []
    if (documentos.length === 0) break
    todos = todos.concat(documentos)
    pagina++
  }
  return todos
}

// Sincroniza os documentos fiscais de UM cliente pra UMA competência —
// upsert por (cliente_id, modelo, numero, serie), então reprocessar não
// duplica nem perde o que já tinha sido escriturado antes.
async function sincronizarDocumentosCliente(supabase, cliente, token, competencia) {
  const documentos = await buscarDocumentosFiscais(token, competencia)
  if (documentos.length === 0) return 0

  const linhas = documentos.map((d) => ({
    cliente_id: cliente.id,
    competencia: d.competencia || competencia,
    modelo: d.modelo || null,
    tipo_movimento: normalizarMovimento(d.tipoMovimento),
    numero: d.numero || null,
    // NFS-e não tem "série" (vem "" da API) — NUNCA grava null aqui: o
    // índice único (cliente_id, modelo, numero, serie) não deduplica linhas
    // com serie null (regra do SQL, NULL não é igual a NULL), então cada
    // sincronização criava uma cópia nova da mesma NFS-e em vez de
    // atualizar a existente.
    serie: d.serie || '',
    cnpj_cpf_terceiro: d.documentoClienteFornecedor || null,
    razao_social_terceiro: d.razaoSocialClienteFornecedor || null,
    data_emissao: dataBrParaIso(d.dataEmissao),
    data_escrituracao: dataBrParaIso(d.dataEscrituracao),
    valor_total: d.valorTotal ?? null,
    situacao_documento: d.situacaoDocumento || null,
    situacao_apuracao: d.situacaoApuracao || null,
    origem: d.origem || null,
    tipo_emissao: d.tipoEmissao || null,
    alerta: !!d.alerta,
    erro: !!d.erro,
    dados: d,
    sincronizado_em: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('documentos_fiscais_erp')
    .upsert(linhas, { onConflict: 'cliente_id,modelo,numero,serie' })
  if (error) throw error
  return linhas.length
}

// Passa por todos os clientes vinculados ao OneFlow e sincroniza cada um
// pras competências informadas — usado tanto pelo cron quanto pelo botão
// manual. Erro num cliente não derruba os outros (ex: token individual
// que falhou renovar) — cada um fica registrado em `erros`.
async function sincronizarTodosClientes(supabase, userToken, competencias) {
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('id, nome, oneflow_app_hash')
    .eq('ativo', true)
    .not('oneflow_app_hash', 'is', null)
  if (error) throw error

  let sincronizados = 0
  const erros = []
  for (const cliente of clientes || []) {
    try {
      const token = await renovarTokenEmpresa(cliente.oneflow_app_hash, userToken)
      for (const competencia of competencias) {
        await sincronizarDocumentosCliente(supabase, cliente, token, competencia)
      }
      sincronizados++
    } catch (e) {
      erros.push({ cliente: cliente.nome, erro: e.message })
    }
  }
  return { sincronizados, total: (clientes || []).length, erros }
}

function competenciaAtual() {
  const d = new Date()
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
function competenciaAnterior() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

module.exports = {
  renovarTokenEmpresa, buscarDocumentosFiscais, sincronizarDocumentosCliente, sincronizarTodosClientes,
  dataBrParaIso, normalizarMovimento, competenciaAtual, competenciaAnterior,
}
