// netlify/functions/tarefas-robo.js
//
// Fila de tarefas do robô do OneFlow (deploy/robo-parcelamentos/oneflow.py), que faz na tela
// web do OneFlow o que a API dele não oferece. Tabela: supabase-schema-tarefas-robo.sql.
// Só o escritório logado (lib/autenticacao.js). Ver docs/robo-oneflow.md.
//
//   POST { acao: 'listar', competencia, tipo? }                → { tarefas: [...] }  (a mais recente de cada empresa)
//   POST { acao: 'criar', tipo, competencia, cliente_ids: [] } → { criadas: n, ja_na_fila: n, tarefas: [...] }
//   POST { acao: 'cancelar', id }                              → { ok }   (só enquanto 'na_fila')
//   POST { acao: 'tentar_de_novo', id }                        → { tarefa }  (tarefa com erro volta para a fila)
//   POST { acao: 'arquivo', id }                               → { url, nome }  (link assinado, 10 min)

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio, usuarioEscritorio } = require('./lib/autenticacao')

const BUCKET = 'documentos'
const TIPOS = ['relatorio_folha']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPETENCIA = /^(0[1-9]|1[0-2])\/\d{4}$/
const ATIVAS = ['na_fila', 'processando', 'aguardando_pessoa']

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem)
    this.status = status
  }
}

const json = (statusCode, corpo) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })

function uuid(v, nome = 'id') {
  if (!UUID.test(String(v || ''))) throw new ErroHttp(400, `${nome} inválido`)
  return v
}

function competencia(v) {
  if (!COMPETENCIA.test(String(v || ''))) throw new ErroHttp(400, 'Competência inválida (use MM/AAAA)')
  return v
}

function tipo(v) {
  const t = v || 'relatorio_folha'
  if (!TIPOS.includes(t)) throw new ErroHttp(400, `Tipo de tarefa desconhecido: ${t}`)
  return t
}

async function ok(q) {
  const { data, error } = await q
  if (error) {
    if (/tarefas_robo/.test(error.message || '')) throw new ErroHttp(500, 'Rode supabase-schema-tarefas-robo.sql no Supabase.')
    throw new ErroHttp(500, error.message)
  }
  return data
}

async function tarefa(sb, id) {
  const t = await ok(sb.from('tarefas_robo').select('*').eq('id', uuid(id)).maybeSingle())
  if (!t) throw new ErroHttp(404, 'Tarefa não encontrada')
  return t
}

async function executar(p, event, sb) {
  switch (p.acao) {
    case 'listar': {
      const linhas = await ok(sb.from('tarefas_robo').select('*')
        .eq('competencia', competencia(p.competencia)).eq('tipo', tipo(p.tipo))
        .order('criado_em', { ascending: false }).limit(1000))
      const porCliente = {}
      for (const l of linhas) if (!porCliente[l.cliente_id]) porCliente[l.cliente_id] = l
      return { tarefas: Object.values(porCliente) }
    }

    case 'criar': {
      const t = tipo(p.tipo)
      const comp = competencia(p.competencia)
      const ids = [...new Set((Array.isArray(p.cliente_ids) ? p.cliente_ids : []).map((id) => uuid(id, 'cliente_id')))]
      if (!ids.length) throw new ErroHttp(400, 'Escolha ao menos uma empresa')
      if (ids.length > 300) throw new ErroHttp(400, 'Muitas empresas de uma vez (máx. 300)')
      const ativas = await ok(sb.from('tarefas_robo').select('cliente_id')
        .eq('tipo', t).eq('competencia', comp).in('status', ATIVAS).in('cliente_id', ids))
      const jaNaFila = new Set(ativas.map((a) => a.cliente_id))
      const novos = ids.filter((id) => !jaNaFila.has(id))
      let tarefas = []
      if (novos.length) {
        const usuario = await usuarioEscritorio(event)
        const criadoPor = (usuario && usuario.email) || null
        tarefas = await ok(sb.from('tarefas_robo')
          .insert(novos.map((cliente_id) => ({ tipo: t, competencia: comp, cliente_id, criado_por: criadoPor })))
          .select('*'))
      }
      return { criadas: tarefas.length, ja_na_fila: jaNaFila.size, tarefas }
    }

    case 'cancelar': {
      const t = await tarefa(sb, p.id)
      if (t.status === 'cancelada') return { ok: true }
      if (t.status !== 'na_fila') throw new ErroHttp(409, 'O robô já pegou essa tarefa; não dá mais para cancelar.')
      // o filtro de status no update evita corrida com o robô pegando a tarefa agora
      const r = await ok(sb.from('tarefas_robo').update({ status: 'cancelada', atualizado_em: new Date().toISOString() })
        .eq('id', t.id).eq('status', 'na_fila').select('id'))
      if (!r.length) throw new ErroHttp(409, 'O robô acabou de pegar essa tarefa.')
      return { ok: true }
    }

    case 'tentar_de_novo': {
      const t = await tarefa(sb, p.id)
      if (t.status !== 'erro') throw new ErroHttp(409, 'Só tarefa com erro volta para a fila.')
      const [nova] = await ok(sb.from('tarefas_robo')
        .update({ status: 'na_fila', robo_mensagem: null, atualizado_em: new Date().toISOString() })
        .eq('id', t.id).eq('status', 'erro').select('*'))
      if (!nova) throw new ErroHttp(409, 'A tarefa mudou enquanto isso; atualize a tela.')
      return { tarefa: nova }
    }

    case 'arquivo': {
      const t = await tarefa(sb, p.id)
      if (!t.arquivo_path) throw new ErroHttp(404, 'Essa tarefa ainda não tem arquivo.')
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(t.arquivo_path, 600)
      if (error) throw new ErroHttp(500, error.message)
      return { url: data.signedUrl, nome: t.arquivo_nome }
    }

    default:
      throw new ErroHttp(400, 'Ação desconhecida')
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'Use POST' })
  const negado = await exigirEscritorio(event, 'tarefas-robo')
  if (negado) return negado
  let p
  try { p = JSON.parse(event.body || '{}') } catch { return json(400, { erro: 'Corpo inválido' }) }
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return json(200, await executar(p, event, sb))
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500
    if (status === 500) console.error('[tarefas-robo]', e)
    return json(status, { erro: e.message })
  }
}
