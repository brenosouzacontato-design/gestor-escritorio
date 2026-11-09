// netlify/functions/guias-aviso-cron.js
//
// Scheduled Function (netlify.toml, a cada 5 min): toda guia anexada vira um
// aviso no WhatsApp do cliente com o link curto do painel. Pega as guias
// confirmadas nas últimas horas (documentos de obrigação que é imposto, ou de
// parcelamento) que ainda não foram entregues nem avisadas, agrupa por
// empresa (várias guias anexadas juntas = uma mensagem só) e:
//   - deu certo: marca entregue (entrega_canal 'painel') — na Central de
//     Entregas a guia aparece "entregue" e, quando o cliente abre/baixa pelo
//     painel (painel-evento.js), "aberta";
//   - falhou: grava entrega_erro (a Central mostra "falhou" e dá pra reenviar).
// Fica de fora (segue "a entregar" na Central): empresa com o painel
// desligado, com o aviso automático desligado (clientes.aviso_guia_painel)
// ou sem WhatsApp de entrega.
// Colunas em supabase-schema-aviso-guia-painel.sql.
//
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_KEY,
// EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE (as de sempre) e,
// opcional, PAINEL_URL_BASE (sem ela vale a URL principal do site).

const { createClient } = require('@supabase/supabase-js')
const { enviarMensagem, numeroWhatsapp } = require('./lib/whatsapp')
const { linkCurtoPainel } = require('./lib/linkCurtoPainel')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Só guias recentes: no 1º deploy não dispara aviso de guia antiga, e uma
// falha longa do cron não vira enxurrada de mensagens depois.
const JANELA_HORAS = 6
// Espera a guia "assentar" antes de avisar: várias anexadas em sequência
// saem numa mensagem só.
const ESPERA_MIN = 2

// Mesma regra do painel (PainelCompartilhadoPage.jsx → ehImposto): anexo de
// obrigação que não é imposto (ex: holerite) não é guia a pagar.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS', 'INSS MENSAL',
])
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i
function ehImposto(o) {
  return !!o && (o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`))
}

exports.handler = async () => {
  const agora = Date.now()
  const desde = new Date(agora - JANELA_HORAS * 60 * 60 * 1000).toISOString()
  const ate = new Date(agora - ESPERA_MIN * 60 * 1000).toISOString()

  const consultar = (comParcelamento) => supabase.from('documentos')
    .select('id, cliente_id, nome_arquivo, obrigacao_id, valor_guia, vencimento_guia, confirmado_em, '
      // clientes(*): painel_token só existe depois de supabase-rls-01 — sem ele o link vai com o id
      + 'clientes(*), '
      + 'obrigacoes(titulo, tipo, competencia, vencimento, tipos_obrigacao(eh_imposto))'
      + (comParcelamento ? ', parcelamento_id, parcelamentos(origem, descricao)' : ''))
    .eq('status', 'confirmado')
    .is('entregue_em', null)
    .is('aviso_painel_em', null)
    .gte('confirmado_em', desde)
    .lte('confirmado_em', ate)
  let { data, error } = await consultar(true)
  // banco sem o módulo de parcelamentos: segue só com as guias de obrigação
  if (error && /parcelamento/i.test(error.message || '')) ({ data, error } = await consultar(false))
  if (error) {
    // colunas novas ainda não criadas: não há o que fazer até rodar o SQL
    console.error('guias-aviso-cron:', error.message)
    return { statusCode: 200, body: error.message }
  }

  const guias = (data || []).filter((d) => d.clientes && (d.parcelamento_id || ehImposto(d.obrigacoes)))
  const porEmpresa = new Map()
  for (const g of guias) {
    if (!porEmpresa.has(g.cliente_id)) porEmpresa.set(g.cliente_id, [])
    porEmpresa.get(g.cliente_id).push(g)
  }

  let enviadas = 0
  for (const lista of porEmpresa.values()) {
    const cliente = lista[0].clientes
    const ids = lista.map((g) => g.id)
    const marcadoEm = new Date().toISOString()
    // painel/aviso desligado ou empresa inativa: marca como processada (sem
    // entregar) pra não reavaliar a cada 5 min — a Central segue "a entregar"
    if (cliente.ativo === false || cliente.painel_ativo === false || cliente.aviso_guia_painel === false) {
      await supabase.from('documentos').update({ aviso_painel_em: marcadoEm }).in('id', ids)
      continue
    }
    const destino = numeroWhatsapp(cliente.whatsapp_entrega || cliente.telefone)
    // sem WhatsApp: a Central já mostra "sem WhatsApp — cadastre"; só não reavalia
    if (!destino) {
      await supabase.from('documentos').update({ aviso_painel_em: marcadoEm }).in('id', ids)
      continue
    }

    try {
      const link = await linkCurtoPainel(supabase, cliente)
      const envio = await enviarMensagem(destino, mensagem(cliente, lista, link))
      const patch = envio.sucesso
        ? { aviso_painel_em: marcadoEm, entregue_em: marcadoEm, entrega_canal: 'painel', entrega_destino: destino, entrega_erro: null }
        : { aviso_painel_em: marcadoEm, entrega_erro: `${marcadoEm.slice(0, 10)}: ${envio.erro}`.slice(0, 300) }
      const { error: errMarca } = await supabase.from('documentos').update(patch).in('id', ids)
      if (errMarca) throw errMarca
      if (envio.sucesso) enviadas += lista.length
    } catch (e) {
      console.error(`guias-aviso-cron (${cliente.nome}):`, e.message)
      await supabase.from('documentos').update({
        aviso_painel_em: marcadoEm, entrega_erro: `${marcadoEm.slice(0, 10)}: ${e.message}`.slice(0, 300),
      }).in('id', ids)
    }
  }

  return { statusCode: 200, body: `${enviadas} guia(s) avisada(s)` }
}

function tituloGuia(g) {
  if (g.obrigacoes) return g.obrigacoes.titulo || g.obrigacoes.tipo || 'Guia'
  if (g.parcelamentos) return `Parcelamento ${g.parcelamentos.origem || ''}`.trim()
  return 'Guia'
}

function fmtData(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function mensagem(cliente, lista, link) {
  const nome = String(cliente.nome || '').replace(/^[\d./-]+\s+/, '')
  const linhas = [
    lista.length === 1
      ? `Olá! Uma nova guia de *${nome}* já está disponível no seu painel:`
      : `Olá! ${lista.length} novas guias de *${nome}* já estão disponíveis no seu painel:`,
    '',
  ]
  const ordenadas = [...lista].sort((a, b) => String(a.vencimento_guia || a.obrigacoes?.vencimento || '9999')
    .localeCompare(String(b.vencimento_guia || b.obrigacoes?.vencimento || '9999')))
  for (const g of ordenadas) {
    const venc = g.vencimento_guia || g.obrigacoes?.vencimento
    const comp = g.obrigacoes?.competencia
    const partes = [`• *${tituloGuia(g)}*${comp ? ` (${comp})` : ''}`]
    if (venc) partes.push(`vence ${fmtData(venc)}`)
    if (g.valor_guia != null) partes.push(Number(g.valor_guia).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
    linhas.push(partes.join(' · '))
  }
  linhas.push('', `Acesse para ver o valor, baixar a guia ou copiar o código de pagamento:`, link)
  return linhas.join('\n')
}
