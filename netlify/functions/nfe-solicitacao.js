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
//   POST { acao: 'enviar', destinatario, itens (com desconto: "10,00" ou "5%"), desconto_geral,
//          frete_modalidade, frete_valor, observacao }
//        → { pedido, whatsapp: { ok, erro? } }  (o pedido fica gravado mesmo se o WhatsApp falhar)
//        com id: corrige o mesmo pedido (só se ainda 'recebida' ou devolvido com pendência — 'erro')
//   POST { acao: 'reenviar_whatsapp', id }           → { whatsapp }  (só o escritório)
//   POST { acao: 'anexar_nota', id, pdf, xml, enviar_whatsapp }  (só o escritório: pdf e xml em base64;
//        lê número/chave do XML, grava em documentos/nfe-vendas/, marca 'emitida' e, se pedido, manda
//        o DANFE e o XML no WhatsApp de entrega — o mesmo que o robô faz)  → { pedido, whatsapp, aviso? }
//   POST { acao: 'devolver', id, motivo }            → { pedido, whatsapp }  (só o escritório: volta para
//        o cliente corrigir, status 'erro' + recado, e avisa pelo WhatsApp com o link do app)
//
// Quem pode: o cliente, com o x-painel-token (só os dados dele); o escritório
// logado, passando cliente_id. Tabelas em supabase-schema-nfe-solicitacoes.sql.

const { createClient } = require('@supabase/supabase-js')
const { clienteDoPainel, usuarioEscritorio } = require('./lib/autenticacao')
const { enviarMensagem, enviarDocumento, numeroWhatsapp } = require('./lib/whatsapp')
const {
  ErroPedido, normalizarDestinatario, normalizarProduto, normalizarPedido, resumoWhatsapp,
  PODE_EDITAR, avisoPendencia, dadosXmlNfe,
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
      case 'anexar_nota': {
        if (!acesso.escritorio) return json(403, { error: 'Só o escritório pode anexar a nota.' })
        return json(200, await anexarNota(clienteId, corpo))
      }
      case 'devolver': {
        if (!acesso.escritorio) return json(403, { error: 'Só o escritório pode devolver o pedido.' })
        return json(200, await devolverPedido(clienteId, corpo))
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
      .select('id, destinatario, itens, frete_modalidade, frete_valor, observacao, valor_produtos, valor_total, status, status_mensagem, nfe_numero, emitida_em, criado_em, whatsapp_enviado_em, whatsapp_erro')
      .eq('cliente_id', clienteId).order('criado_em', { ascending: false }).limit(30),
  ])
  for (const r of [emp, dest, prod, ped]) if (r.error) throw r.error
  return {
    empresa: emp.data,
    destinatarios: dest.data,
    produtos: prod.data,
    pedidos: ped.data,
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

  // correção de um pedido que ainda não foi emitido
  let anterior = null
  if (corpo.id != null) {
    if (!UUID.test(corpo.id)) throw new ErroPedido('Pedido inválido.')
    const { data } = await supabase.from('nfe_solicitacoes').select('id, status').eq('id', corpo.id).eq('cliente_id', clienteId).maybeSingle()
    if (!data) throw new ErroPedido('Pedido não encontrado.')
    if (!PODE_EDITAR.includes(data.status)) throw new ErroPedido('Este pedido já está em emissão e não pode mais ser alterado. Fale com o escritório.')
    anterior = data
  } else {
    const umaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await supabase.from('nfe_solicitacoes').select('id', { count: 'exact', head: true })
      .eq('cliente_id', clienteId).gte('criado_em', umaHora)
    if ((count || 0) >= PEDIDOS_POR_HORA) throw new ErroPedido('Muitos pedidos na última hora. Fale com o escritório.')
  }

  // o cadastro do cliente fica sempre com o último endereço e preço usados
  const salvoDest = await salvarDestinatario(clienteId, corpo.destinatario)
  const { data: lista } = await supabase.from('nfe_produtos').select('id, descricao').eq('cliente_id', clienteId)
  const produtos = lista || []
  for (const item of pedido.itens) {
    const salvo = await salvarProduto(clienteId, item, produtos)
    item.produto_id = salvo.id
  }

  const linha = { destinatario_id: salvoDest.id, destinatario, ...pedido }
  const { data: ped, error } = anterior
    // volta para o escritório como pedido novo; o robô e o recado anteriores são zerados
    ? await supabase.from('nfe_solicitacoes').update({
      ...linha, status: 'recebida', status_mensagem: null,
      robo_status: null, robo_mensagem: null, robo_em: null, atualizado_em: new Date().toISOString(),
    }).eq('id', anterior.id).eq('cliente_id', clienteId).in('status', PODE_EDITAR).select().single()
    : await supabase.from('nfe_solicitacoes').insert({ cliente_id: clienteId, ...linha }).select().single()
  if (error) throw error

  const whatsapp = await mandarResumo(clienteId, ped, { corrigido: !!anterior })
  return { pedido: ped, whatsapp, corrigido: !!anterior }
}

// Escritório devolve o pedido ao cliente com o que falta (status 'erro' = "Com pendência" no app)
async function devolverPedido(clienteId, { id, motivo }) {
  const texto = String(motivo || '').trim().slice(0, 500)
  if (!texto) throw new ErroPedido('Escreva o que o cliente precisa corrigir.')
  if (!UUID.test(id || '')) throw new ErroPedido('Pedido inválido.')
  const { data: atual } = await supabase.from('nfe_solicitacoes').select('id, status, robo_status').eq('id', id).eq('cliente_id', clienteId).maybeSingle()
  if (!atual) throw new ErroPedido('Pedido não encontrado.')
  if (['emitida', 'cancelada'].includes(atual.status)) throw new ErroPedido('Pedido já emitido ou cancelado.')
  if (['na_fila', 'processando', 'aguardando_pessoa'].includes(atual.robo_status)) throw new ErroPedido('O robô está com este pedido agora. Espere ele terminar.')
  const { data: ped, error } = await supabase.from('nfe_solicitacoes').update({
    status: 'erro', status_mensagem: texto, robo_status: null, atualizado_em: new Date().toISOString(),
  }).eq('id', id).eq('cliente_id', clienteId).select('*').single()
  if (error) throw error

  const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
  const destino = numeroWhatsapp(cli?.whatsapp_entrega || cli?.telefone)
  const site = (process.env.URL || '').replace(/\/$/, '')
  const chave = cli?.painel_token || cli?.id
  const link = site && chave ? `${site}/?pedido=${chave}` : null
  const envio = destino
    ? await enviarMensagem(destino, avisoPendencia(ped, texto, link))
    : { sucesso: false, erro: 'Empresa sem WhatsApp de entrega cadastrado (Entregas → Empresas).' }
  return { pedido: ped, whatsapp: envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro } }
}

// DANFE + XML emitidos fora do robô (à mão ou pelo Claude): grava, marca emitida e entrega ao cliente.
async function anexarNota(clienteId, { id, pdf, xml, enviar_whatsapp = true }) {
  if (!UUID.test(id || '')) throw new ErroPedido('Pedido inválido.')
  const { data: ped } = await supabase.from('nfe_solicitacoes').select('*').eq('id', id).eq('cliente_id', clienteId).maybeSingle()
  if (!ped) throw new ErroPedido('Pedido não encontrado.')
  if (ped.status === 'cancelada') throw new ErroPedido('Pedido cancelado.')
  const bufPdf = Buffer.from(String(pdf || ''), 'base64')
  const textoXml = Buffer.from(String(xml || ''), 'base64').toString('utf8')
  if (bufPdf.subarray(0, 4).toString() !== '%PDF') throw new ErroPedido('O DANFE precisa ser um arquivo PDF.')
  const nota = dadosXmlNfe(textoXml)
  if (!nota.chave || !nota.numero) throw new ErroPedido('O XML não parece ser de uma NF-e (sem número ou chave).')
  if (!nota.autorizada) throw new ErroPedido('O XML não é de uma nota autorizada (falta o protocolo de autorização).')
  const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
  const cnpj = String(cli?.cnpj || '').replace(/\D/g, '')
  if (cnpj && nota.cnpjEmitente && nota.cnpjEmitente !== cnpj) throw new ErroPedido('O XML é de outra empresa emitente (CNPJ diferente do cadastro).')

  const caminhos = {}
  for (const [ext, conteudo, mime] of [['pdf', bufPdf, 'application/pdf'], ['xml', Buffer.from(textoXml, 'utf8'), 'application/xml']]) {
    const caminho = `nfe-vendas/${ped.id}.${ext}`
    const { error } = await supabase.storage.from('documentos').upload(caminho, conteudo, { contentType: mime, upsert: true })
    if (error) throw error
    caminhos[ext] = caminho
  }
  const agora = new Date().toISOString()
  const { data: atualizado, error } = await supabase.from('nfe_solicitacoes').update({
    status: 'emitida', status_mensagem: null, emitida_em: agora, nfe_numero: nota.numero, nfe_chave: nota.chave,
    nfe_pdf_path: caminhos.pdf, nfe_xml_path: caminhos.xml, atualizado_em: agora,
  }).eq('id', ped.id).select('*, clientes(id, nome, cnpj)').single()
  if (error) throw error

  const aviso = nota.valor != null && Math.abs(nota.valor - Number(ped.valor_total)) > 0.01
    ? `Atenção: o valor da nota (R$ ${nota.valor.toFixed(2)}) é diferente do pedido (R$ ${Number(ped.valor_total).toFixed(2)}).` : undefined
  if (!enviar_whatsapp) return { pedido: atualizado, whatsapp: { ok: false, erro: 'não enviado (desmarcado)' }, aviso }

  const destino = numeroWhatsapp(cli?.whatsapp_entrega || cli?.telefone)
  if (!destino) return { pedido: atualizado, whatsapp: { ok: false, erro: 'Empresa sem WhatsApp de entrega cadastrado (Entregas → Empresas).' }, aviso }
  const nomeDest = ped.destinatario?.nome || ''
  const nome = `NF-e ${nota.numero} ${nomeDest.slice(0, 30)}`.trim()
  const valor = Number(ped.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  let envio = await enviarDocumento(destino, {
    media: bufPdf.toString('base64'), fileName: `${nome}.pdf`, caption: `✅ NF-e ${nota.numero} emitida — ${nomeDest}
Valor: R$ ${valor}`,
  })
  if (envio.sucesso) {
    envio = await enviarDocumento(destino, { media: Buffer.from(textoXml, 'utf8').toString('base64'), fileName: `${nome}.xml`, mimetype: 'application/xml' })
  }
  return { pedido: atualizado, whatsapp: envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro }, aviso }
}

async function mandarResumo(clienteId, ped, opcoes = {}) {
  const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
  const destino = numeroWhatsapp(cli?.whatsapp_entrega || cli?.telefone)
  const agora = new Date().toISOString()
  let envio
  if (!destino) envio = { sucesso: false, erro: 'Empresa sem WhatsApp de entrega cadastrado (Entregas → Empresas).' }
  else envio = await enviarMensagem(destino, resumoWhatsapp(cli.nome, ped, opcoes))
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
