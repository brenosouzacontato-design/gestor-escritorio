// netlify/functions/painel-nfse.js
//
// Notas fiscais de serviço emitidas pelo gestor, para o painel do cliente acompanhar e baixar.
//   POST { acao: 'listar', competencia?: 'MM/AAAA', cliente_id? }
//        → { notas: [{ id, numero, chave, competencia, emitidaEm, tomador, valor, descricao, ambiente }] }
//   POST { acao: 'pdf', nota_id, cliente_id? }   → o DANFSe em PDF (lib/nfse/danfse, NT 008/2026)
//   POST { acao: 'xml', nota_id, cliente_id? }   → o XML da NFS-e autorizada (o documento com validade)
//   POST { acao: 'pendentes', cliente_id? }       → notas ainda não emitidas, com o que falta preencher
//   POST { acao: 'completar', nota_id, cpf?, nome?, descricao?, data?, endereco?, cep? } → o cliente
//        completa a nota; o CPF também vai para o cadastro de clientes do prestador (nfse_tomadores)
//   POST { acao: 'completar', nota_id, complementar: true } → o cliente confirma que falta só a
//        diferença de uma nota já emitida: a nota vira a complementar (valor da diferença)
//   POST { acao: 'link', nota_id }                → link público assinado do PDF (para mandar ao
//        paciente pelo WhatsApp), válido por LINK_DIAS dias
//   GET  ?nota=…&exp=…&sig=…                      → o PDF, sem login, se a assinatura e o prazo baterem
//
// Quem pode:
//   - o cliente, com o token do painel no cabeçalho x-painel-token: só as notas dele, só de
//     produção (as de homologação são teste do escritório);
//   - o escritório logado (Authorization: Bearer): qualquer cliente_id, e também as de homologação
//     quando pedir `incluir_homologacao` (para conferir o DANFSe antes de ir para produção).
// O PDF é gerado na hora a partir do xml_retorno (menos de 1 s); não fica guardado.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL, SUPABASE_SERVICE_KEY.

const { createClient } = require('@supabase/supabase-js')
const { clienteDoPainel, usuarioEscritorio } = require('./lib/autenticacao')
const crypto = require('crypto')
const { gerarDanfse } = require('./lib/nfse/danfse/danfse')
const { RepositorioSupabase, EDITAVEIS } = require('./lib/nfse/repositorio')
const lotes = require('./lib/nfse/lotes')
const { cpfValido } = require('./lib/nfse/validador')
const { PREFIXO_JA_EMITIDA, PREFIXO_COMPLEMENTAR } = require('./lib/nfse/duplicidade')

// Dependências externas (substituídas nos testes, ver lib/nfse/__tests__/painelNfse.test.cjs)
const deps = {
  supabase: null,
  usuarioEscritorio,
  clienteDoPainel,
}
const db = () => deps.supabase || (deps.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY))

const LINK_DIAS = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') return pdfPorLink(event.queryStringParameters || {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido, use POST.' })

  let corpo
  try {
    corpo = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Body inválido.' })
  }

  try {
    const acesso = await quemPede(event, corpo)
    if (!acesso) return json(401, { error: 'Link inválido ou expirado. Peça um link novo ao escritório.' })

    if (corpo.acao === 'listar') return json(200, { notas: await listar(acesso, corpo.competencia) })

    if (corpo.acao === 'pendentes') return json(200, { notas: await pendentes(acesso) })

    if (corpo.acao === 'completar') {
      const nota = await completar(acesso, corpo)
      return nota ? json(200, { nota }) : json(404, { error: 'Nota não encontrada ou já emitida.' })
    }

    if (corpo.acao === 'link') {
      const nota = await notaDoCliente(acesso, corpo.nota_id)
      if (!nota) return json(404, { error: 'Nota não encontrada.' })
      return json(200, { url: linkAssinado(event, nota.id), dias: LINK_DIAS })
    }

    if (corpo.acao === 'pdf' || corpo.acao === 'xml') {
      const nota = await notaDoCliente(acesso, corpo.nota_id)
      if (!nota) return json(404, { error: 'Nota não encontrada.' })
      const nome = `NFS-e ${nota.numero_nfse || nota.chave_acesso}`
      if (corpo.acao === 'xml') {
        return arquivo(Buffer.from(nota.xml_retorno, 'utf8'), 'application/xml', `${nome}.xml`)
      }
      return arquivo(await gerarDanfse(nota.xml_retorno), 'application/pdf', `${nome}.pdf`)
    }

    return json(400, { error: 'Ação desconhecida.' })
  } catch (e) {
    if (e instanceof ErroCliente || /inválid|não pode/i.test(e.message)) return json(400, { error: e.message })
    console.error('painel-nfse:', e.message)
    return json(500, { error: e.message })
  }
}

async function quemPede(event, corpo) {
  if (await deps.usuarioEscritorio(event)) {
    if (!UUID.test(corpo.cliente_id || '')) return null
    return { clienteId: corpo.cliente_id, escritorio: true, homologacao: !!corpo.incluir_homologacao }
  }
  const cliente = await deps.clienteDoPainel(event, corpo.cliente_id)
  return cliente ? { clienteId: cliente.id, escritorio: false, homologacao: false } : null
}

const ambientes = (acesso) => (acesso.homologacao ? ['producao', 'homologacao'] : ['producao'])

// "MM/AAAA" da competência da DPS (dCompet), ou da coluna da nota quando o XML não tiver
function competenciaDa(nota) {
  const m = /<dCompet>(\d{4})-(\d{2})-\d{2}<\/dCompet>/.exec(nota.xml_retorno || '')
  if (m) return `${m[2]}/${m[1]}`
  const data = nota.competencia || nota.data
  return data ? `${data.slice(5, 7)}/${data.slice(0, 4)}` : null
}

const emitidaEm = (nota) => ((/<dhProc>([^<]+)<\/dhProc>/.exec(nota.xml_retorno || '') || [])[1]) || nota.criado_em

async function listar(acesso, competencia) {
  const { data, error } = await db().from('nfse_notas')
    .select('id, numero_nfse, chave_acesso, nome, valor, descricao, data, competencia, ambiente, criado_em, xml_retorno')
    .eq('cliente_id', acesso.clienteId)
    .eq('estado', 'autorizada')
    .in('ambiente', ambientes(acesso))
    .not('xml_retorno', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(1000)
  if (error) throw error
  return (data || [])
    .map((n) => ({
      id: n.id,
      numero: n.numero_nfse,
      chave: n.chave_acesso,
      competencia: competenciaDa(n),
      emitidaEm: emitidaEm(n),
      tomador: n.nome,
      valor: n.valor,
      descricao: n.descricao,
      ambiente: n.ambiente,
    }))
    .filter((n) => !competencia || n.competencia === competencia)
    .sort((a, b) => String(b.emitidaEm).localeCompare(String(a.emitidaEm)))
}

async function notaDoCliente(acesso, notaId) {
  if (!UUID.test(notaId || '')) return null
  const { data, error } = await db().from('nfse_notas')
    .select('id, cliente_id, estado, ambiente, numero_nfse, chave_acesso, xml_retorno')
    .eq('id', notaId).maybeSingle()
  if (error) throw error
  if (!data || data.cliente_id !== acesso.clienteId || data.estado !== 'autorizada' || !data.xml_retorno) return null
  if (!ambientes(acesso).includes(data.ambiente)) return null
  return data
}

// Notas ainda não emitidas (importada/validada), para o cliente completar. Só produção: as de
// homologação são teste do escritório.
async function pendentes(acesso) {
  const { data, error } = await db().from('nfse_notas')
    .select('id, nome, cpf, data, valor, descricao, endereco, status_validacao, pendencias, erros, avisos, criado_em')
    .eq('cliente_id', acesso.clienteId)
    .eq('ambiente', 'producao')
    .in('estado', EDITAVEIS)
    .order('data', { ascending: true })
    .limit(500)
  if (error) throw error
  return (data || []).map(resumoPendente)
}

// situacao: pronta | falta (dado a preencher) | complementar (confirmar a diferença) | ja_emitida | invalida
function situacaoPendente(n) {
  const erros = n.erros || []
  if (erros.some((e) => e.startsWith(PREFIXO_JA_EMITIDA))) return 'ja_emitida'
  if (erros.some((e) => e.startsWith(PREFIXO_COMPLEMENTAR))) return 'complementar'
  if (n.status_validacao === 'pronto') return 'pronta'
  return erros.length ? 'invalida' : 'falta'
}

const resumoPendente = (n) => ({
  id: n.id, nome: n.nome, cpf: n.cpf, data: n.data, valor: n.valor, descricao: n.descricao, endereco: n.endereco,
  pronta: n.status_validacao === 'pronto', situacao: situacaoPendente(n),
  pendencias: n.pendencias || [], erros: n.erros || [], avisos: n.avisos || [],
})

// O cliente completa CPF / nome / descrição. Valida de novo o lote (fica "pronta" se não faltar
// nada) e guarda o CPF no cadastro de clientes do prestador, para as próximas notas virem completas.
async function completar(acesso, corpo) {
  if (!UUID.test(corpo.nota_id || '')) return null
  const repo = new RepositorioSupabase(db())
  const nota = await repo.obterNota(corpo.nota_id)
  if (!nota || nota.cliente_id !== acesso.clienteId || nota.ambiente !== 'producao' || !EDITAVEIS.includes(nota.estado)) return null
  const empresa = await repo.obterEmpresa(acesso.clienteId)
  if (!empresa) return null

  if (corpo.complementar === true) {
    try {
      return resumoPendente(await lotes.confirmarComplementar(repo, empresa, nota.id))
    } catch (e) {
      if (e instanceof lotes.NotaNaoEditavel) throw new ErroCliente(e.message)
      throw e
    }
  }

  const campos = {}
  for (const k of ['cpf', 'nome', 'descricao', 'data', 'endereco', 'cep']) if (typeof corpo[k] === 'string') campos[k] = corpo[k].slice(0, 500)
  if (typeof campos.data === 'string' && !campos.data.trim()) delete campos.data // não apaga a data por engano
  if ('cpf' in campos) {
    const cpf = campos.cpf.replace(/\D/g, '')
    if (cpf && !cpfValido(cpf)) throw new ErroCliente('CPF inválido — confira os números.')
  }
  const salva = await lotes.atualizarNota(repo, empresa, nota.id, campos)
  await guardarTomador(repo, acesso.clienteId, salva)
  return resumoPendente(salva)
}

async function guardarTomador(repo, clienteId, nota) {
  if (!nota.cpf || !cpfValido(nota.cpf) || !nota.nome) return
  try {
    const existentes = await repo.listarTomadores(clienteId)
    if (existentes.some((t) => t.cpf === nota.cpf)) return
    await repo.salvarTomador({ cliente_id: clienteId, cpf: nota.cpf, nome: nota.nome, apelidos: [], observacao: 'Informado pelo cliente no painel' })
  } catch (e) {
    console.error('painel-nfse: cadastro do tomador:', e.message) // a nota já foi salva; o cadastro é só conveniência
  }
}

class ErroCliente extends Error {}

// Link público do PDF: HMAC do id da nota + validade, com uma chave derivada da service key
// (não precisa de variável nova; trocar a service key invalida os links antigos).
const chaveLink = () => crypto.createHmac('sha256', process.env.SUPABASE_SERVICE_KEY || '').update('nfse-link-pdf-v1').digest()
const assinar = (notaId, exp) => crypto.createHmac('sha256', chaveLink()).update(`${notaId}.${exp}`).digest('base64url')

function linkAssinado(event, notaId, agora = Date.now()) {
  const exp = Math.floor(agora / 1000) + LINK_DIAS * 86400
  const h = event.headers || {}
  const host = h['x-forwarded-host'] || h.host || ''
  const base = host ? `https://${host}` : (process.env.URL || '')
  return `${base}/.netlify/functions/painel-nfse?nota=${notaId}&exp=${exp}&sig=${assinar(notaId, exp)}`
}

async function pdfPorLink({ nota, exp, sig }) {
  const pagina = (status, texto) => ({ statusCode: status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: texto })
  if (!UUID.test(nota || '') || !/^\d+$/.test(exp || '') || !sig) return pagina(400, 'Link inválido.')
  const esperado = Buffer.from(assinar(nota, exp))
  const recebido = Buffer.from(String(sig))
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return pagina(403, 'Link inválido.')
  if (Number(exp) * 1000 < Date.now()) return pagina(410, 'Este link expirou. Peça a nota de novo a quem a enviou.')
  try {
    const { data, error } = await db().from('nfse_notas')
      .select('id, estado, ambiente, numero_nfse, chave_acesso, xml_retorno').eq('id', nota).maybeSingle()
    if (error) throw error
    if (!data || data.estado !== 'autorizada' || data.ambiente !== 'producao' || !data.xml_retorno) return pagina(404, 'Nota não encontrada.')
    const r = arquivo(await gerarDanfse(data.xml_retorno), 'application/pdf', `NFS-e ${data.numero_nfse || data.chave_acesso}.pdf`)
    r.headers['content-disposition'] = r.headers['content-disposition'].replace('attachment', 'inline')
    return r
  } catch (e) {
    console.error('painel-nfse link:', e.message)
    return pagina(500, 'Não foi possível gerar o PDF agora. Tente de novo em instantes.')
  }
}

function arquivo(buffer, tipo, nome) {
  return {
    statusCode: 200,
    headers: {
      'content-type': tipo,
      'content-disposition': `attachment; filename="${nome.replace(/[^\w .-]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  }
}

exports._deps = deps // testes
exports._linkAssinado = linkAssinado

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
