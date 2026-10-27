// netlify/functions/nfse-emitidas.js
//
// Todas as NFS-e emitidas por uma empresa (inclusive fora do gestor), lidas do Ambiente de Dados
// Nacional (lib/nfse/adn.js), para o link "todas as notas" do cliente: ?notas=<token do painel>.
//   POST { acao: 'listar', atualizar? }  → { empresa, notas, sincronizadoEm, erro }
//        Antes de listar, busca as notas novas no ADN se a última leitura tiver mais de
//        ATUALIZAR_MIN minutos (ou se o escritório pedir `atualizar`).
//   POST { acao: 'pdf', nota_id }  → DANFSe (lib/nfse/danfse) com QR Code da consulta pública;
//        marca d'água CANCELADA/SUBSTITUÍDA quando for o caso
//   POST { acao: 'xml', nota_id }  → XML da NFS-e (o documento com validade jurídica)
//   POST { acao: 'link', nota_id } → link público assinado do PDF (para o WhatsApp), LINK_DIAS dias
//   GET  ?nota=…&exp=…&sig=…       → o PDF, sem login, se assinatura e prazo baterem
//
// Quem pode: o cliente pelo x-painel-token (só as notas dele) ou o escritório logado com cliente_id.
// Variáveis: SUPABASE_URL, SUPABASE_SERVICE_KEY, NFSE_CERT_KEY (decifra o A1 da empresa).

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { clienteDoPainel, usuarioEscritorio } = require('./lib/autenticacao')
const { gerarDanfse } = require('./lib/nfse/danfse/danfse')
const { decifrar } = require('./lib/nfse/cofre')
const { lerPfx } = require('./lib/nfse/certificado')
const { criarClienteAdn, sincronizar } = require('./lib/nfse/adn')

const ATUALIZAR_MIN = 15
const LINK_DIAS = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MARCA = { cancelada: 'CANCELADA', substituida: 'SUBSTITUÍDA' }

// Dependências externas (substituídas nos testes, ver lib/nfse/__tests__/nfseEmitidas.test.cjs)
const deps = {
  supabase: null,
  usuarioEscritorio,
  clienteDoPainel,
  clienteAdn: async (db, clienteId) => {
    const { data, error } = await db.from('nfse_certificados').select('pfx_cifrado, senha_cifrada').eq('cliente_id', clienteId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    const cert = lerPfx(decifrar(data.pfx_cifrado), decifrar(data.senha_cifrada).toString('utf8'))
    return criarClienteAdn({ tls: cert.tls })
  },
  agora: () => Date.now(),
}
const db = () => deps.supabase || (deps.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY))

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') return pdfPorLink(event.queryStringParameters || {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido, use POST.' })
  let corpo
  try { corpo = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Body inválido.' }) }

  try {
    const acesso = await quemPede(event, corpo)
    if (!acesso) return json(401, { error: 'Link inválido ou expirado. Peça um link novo ao escritório.' })

    if (corpo.acao === 'listar') return json(200, await listar(acesso, !!corpo.atualizar))

    if (['pdf', 'xml', 'link'].includes(corpo.acao)) {
      const nota = await notaDoCliente(acesso, corpo.nota_id)
      if (!nota) return json(404, { error: 'Nota não encontrada.' })
      if (corpo.acao === 'link') return json(200, { url: linkAssinado(event, nota.id), dias: LINK_DIAS })
      const nome = `NFS-e ${nota.numero_nfse || nota.chave_acesso}`
      if (corpo.acao === 'xml') return arquivo(Buffer.from(nota.xml, 'utf8'), 'application/xml', `${nome}.xml`)
      return arquivo(await pdfDa(nota), 'application/pdf', `${nome}.pdf`)
    }
    return json(400, { error: 'Ação desconhecida.' })
  } catch (e) {
    console.error('nfse-emitidas:', e.message)
    return json(500, { error: e.message })
  }
}

async function quemPede(event, corpo) {
  if (await deps.usuarioEscritorio(event)) {
    return UUID.test(corpo.cliente_id || '') ? { clienteId: corpo.cliente_id, escritorio: true } : null
  }
  const cliente = await deps.clienteDoPainel(event, corpo.cliente_id)
  return cliente ? { clienteId: cliente.id, escritorio: false } : null
}

// Busca as notas novas no ADN se a última leitura estiver velha. Falha na leitura não impede a
// lista: devolve o que já está guardado, com o erro para a página avisar.
async function atualizarSePreciso(acesso, forcar) {
  const { data: controle } = await db().from('nfse_adn_controle').select('sincronizado_em').eq('cliente_id', acesso.clienteId).maybeSingle()
  const ultima = controle?.sincronizado_em ? Date.parse(controle.sincronizado_em) : 0
  if (!forcar && deps.agora() - ultima < ATUALIZAR_MIN * 60000) return null
  const { data: empresa, error } = await db().from('nfse_empresas').select('cnpj').eq('cliente_id', acesso.clienteId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!empresa) return 'Empresa sem configuração de NFS-e no gestor.'
  try {
    const cliente = await deps.clienteAdn(db(), acesso.clienteId)
    if (!cliente) return 'Empresa sem certificado A1 cadastrado no gestor.'
    await sincronizar({ db: db(), clienteId: acesso.clienteId, cnpj: empresa.cnpj, cliente, agora: deps.agora })
    return null
  } catch (e) {
    console.error('nfse-emitidas: leitura do ADN:', e.message)
    return 'Não foi possível buscar as notas mais recentes agora. Mostrando as que já estavam salvas.'
  }
}

async function listar(acesso, atualizar) {
  const erro = await atualizarSePreciso(acesso, atualizar && acesso.escritorio)
  const [{ data: notas, error }, { data: controle }, { data: cliente }] = await Promise.all([
    db().from('nfse_adn_notas')
      .select('id, numero_nfse, chave_acesso, competencia, emitida_em, tomador_nome, valor, valor_liquido, descricao, situacao')
      .eq('cliente_id', acesso.clienteId).eq('ambiente', 'producao')
      .order('emitida_em', { ascending: false }).limit(5000),
    db().from('nfse_adn_controle').select('sincronizado_em').eq('cliente_id', acesso.clienteId).maybeSingle(),
    db().from('clientes').select('nome').eq('id', acesso.clienteId).maybeSingle(),
  ])
  if (error) throw new Error(error.message)
  return {
    empresa: cliente?.nome || '',
    sincronizadoEm: controle?.sincronizado_em || null,
    erro,
    notas: (notas || []).map((n) => ({
      id: n.id,
      numero: n.numero_nfse,
      chave: n.chave_acesso,
      competencia: n.competencia ? `${n.competencia.slice(5, 7)}/${n.competencia.slice(0, 4)}` : null,
      emitidaEm: n.emitida_em,
      tomador: n.tomador_nome,
      valor: n.valor,
      valorLiquido: n.valor_liquido,
      descricao: n.descricao,
      situacao: n.situacao,
    })).sort((a, b) => String(b.emitidaEm).localeCompare(String(a.emitidaEm))),
  }
}

async function notaDoCliente(acesso, notaId) {
  if (!UUID.test(notaId || '')) return null
  const { data, error } = await db().from('nfse_adn_notas')
    .select('id, cliente_id, ambiente, numero_nfse, chave_acesso, situacao, xml').eq('id', notaId).maybeSingle()
  if (error) throw new Error(error.message)
  return data && data.cliente_id === acesso.clienteId && data.ambiente === 'producao' ? data : null
}

const pdfDa = (nota) => gerarDanfse(nota.xml, MARCA[nota.situacao] ? { marcaDagua: MARCA[nota.situacao] } : {})

// Link público do PDF: HMAC do id + validade, com chave derivada da service key (como painel-nfse,
// mas com outro rótulo: um link não serve na outra function).
const chaveLink = () => crypto.createHmac('sha256', process.env.SUPABASE_SERVICE_KEY || '').update('nfse-adn-link-pdf-v1').digest()
const assinar = (id, exp) => crypto.createHmac('sha256', chaveLink()).update(`${id}.${exp}`).digest('base64url')

function linkAssinado(event, notaId) {
  const exp = Math.floor(deps.agora() / 1000) + LINK_DIAS * 86400
  const h = event.headers || {}
  const host = h['x-forwarded-host'] || h.host || ''
  const base = host ? `https://${host}` : (process.env.URL || '')
  return `${base}/.netlify/functions/nfse-emitidas?nota=${notaId}&exp=${exp}&sig=${assinar(notaId, exp)}`
}

async function pdfPorLink({ nota, exp, sig }) {
  const pagina = (status, texto) => ({ statusCode: status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: texto })
  if (!UUID.test(nota || '') || !/^\d+$/.test(exp || '') || !sig) return pagina(400, 'Link inválido.')
  const esperado = Buffer.from(assinar(nota, exp))
  const recebido = Buffer.from(String(sig))
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return pagina(403, 'Link inválido.')
  if (Number(exp) * 1000 < deps.agora()) return pagina(410, 'Este link expirou. Peça a nota de novo a quem a enviou.')
  try {
    const { data, error } = await db().from('nfse_adn_notas')
      .select('id, ambiente, numero_nfse, chave_acesso, situacao, xml').eq('id', nota).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || data.ambiente !== 'producao') return pagina(404, 'Nota não encontrada.')
    const r = arquivo(await pdfDa(data), 'application/pdf', `NFS-e ${data.numero_nfse || data.chave_acesso}.pdf`)
    r.headers['content-disposition'] = r.headers['content-disposition'].replace('attachment', 'inline')
    return r
  } catch (e) {
    console.error('nfse-emitidas link:', e.message)
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

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

exports._deps = deps // testes
