// netlify/functions/nfse-whatsapp-background.js
//
// Emite a NFS-e pedida no grupo "Documentos" do WhatsApp, depois do "sim" à
// prévia (whatsapp-webhook.js → processarConfirmacaoNfse; regras em
// lib/nfseWhatsapp.js). A emissão é a mesma da tela Emitir NFS-e
// (nfse.js → emitirPedidoWhatsapp). Nota autorizada em produção vai também
// para o WhatsApp da empresa, como na tela.
//
// Background Function (sufixo -background): a Sefin pode demorar, e o
// webhook precisa responder logo. Corpo: { pedidoId, remoteJid }. Só a
// própria aplicação chama (cabeçalho x-segredo-interno, lib/autenticacao.js).

const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio } = require('./lib/autenticacao')
const { enviarMensagem } = require('./lib/whatsapp')
const { ESTADOS } = require('./lib/nfseWhatsapp')
const { emitirPedidoWhatsapp, enviarNotaWhatsappEmpresa } = require('./nfse')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function marcar(pedidoId, campos) {
  const { error } = await supabase.from('nfse_whatsapp_pedidos').update({ ...campos, decidido_em: new Date().toISOString() }).eq('id', pedidoId)
  if (error) console.error('nfse-whatsapp-background: falha ao marcar o pedido:', error.message)
}

exports.handler = async (event) => {
  if (await exigirEscritorio(event, 'nfse-whatsapp-background')) return

  let pedidoId, remoteJid
  try {
    ({ pedidoId, remoteJid } = JSON.parse(event.body || '{}'))
  } catch {
    console.error('nfse-whatsapp-background: corpo inválido')
    return
  }
  if (!pedidoId) return

  const { data: pedido, error } = await supabase.from('nfse_whatsapp_pedidos').select('*').eq('id', pedidoId).maybeSingle()
  if (error || !pedido) {
    console.error('nfse-whatsapp-background: pedido não encontrado:', error?.message || pedidoId)
    return
  }
  if (pedido.estado !== ESTADOS.EMITINDO) {
    console.log('nfse-whatsapp-background: pedido fora do estado "emitindo", ignorado:', pedido.estado)
    return
  }
  const d = pedido.dados || {}
  const destino = remoteJid || pedido.remote_jid

  try {
    const { resultado, nota } = await emitirPedidoWhatsapp(d, { remetente: pedido.remetente })
    console.log('nfse-whatsapp-background:', JSON.stringify({ pedidoId, notaId: nota?.id, estado: resultado?.estado }))

    if (resultado?.estado !== 'autorizada') {
      const msg = resultado?.mensagem || resultado?.estado || 'sem resposta da Sefin'
      await marcar(pedido.id, { estado: ESTADOS.ERRO, nota_id: nota?.id || null, mensagem: msg.slice(0, 1000) })
      const situacao = resultado?.estado === 'indeterminada'
        ? '⏳ *A Sefin não confirmou a NFS-e ainda.*'
        : '❌ *NFS-e rejeitada pela Sefin.*'
      if (destino) await enviarMensagem(destino, `${situacao}\n🏢 ${d.empresa_nome}\n👤 ${d.nome} — ${brl(d.valor)}\n${msg.slice(0, 500)}\nConfira em Gestor → Emitir NFS-e (a nota ficou lá).`)
      return
    }

    await marcar(pedido.id, { estado: ESTADOS.EMITIDA, nota_id: nota.id, mensagem: null })

    let entrega = ''
    if (nota.ambiente === 'producao') {
      try {
        const r = await enviarNotaWhatsappEmpresa(nota.id)
        entrega = `\n📲 PDF e XML enviados no WhatsApp da empresa (${r.destino}).`
      } catch (e) {
        entrega = `\n⚠️ Não enviei ao WhatsApp da empresa: ${e.message}. Baixe em Emitir NFS-e.`
      }
    } else {
      entrega = '\n🧪 Homologação (teste): a nota não tem validade e não foi enviada à empresa.'
    }
    if (destino) {
      await enviarMensagem(destino, `✅ *NFS-e nº ${nota.numero_nfse || '—'} emitida!*\n🏢 ${d.empresa_nome}\n👤 ${nota.nome}\n💰 ${brl(nota.valor)}${entrega}`)
    }
  } catch (e) {
    console.error('nfse-whatsapp-background:', e.message)
    await marcar(pedido.id, { estado: ESTADOS.ERRO, mensagem: String(e.message).slice(0, 1000) })
    if (destino) await enviarMensagem(destino, `❌ *Não emiti a NFS-e* de ${d.nome} (${d.empresa_nome}): ${e.message}\nPeça de novo depois de corrigir, ou emita pela tela Emitir NFS-e.`)
  }
}
