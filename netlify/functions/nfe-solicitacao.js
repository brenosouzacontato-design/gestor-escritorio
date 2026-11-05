// netlify/functions/nfe-solicitacao.js
//
// Pedido de NF-e de venda pelo app do cliente (?pedido=<token do painel>,
// src/pages/pedidonfe). O cliente guarda os destinatários (clientes dele) e
// produtos, e manda o pedido; o resumo vai pelo WhatsApp do escritório para
// o WhatsApp de entrega do cliente (clientes.whatsapp_entrega ou telefone —
// normalmente o grupo dele com o escritório).
//   POST { acao: 'iniciar' }                         → { empresa, destinatarios, produtos, pedidos }
//   POST { acao: 'salvar_destinatario', destinatario } → { destinatario }
//   POST { acao: 'excluir_destinatario', id }        → { ok }
//   POST { acao: 'salvar_produto', produto }         → { produto }
//   POST { acao: 'excluir_produto', id }             → { ok }
//   POST { acao: 'enviar', destinatario, itens, frete_modalidade, frete_valor, observacao }
//        → { pedido, whatsapp: { ok, erro? } }  (o pedido fica gravado mesmo se o WhatsApp falhar)
//   POST { acao: 'reenviar_whatsapp', id }           → { whatsapp }  (só o escritório)
//
// Quem pode: o cliente, com o x-painel-token (só os dados dele); o escritório
// logado, passando cliente_id. Tabelas em supabase-schema-nfe-solicitacoes.sql.

const { createClient } = require('@supabase/supabase-js')
const { clienteDoPainel, usuarioEscritorio } = require('./lib/autenticacao')
const { enviarMensagem, numeroWhatsapp } = require('./lib/whatsapp')
const {
  ErroPedido, normalizarDestinatario, normalizarProduto, normalizarPedido, resumoWhatsapp,
} = require('./lib/pedidoNfe')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PEDIDOS_POR_HORA = 20 // trava contra envio repetido (cada pedido manda um WhatsApp)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido, use POST.' })
  let corpo
  try { corpo = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Body inválido.' }) }

  try {
    const acesso = await quemPede(event, corpo)
    if (!acesso) return json(401, { error: 'Link inválido ou expirado. Peça um link novo ao escritório.' })
    const { clienteId } = acesso

    switch (corpo.acao) {
      case 'iniciar': return json(200, await iniciar(clienteId))
      case 'salvar_destinatario': return json(200, { destinatario: await salvarDestinatario(clienteId, corpo.destinatario) })
      case 'excluir_destinatario': return json(200, await excluir('nfe_destinatarios', clienteId, corpo.id))
      case 'salvar_produto': return json(200, { produto: await salvarProduto(clienteId, corpo.produto) })
      case 'excluir_produto': return json(200, await excluir('nfe_produtos', clienteId, corpo.id))
      case 'enviar': return json(200, await enviarPedido(clienteId, corpo))
      case 'reenviar_whatsapp': {
        if (!acesso.escritorio) return json(403, { error: 'Só o escritório pode reenviar.' })
        const { data: ped } = await supabase.from('nfe_solicitacoes').select('*').eq('id', corpo.id).eq('cliente_id', clienteId).maybeSingle()
        if (!ped) return json(404, { error: 'Pedido não encontrado.' })
        return json(200, { whatsapp: await mandarResumo(clienteId, ped) })
      }
      default: return json(400, { error: 'Ação desconhecida.' })
    }
  } catch (e) {
    if (e instanceof ErroPedido) return json(400, { error: e.message })
    console.error('nfe-solicitacao:', e.message)
    return json(500, { error: e.message })
  }
}

async function quemPede(event, corpo) {
  if (await usuarioEscritorio(event)) {
    return UUID.test(corpo.cliente_id || '') ? { clienteId: corpo.cliente_id, escritorio: true } : null
  }
  const cliente = await clienteDoPainel(event)
  return cliente ? { clienteId: cliente.id, escritorio: false } : null
}

async function iniciar(clienteId) {
  const [emp, dest, prod, ped] = await Promise.all([
    supabase.from('clientes').select('id, nome, cnpj').eq('id', clienteId).maybeSingle(),
    supabase.from('nfe_destinatarios').select('*').eq('cliente_id', clienteId).order('nome').limit(2000),
    supabase.from('nfe_produtos').select('*').eq('cliente_id', clienteId).order('descricao').limit(2000),
    supabase.from('nfe_solicitacoes')
      .select('id, destinatario, valor_total, status, status_mensagem, nfe_numero, emitida_em, criado_em, whatsapp_enviado_em, whatsapp_erro')
      .eq('cliente_id', clienteId).order('criado_em', { ascending: false }).limit(30),
  ])
  for (const r of [emp, dest, prod, ped]) if (r.error) throw r.error
  return {
    empresa: emp.data,
    destinatarios: dest.data,
    produtos: prod.data,
    pedidos: ped.data.map((p) => ({ ...p, destinatario: { nome: p.destinatario?.nome, documento: p.destinatario?.documento } })),
  }
}

// Atualiza pelo id (se for do cliente) ou pelo CPF/CNPJ; senão cria.
async function salvarDestinatario(clienteId, bruto = {}) {
  const dados = { ...normalizarDestinatario(bruto), atualizado_em: new Date().toISOString() }
  let existente = null
  if (UUID.test(bruto.id || '')) {
    const { data } = await supabase.from('nfe_destinatarios').select('id').eq('id', bruto.id).eq('cliente_id', clienteId).maybeSingle()
    existente = data
  }
  if (!existente) {
    const { data } = await supabase.from('nfe_destinatarios').select('id').eq('cliente_id', clienteId).eq('documento', dados.documento).maybeSingle()
    existente = data
  }
  const consulta = existente
    ? supabase.from('nfe_destinatarios').update(dados).eq('id', existente.id)
    : supabase.from('nfe_destinatarios').insert({ ...dados, cliente_id: clienteId })
  const { data, error } = await consulta.select().single()
  if (error) throw error
  return data
}

// Atualiza pelo id (se for do cliente) ou pela mesma descrição; senão cria.
async function salvarProduto(clienteId, bruto = {}, lista = null) {
  const dados = normalizarProduto(bruto)
  const produtos = lista || (await supabase.from('nfe_produtos').select('id, descricao').eq('cliente_id', clienteId)).data || []
  const chave = (s) => String(s || '').trim().toLowerCase()
  const existente = produtos.find((p) => UUID.test(bruto.id || bruto.produto_id || '') && p.id === (bruto.id || bruto.produto_id))
    || produtos.find((p) => chave(p.descricao) === chave(dados.descricao))
  // no cadastro, valor vazio não apaga o último valor usado
  if (dados.valor_unitario == null) delete dados.valor_unitario
  dados.atualizado_em = new Date().toISOString()
  const consulta = existente
    ? supabase.from('nfe_produtos').update(dados).eq('id', existente.id)
    : supabase.from('nfe_produtos').insert({ ...dados, cliente_id: clienteId })
  const { data, error } = await consulta.select().single()
  if (error) throw error
  if (lista && !existente) lista.push(data)
  return data
}

async function excluir(tabela, clienteId, id) {
  if (!UUID.test(id || '')) throw new ErroPedido('Cadastro inválido.')
  const { error } = await supabase.from(tabela).delete().eq('id', id).eq('cliente_id', clienteId)
  if (error) throw error
  return { ok: true }
}

async function enviarPedido(clienteId, corpo) {
  const pedido = normalizarPedido(corpo)
  const destinatario = normalizarDestinatario(corpo.destinatario)

  const umaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase.from('nfe_solicitacoes').select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId).gte('criado_em', umaHora)
  if ((count || 0) >= PEDIDOS_POR_HORA) throw new ErroPedido('Muitos pedidos na última hora. Fale com o escritório.')

  // o cadastro do cliente fica sempre com o último endereço e preço usados
  const salvoDest = await salvarDestinatario(clienteId, corpo.destinatario)
  const { data: lista } = await supabase.from('nfe_produtos').select('id, descricao').eq('cliente_id', clienteId)
  const produtos = lista || []
  for (const item of pedido.itens) {
    const salvo = await salvarProduto(clienteId, item, produtos)
    item.produto_id = salvo.id
  }

  const { data: ped, error } = await supabase.from('nfe_solicitacoes').insert({
    cliente_id: clienteId,
    destinatario_id: salvoDest.id,
    destinatario,
    ...pedido,
  }).select().single()
  if (error) throw error

  const whatsapp = await mandarResumo(clienteId, ped)
  return { pedido: ped, whatsapp }
}

async function mandarResumo(clienteId, ped) {
  const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
  const destino = numeroWhatsapp(cli?.whatsapp_entrega || cli?.telefone)
  const agora = new Date().toISOString()
  let envio
  if (!destino) envio = { sucesso: false, erro: 'Empresa sem WhatsApp de entrega cadastrado (Entregas → Empresas).' }
  else envio = await enviarMensagem(destino, resumoWhatsapp(cli.nome, ped))
  const marca = envio.sucesso
    ? { whatsapp_destino: destino, whatsapp_enviado_em: agora, whatsapp_erro: null }
    : { whatsapp_destino: destino, whatsapp_erro: `${agora.slice(0, 10)}: ${envio.erro}`.slice(0, 300) }
  const { error } = await supabase.from('nfe_solicitacoes').update(marca).eq('id', ped.id)
  if (error) console.error('nfe-solicitacao: falha ao marcar WhatsApp:', error.message)
  return envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro }
}

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
