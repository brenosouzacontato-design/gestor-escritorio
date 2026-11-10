// netlify/functions/painel-aviso-enviar.js
//
// Aviso no WhatsApp do cliente com o link curto do painel, quando o
// escritório pede: ao concluir a edição do painel, pelo botão "Notificar
// cliente" do painel ou na pergunta que aparece ao anexar uma guia nova.
// (Antes saía sozinho a cada guia anexada — guias-aviso-cron, desligado.)
//
//   POST { clienteId, simular?, forcar? }
//     simular: só monta a prévia (mensagem, destino, guias) e não envia
//     forcar:  envia mesmo no horário de silêncio (19h–7h)
//   → { ok, enviada, destino, guias: [{id, titulo}], generica, mensagem, silencio } | { error }
//     generica: havia guia paga ou de competência anterior pendente de entrega,
//     então a mensagem não lista guias (só avisa que o painel foi atualizado)
//
// Deu certo: as guias da mensagem ficam entregues (entrega_canal 'painel') —
// a Central de Entregas mostra "entregue" e, quando o cliente abre/baixa pelo
// painel, "aberta". Falhou: grava entrega_erro nelas.
// Exige login do escritório.

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio } = require('./lib/autenticacao')
const { enviarMensagem, numeroWhatsapp, horarioDeSilencio } = require('./lib/whatsapp')
const { linkCurtoPainel } = require('./lib/linkCurtoPainel')
const { guiasNovas, mensagemAviso, tituloGuia, nomeCurto } = require('./lib/avisoPainel')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resposta(405, { error: 'Método não permitido, use POST.' })
  const negado = await exigirEscritorio(event, 'painel-aviso-enviar')
  if (negado) return negado

  let clienteId, simular, forcar
  try {
    const body = JSON.parse(event.body || '{}')
    clienteId = body.clienteId
    simular = !!body.simular
    forcar = !!body.forcar
  } catch {
    return resposta(400, { error: 'Body inválido.' })
  }
  if (!UUID.test(clienteId || '')) return resposta(400, { error: 'Empresa inválida.' })

  try {
    const { data: cliente, error } = await supabase.from('clientes').select('*').eq('id', clienteId).maybeSingle()
    if (error) throw error
    if (!cliente) return resposta(404, { error: 'Empresa não encontrada.' })
    if (cliente.painel_ativo === false) return resposta(400, { error: `${nomeCurto(cliente.nome)}: o painel está desligado (aba Empresas da Central).` })

    const destino = numeroWhatsapp(cliente.whatsapp_entrega || cliente.telefone)
    const { guias, generica } = await guiasNovas(supabase, clienteId)
    const silencio = horarioDeSilencio()
    const previa = {
      destino, silencio, generica,
      guias: guias.map((g) => ({ id: g.id, titulo: tituloGuia(g), vencimento: g.vencimento_guia || g.obrigacoes?.vencimento || null, valor: g.valor_guia })),
    }
    if (simular) {
      // o link curto é criado no envio; na prévia vai um marcador
      return resposta(200, { ok: true, enviada: false, ...previa, mensagem: mensagemAviso(cliente, guias, '(link do painel)', { generica }) })
    }
    if (!destino) return resposta(400, { error: `${nomeCurto(cliente.nome)}: sem WhatsApp de entrega. Cadastre o número na aba Empresas da Central.` })
    if (silencio && !forcar) return resposta(409, { error: 'Horário de silêncio (19h às 7h): confirme para enviar mesmo assim.', silencio: true })

    const link = await linkCurtoPainel(supabase, cliente)
    const mensagem = mensagemAviso(cliente, guias, link, { generica })
    const envio = await enviarMensagem(destino, mensagem)
    const agora = new Date().toISOString()
    if (guias.length) {
      const patch = envio.sucesso
        ? { aviso_painel_em: agora, entregue_em: agora, entrega_canal: 'painel', entrega_destino: destino, entrega_erro: null }
        : { aviso_painel_em: agora, entrega_erro: `${agora.slice(0, 10)}: ${envio.erro}`.slice(0, 300) }
      const { error: errMarca } = await supabase.from('documentos').update(patch).in('id', guias.map((g) => g.id))
      if (errMarca) throw errMarca
    }
    if (!envio.sucesso) return resposta(502, { error: envio.erro })
    return resposta(200, { ok: true, enviada: true, ...previa, mensagem })
  } catch (e) {
    console.error('painel-aviso-enviar:', e.message)
    return resposta(500, { error: e.message })
  }
}

function resposta(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
