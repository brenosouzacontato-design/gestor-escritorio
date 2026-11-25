// netlify/functions/lib/nfse/agendamentos.js
//
// Emissão agendada de NFS-e a partir de um modelo recorrente (tabela nfse_agendamentos,
// supabase-schema-nfse-agendamentos.sql). O escritório escolhe o modelo, o dia e a hora, o valor e a
// data do serviço; o robô nfse-agendamentos-cron (a cada 5 minutos) pega os que venceram e emite com a
// mesma ação da tela (recorrente_emitir, em nfse.js) — mesmas travas de duplicidade, ambiente e
// validação. Se marcado, a nota autorizada de produção vai no WhatsApp da empresa (PDF e XML).
//
// Horário: o que vem da tela (AAAA-MM-DDTHH:mm) é hora de Brasília (UTC-3, sem horário de verão).
// tipo 'periodo': a nota da semana/mês do modelo em que cai a data do serviço.
// tipo 'avulsa' : nota extra com os dados do modelo (não conta como a nota do período).

const { hojeBrasilia } = require('./validador')
const recorrentes = require('./recorrentes')

const TIPOS = ['periodo', 'avulsa']
const MAX_DIAS_FRENTE = 400
// "processando" há mais que isso: a execução caiu no meio (a nota pode ou não ter saído)
const TRAVADO_MS = 10 * 60 * 1000

// 'AAAA-MM-DDTHH:mm' (Brasília) ou ISO com fuso → Date; null se inválido
function quando(valor) {
  const s = String(valor || '').trim()
  let d
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) d = new Date(`${s.length === 16 ? `${s}:00` : s}-03:00`)
  else if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(s)) d = new Date(s)
  else return null
  return Number.isNaN(d.getTime()) ? null : d
}

// "25/11/2026 às 14:30" (Brasília)
function quandoBR(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString()
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} às ${d.slice(11, 16)}`
}

// Valor em reais: "1.234,56", "1234,56", 1234.56 → número; null se inválido
function lerValor(v) {
  if (typeof v === 'number') return v > 0 ? Math.round(v * 100) / 100 : null
  const s = String(v ?? '').replace(/r\$|\s/gi, '')
  if (!/^[\d.,]+$/.test(s)) return null
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return n > 0 ? Math.round(n * 100) / 100 : null
}

// Dados vindos da tela, validados contra o modelo. Devolve { campos } ou { erro }.
// Não confere notas já emitidas (isso é com quem chama, que tem o banco).
function validarAgendamento(p, { modelo, ambiente, agora = new Date() }) {
  const em = quando(p.executar_em)
  if (!em) return { erro: 'Informe o dia e a hora da emissão' }
  if (em.getTime() < agora.getTime() - 60 * 1000) return { erro: 'O horário da emissão já passou' }
  if (em.getTime() > agora.getTime() + MAX_DIAS_FRENTE * 86400000) return { erro: 'Agende para no máximo um ano à frente' }
  const diaExecucao = hojeBrasilia(em)
  const valor = lerValor(p.valor)
  if (valor === null) return { erro: 'Informe o valor da nota' }
  const tipo = p.tipo ? String(p.tipo) : 'periodo'
  if (!TIPOS.includes(tipo)) return { erro: 'Tipo inválido (nota do período ou avulsa)' }
  const dataServico = String(p.data_servico || '').trim() || diaExecucao
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataServico)) return { erro: 'Data do serviço inválida' }
  if (dataServico > diaExecucao) return { erro: 'A data do serviço não pode ser depois do dia da emissão' }
  const periodo = recorrentes.periodoDaData(modelo, dataServico)
  const mensal = recorrentes.ehMensal(modelo)
  if (tipo === 'periodo' && modelo.inicio && periodo.inicio < recorrentes.inicioDoPeriodo(modelo.inicio, modelo.periodicidade)) {
    return { erro: `A data do serviço é de antes do ${mensal ? 'primeiro mês' : 'início'} do modelo; agende como nota avulsa` }
  }
  return {
    campos: {
      cliente_id: modelo.cliente_id,
      recorrente_id: modelo.id,
      ambiente,
      executar_em: em.toISOString(),
      tipo,
      periodo: periodo.inicio,
      data_servico: dataServico,
      valor,
      descricao: String(p.descricao ?? '').trim().slice(0, 2000) || null,
      enviar_whatsapp: p.enviar_whatsapp !== false,
    },
  }
}

class ErroAgendamento extends Error {}
const SEM_TABELA = 'Para agendar emissões, falta rodar supabase-schema-nfse-agendamentos.sql no SQL Editor do Supabase.'
const semTabela = (error) => !!error && /nfse_agendamentos|avisar_jid|42P01/i.test(`${error.code || ''} ${error.message || ''}`)

// Valida, confere com o banco e (com gravar) grava o agendamento. Usado pela tela (ação
// agendamento_criar) e pelo grupo do WhatsApp (depois do "sim" à prévia). Sem gravar, só confere.
//   empresa: nfse_empresas; modelo: nfse_recorrentes; p: { executar_em, valor, data_servico?, tipo?, descricao?, enviar_whatsapp? }
// Devolve os campos (e o id, se gravou). Lança ErroAgendamento com a mensagem para quem pediu.
async function criarAgendamento(db, { empresa, modelo, p, criadoPor = '', avisarJid = null, agora = new Date(), gravar = true }) {
  if (!modelo || modelo.cliente_id !== empresa.cliente_id) throw new ErroAgendamento('Modelo não encontrado')
  if (!modelo.ativo) throw new ErroAgendamento('Modelo desativado')
  const { campos, erro } = validarAgendamento(p, { modelo, ambiente: empresa.ambiente, agora })
  if (erro) throw new ErroAgendamento(erro)
  const mensal = recorrentes.ehMensal(modelo)
  if (campos.tipo === 'periodo') {
    const nomePeriodo = mensal ? 'Este mês' : 'Esta semana'
    const { data: notas, error } = await db.from('nfse_notas').select('id, estado, data')
      .eq('recorrente_id', modelo.id).eq('ambiente', empresa.ambiente)
    if (error) throw new Error(error.message)
    const periodo = recorrentes.periodoDaData(modelo, campos.data_servico)
    if ((notas || []).some((n) => recorrentes.naSemana(n.data, periodo) && recorrentes.FEITAS.includes(n.estado))) {
      throw new ErroAgendamento(`${nomePeriodo} de ${modelo.nome} já tem nota emitida (para outra nota, agende como avulsa)`)
    }
    const { data: outros, error: e2 } = await db.from('nfse_agendamentos').select('id, executar_em')
      .eq('recorrente_id', modelo.id).eq('situacao', 'agendada').eq('periodo', campos.periodo).eq('tipo', 'periodo')
    if (semTabela(e2)) throw new ErroAgendamento(SEM_TABELA)
    if (e2) throw new Error(e2.message)
    if ((outros || []).length) {
      throw new ErroAgendamento(`${nomePeriodo} de ${modelo.nome} já tem emissão agendada para ${quandoBR(outros[0].executar_em)}`)
    }
  }
  const registro = { ...campos, situacao: 'agendada', criado_por: String(criadoPor || '').slice(0, 150) || null }
  if (avisarJid) registro.avisar_jid = avisarJid
  if (!gravar) return registro
  const { data, error } = await db.from('nfse_agendamentos').insert(registro).select('id')
  if (semTabela(error)) throw new ErroAgendamento(SEM_TABELA)
  if (error) throw new Error(error.message)
  return { ...registro, id: data && data[0] && data[0].id }
}

const resumo = (a) => ({
  id: a.id, recorrente_id: a.recorrente_id, executar_em: a.executar_em, tipo: a.tipo, periodo: a.periodo,
  data_servico: a.data_servico, valor: Number(a.valor), descricao: a.descricao || '', enviar_whatsapp: a.enviar_whatsapp,
  situacao: a.situacao, nota_id: a.nota_id || null, mensagem: a.mensagem || '', envio: a.envio || '',
  ambiente: a.ambiente, criado_por: a.criado_por || '', executado_em: a.executado_em || null,
})

// Executa os agendamentos vencidos, um por vez, até acabar o prazo (a scheduled function tem 30 s
// e cada emissão pode levar ~10 s). Os que sobrarem saem na próxima rodada.
//   emitir(ag) → { resultado, nota }   (lança Error com a mensagem se a nota não sair)
//   enviar(notaId) → { destino }      (lança Error se o WhatsApp falhar)
//   avisar(ag, fim) → opcional: avisa quem agendou (ex.: o grupo do WhatsApp, avisar_jid); falha não para nada
async function executarPendentes({ db, emitir, enviar, avisar = null, agora = () => new Date(), prazoMs = 18000 }) {
  const inicio = Date.now()
  const saida = { executados: 0, emitidos: 0, erros: 0, travados: 0 }

  // Execução que caiu no meio: não tenta de novo sozinha (a nota pode ter saído)
  const { data: proc, error: e0 } = await db.from('nfse_agendamentos').select('id, executado_em').eq('situacao', 'processando')
  if (e0) throw new Error(e0.message)
  for (const a of proc || []) {
    if (a.executado_em && agora().getTime() - new Date(a.executado_em).getTime() < TRAVADO_MS) continue
    await db.from('nfse_agendamentos').update({
      situacao: 'erro', mensagem: 'A execução foi interrompida no meio. Confira a nota em Emitir NFS-e antes de emitir de novo.',
    }).eq('id', a.id).eq('situacao', 'processando')
    saida.travados += 1
  }

  const { data, error } = await db.from('nfse_agendamentos').select('*').eq('situacao', 'agendada')
    .lte('executar_em', agora().toISOString()).order('executar_em')
  if (error) throw new Error(error.message)
  const fila = (data || []).sort((a, b) => String(a.executar_em).localeCompare(String(b.executar_em)))

  for (const ag of fila) {
    if (Date.now() - inicio > prazoMs) break
    // pega o agendamento só se ainda estiver "agendada" (outra rodada ou um cancelamento não colidem)
    const { data: pego, error: e1 } = await db.from('nfse_agendamentos')
      .update({ situacao: 'processando', executado_em: agora().toISOString() })
      .eq('id', ag.id).eq('situacao', 'agendada').select('id')
    if (e1) throw new Error(e1.message)
    if (!pego || !pego.length) continue
    saida.executados += 1

    let fim
    try {
      const { resultado, nota } = await emitir(ag)
      if (resultado && resultado.estado === 'autorizada') {
        fim = { situacao: 'emitida', nota_id: nota.id, mensagem: `NFS-e nº ${nota.numero_nfse || '?'} emitida` }
        if (ag.enviar_whatsapp && ag.ambiente === 'producao') {
          try {
            const r = await enviar(nota.id)
            fim.envio = `Enviada no WhatsApp da empresa (${r.destino})`
          } catch (e) {
            fim.envio = `WhatsApp não enviado: ${e.message}`
          }
        }
        saida.emitidos += 1
      } else {
        fim = {
          situacao: 'erro', nota_id: nota ? nota.id : null,
          mensagem: (resultado && resultado.mensagem) || `Situação: ${resultado ? resultado.estado : '?'}. Confira em Emitir NFS-e.`,
        }
        saida.erros += 1
      }
    } catch (e) {
      fim = { situacao: 'erro', mensagem: String(e.message || e).slice(0, 1000) }
      saida.erros += 1
    }
    const { error: e2 } = await db.from('nfse_agendamentos').update(fim).eq('id', ag.id)
    if (e2) console.error('nfse agendamento: não gravou o resultado', ag.id, e2.message)
    if (avisar) {
      try { await avisar(ag, fim) } catch (e) { console.error('nfse agendamento: aviso não enviado', ag.id, e.message) }
    }
  }
  return saida
}

module.exports = {
  quando, quandoBR, lerValor, validarAgendamento, criarAgendamento, executarPendentes, resumo,
  ErroAgendamento, SEM_TABELA, semTabela, TIPOS, TRAVADO_MS,
}
