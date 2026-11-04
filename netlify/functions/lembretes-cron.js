// netlify/functions/lembretes-cron.js
//
// Scheduled Function (ver netlify.toml, roda a cada 5 minutos). Varre a
// tabela "lembretes" por lembretes pendentes (enviado=false) cuja data_hora
// já passou, manda um WhatsApp pro grupo do escritório
// (netlify/functions/lib/whatsapp.js) e uma notificação nos aparelhos da
// equipe que ativaram os avisos (lib/gestorPush.js), e marca como enviado.
//
// Variáveis de ambiente necessárias no Netlify: SUPABASE_URL,
// SUPABASE_SERVICE_KEY, WHATSAPP_GROUP_ID, EVOLUTION_API_URL,
// EVOLUTION_API_KEY, EVOLUTION_INSTANCE — todas já configuradas (mesmas
// usadas por whatsapp-webhook.js).

const { createClient } = require('@supabase/supabase-js')
const { enviarMensagem } = require('./lib/whatsapp')
const licencas = require('./lib/licencas')
const { pushConfigurado, notificacaoLembrete, enviarPushEscritorio } = require('./lib/gestorPush')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID

exports.handler = async () => {
  if (!GRUPO_ID && !pushConfigurado()) {
    console.error('Nem WHATSAPP_GROUP_ID nem VAPID configurados — não dá pra enviar lembretes.')
    return { statusCode: 200, body: 'sem canal de envio' }
  }

  const { data: lembretes, error } = await supabase
    .from('lembretes')
    .select(`
      id, mensagem, tarefa_id,
      obrigacoes(titulo, tipo, clientes(nome)),
      tarefas(titulo, clientes(nome))
    `)
    .eq('enviado', false)
    .lte('data_hora', new Date().toISOString())

  if (error) {
    console.error('Erro ao buscar lembretes:', error.message)
    return { statusCode: 500, body: error.message }
  }

  for (const l of lembretes || []) {
    const item = l.obrigacoes || l.tarefas
    const titulo = item?.titulo || item?.tipo || 'Item'
    const cliente = item?.clientes?.nome
    const texto = `🔔 *Lembrete*\n${titulo}${cliente ? `\n👤 ${cliente}` : ''}${l.mensagem ? `\n${l.mensagem}` : ''}`

    // marca antes de enviar: se o envio demorar, a próxima rodada não repete
    await supabase.from('lembretes').update({ enviado: true, enviado_em: new Date().toISOString() }).eq('id', l.id)
    if (GRUPO_ID) await enviarMensagem(GRUPO_ID, texto).catch((e) => console.error('WhatsApp do lembrete falhou:', e.message))
    await enviarPushEscritorio(supabase, notificacaoLembrete(l)).catch((e) => console.error('Aviso no aparelho falhou:', e.message))
  }

  if (!GRUPO_ID) return { statusCode: 200, body: JSON.stringify({ enviados: (lembretes || []).length }) }
  const reunioes = await avisarReunioes()
  const avisosLicencas = await avisarLicencas()

  return { statusCode: 200, body: JSON.stringify({ enviados: (lembretes || []).length, reunioes, licencas: avisosLicencas }) }
}

// Reuniões da Agenda (tabela agenda_eventos, supabase-schema-agenda.sql)
// com lembrete_em vencido. Sem a tabela ainda criada, só registra e segue.
async function avisarReunioes() {
  const { data: eventos, error } = await supabase
    .from('agenda_eventos')
    .select('id, titulo, data, hora, local, clientes(nome)')
    .eq('lembrete_enviado', false)
    .eq('cancelado', false)
    .lte('lembrete_em', new Date().toISOString())
  if (error) {
    console.error('Agenda indisponível:', error.message)
    return 0
  }
  for (const ev of eventos || []) {
    const [a, m, d] = ev.data.split('-')
    const quando = ev.hora ? `${d}/${m}/${a} às ${ev.hora.slice(0, 5)}` : `${d}/${m}/${a}`
    const texto = `📅 *Reunião*\n${ev.titulo}\n🕒 ${quando}` +
      (ev.local ? `\n📍 ${ev.local}` : '') +
      (ev.clientes?.nome ? `\n👤 ${ev.clientes.nome}` : '')
    await enviarMensagem(GRUPO_ID, texto)
    await supabase.from('agenda_eventos').update({ lembrete_enviado: true }).eq('id', ev.id)
  }
  return (eventos || []).length
}

// Alvarás e licenças perto de vencer (tabela licencas,
// supabase-schema-licencas.sql). Só a partir das 8h para não avisar de
// madrugada. Sem a tabela ainda criada, só registra e segue.
async function avisarLicencas(agora = new Date()) {
  if (licencas.horaSaoPaulo(agora) < 8) return 0
  const hoje = licencas.hojeSaoPaulo(agora)
  const limite = new Date(Date.parse(`${hoje}T12:00:00Z`) + 400 * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('licencas')
    .select('*, clientes(nome)')
    .eq('arquivada', false)
    .not('data_validade', 'is', null)
    .lte('data_validade', limite)
  if (error) {
    console.error('Licenças indisponíveis:', error.message)
    return 0
  }
  let enviados = 0
  for (const l of data || []) {
    const p = licencas.avisosPendentes(l, hoje)
    if (!p.enviar) continue
    const campos = { avisos_enviados: [...new Set([...(l.avisos_enviados || []), ...p.marcar])] }
    if (licencas.deveCriarTarefa(l, p)) {
      const { data: tarefa, error: errTarefa } = await supabase.from('tarefas').insert(licencas.dadosTarefa(l, p.dias)).select('id').single()
      if (errTarefa) console.error('Tarefa da licença não criada:', errTarefa.message)
      else campos.tarefa_id = tarefa.id
    }
    await enviarMensagem(GRUPO_ID, licencas.textoAviso(l, p.dias))
    await supabase.from('licencas').update(campos).eq('id', l.id)
    enviados++
  }
  return enviados
}
