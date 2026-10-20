// netlify/functions/painel-nfse.js
//
// Notas fiscais de serviço emitidas pelo gestor, para o painel do cliente acompanhar e baixar.
//   POST { acao: 'listar', competencia?: 'MM/AAAA', cliente_id? }
//        → { notas: [{ id, numero, chave, competencia, emitidaEm, tomador, valor, descricao, ambiente }] }
//   POST { acao: 'pdf', nota_id, cliente_id? }   → o DANFSe em PDF (lib/nfse/danfse, NT 008/2026)
//   POST { acao: 'xml', nota_id, cliente_id? }   → o XML da NFS-e autorizada (o documento com validade)
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
const { gerarDanfse } = require('./lib/nfse/danfse/danfse')

// Dependências externas (substituídas nos testes, ver lib/nfse/__tests__/painelNfse.test.cjs)
const deps = {
  supabase: null,
  usuarioEscritorio,
  clienteDoPainel,
}
const db = () => deps.supabase || (deps.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
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

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
