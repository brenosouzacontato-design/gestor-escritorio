// Central de Mensagens — dados (schema: supabase-schema-central-mensagens.sql).
// Leitura e aprovação direto no Supabase (login do escritório); o envio pelo
// WhatsApp é da function mensagens-enviar (e do cron mensagens-cron, para as
// agendadas). Nada sai sem estar 'aprovada'.
import { supabase, cabecalhosFunctions } from '../../lib/supabase'

async function emailUsuario() {
  const { data } = await supabase.auth.getUser()
  return data?.user?.email || 'escritório'
}

export const faltaSchema = (e) => /mensagens_(fila|modelos)/.test(e?.message || '') || ['42P01', 'PGRST205'].includes(e?.code)

// ---------- Modelos ----------

export async function listarModelos() {
  const { data, error } = await supabase.from('mensagens_modelos').select('*').order('ordem').order('nome')
  if (error) throw error
  return data || []
}

export async function salvarModelo({ id, nome, categoria, texto, ativo = true }) {
  const campos = { nome: nome.trim(), categoria: (categoria || 'Avisos').trim(), texto, ativo, atualizado_em: new Date().toISOString() }
  const q = id
    ? supabase.from('mensagens_modelos').update(campos).eq('id', id)
    : supabase.from('mensagens_modelos').insert(campos)
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
}

export async function excluirModelo(id) {
  const { error } = await supabase.from('mensagens_modelos').delete().eq('id', id).is('chave', null)
  if (error) throw error
}

// ---------- Dados das variáveis ----------

// Chave PIX do escritório e o honorário pendente mais antigo de cada empresa
export async function dadosVariaveis() {
  const [cfg, hon] = await Promise.all([
    supabase.from('configuracoes').select('chave, valor').in('chave', ['honorarios_pix_chave', 'honorarios_pix_favorecido']),
    supabase.from('honorarios').select('id, cliente_id, competencia, tipo, descricao, valor, vencimento')
      .eq('status', 'pendente').not('cliente_id', 'is', null).order('vencimento', { ascending: true }),
  ])
  const c = Object.fromEntries((cfg.data || []).map((x) => [x.chave, x.valor]))
  const honorarioDe = {}
  for (const h of hon.data || []) if (!honorarioDe[h.cliente_id]) honorarioDe[h.cliente_id] = h
  return { pix: { chave: c.honorarios_pix_chave || '', favorecido: c.honorarios_pix_favorecido || '' }, honorarioDe }
}

// ---------- Fila ----------

export async function listarFila(status, { limite = 300 } = {}) {
  const { data, error } = await supabase.from('mensagens_fila')
    .select('*, clientes(nome, telefone), mensagens_modelos(nome)')
    .in('status', status)
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return data || []
}

export async function contarAguardando() {
  const { count, error } = await supabase.from('mensagens_fila').select('id', { count: 'exact', head: true }).eq('status', 'aguardando_aprovacao')
  if (error) throw error
  return count || 0
}

// mensagens: [{ cliente_id, destino_nome, telefone, texto, modelo_id }]
// enviarAgora: já aprovadas e mandadas na hora; senão vão para "Aguardando aprovação".
export async function criarMensagens(mensagens, { enviarAgora = false, agendadaPara = null } = {}) {
  const por = await emailUsuario()
  const agora = new Date().toISOString()
  const lote = crypto.randomUUID()
  const linhas = mensagens.map((m) => ({
    ...m, origem: 'central', lote, criado_por: por,
    agendada_para: enviarAgora ? null : agendadaPara,
    status: enviarAgora ? 'aprovada' : 'aguardando_aprovacao',
    aprovado_por: enviarAgora ? por : null, aprovado_em: enviarAgora ? agora : null,
  }))
  const { data, error } = await supabase.from('mensagens_fila').insert(linhas).select('id')
  if (error) throw error
  const ids = (data || []).map((x) => x.id)
  if (!enviarAgora) return { criadas: ids.length }
  return { criadas: ids.length, ...(await enviar(ids)) }
}

// Aprova (com o texto editado, se houver) e já manda as que não têm horário futuro
export async function aprovar(ids) {
  const por = await emailUsuario()
  const { data, error } = await supabase.from('mensagens_fila')
    .update({ status: 'aprovada', aprovado_por: por, aprovado_em: new Date().toISOString() })
    .in('id', ids).eq('status', 'aguardando_aprovacao')
    .select('id, agendada_para')
  if (error) throw error
  const agora = Date.now()
  const jaPodem = (data || []).filter((m) => !m.agendada_para || new Date(m.agendada_para).getTime() <= agora).map((m) => m.id)
  const agendadas = (data || []).length - jaPodem.length
  const r = jaPodem.length ? await enviar(jaPodem) : { enviadas: 0, erros: [] }
  return { ...r, agendadas }
}

export async function editarTexto(id, texto) {
  const { error } = await supabase.from('mensagens_fila').update({ texto }).eq('id', id).in('status', ['aguardando_aprovacao', 'aprovada'])
  if (error) throw error
}

export async function descartar(ids) {
  const { error } = await supabase.from('mensagens_fila').update({ status: 'descartada' })
    .in('id', ids).in('status', ['aguardando_aprovacao', 'aprovada', 'erro'])
  if (error) throw error
}

// Mensagem com erro volta para a aprovação (dá para corrigir o texto/cadastro antes)
export async function voltarParaAprovacao(id, telefone) {
  const { error } = await supabase.from('mensagens_fila')
    .update({ status: 'aguardando_aprovacao', erro: null, aprovado_por: null, aprovado_em: null, ...(telefone !== undefined ? { telefone } : {}) })
    .eq('id', id).eq('status', 'erro')
  if (error) throw error
}

export async function atualizarTelefone(id, telefone) {
  const { error } = await supabase.from('mensagens_fila').update({ telefone }).eq('id', id)
  if (error) throw error
}

async function enviar(ids) {
  const resp = await fetch('/.netlify/functions/mensagens-enviar', {
    method: 'POST', headers: await cabecalhosFunctions(), body: JSON.stringify({ ids }),
  })
  const r = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(r.error || 'Não foi possível enviar agora — as mensagens ficaram aprovadas e saem na próxima rodada (até 5 min).')
  return { enviadas: r.enviadas || 0, erros: r.erros || [] }
}
