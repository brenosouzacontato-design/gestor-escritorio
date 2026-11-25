// Emissão agendada de NFS-e a partir de um modelo recorrente (Emitir NFS-e → Notas recorrentes →
// "Agendar"). O escritório escolhe o dia e a hora, o valor e a data do serviço; o robô
// nfse-agendamentos-cron emite na hora marcada (mesmas regras da emissão pela tela) e manda o PDF e o
// XML no WhatsApp da empresa, se marcado. Também dá para agendar pelo grupo Documentos do WhatsApp:
// "agendar nfse <empresa> <modelo> <valor> <dd/mm> <hh:mm>".
// Servidor: ações agendamento_* (netlify/functions/nfse.js, lib/nfse/agendamentos.js).
import { useState } from 'react'
import { AlarmClockIcon, XIcon } from 'lucide-react'
import { chamarNfse } from './nfseApi'
import { descricaoNaData, rotuloPeriodo } from './NotaRecorrenteCard'

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const rotulo = { fontSize: 11, color: 'var(--text3)', fontWeight: 600 }
const campo = { width: '100%', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }

// Data/hora em Brasília (o escritório usa o gestor no fuso de Brasília)
const BRASILIA = 'America/Sao_Paulo'
export function agoraBrasilia(somarMin = 0) {
  const d = new Date(Date.now() + somarMin * 60000)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: BRASILIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export const amanhaAs9 = () => {
  const d = new Date(`${agoraBrasilia().slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return `${d.toISOString().slice(0, 10)}T09:00`
}
// "25/11/2026 às 14:30" (Brasília)
export function quandoBR(iso) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString()
  return `${dataBR(d.slice(0, 10))} às ${d.slice(11, 16)}`
}

// Formulário do agendamento. modelo: {id, nome, cpf, descricao, valor, periodicidade}; onPronto() depois de agendar.
export default function AgendarEmissao({ clienteId, ambiente, modelo, onPronto, onFechar }) {
  const inicial = amanhaAs9()
  const [quando, setQuando] = useState(inicial)
  const [valor, setValor] = useState(valorBR(modelo.valor))
  const [dataServico, setDataServico] = useState(inicial.slice(0, 10))
  const [dataEditada, setDataEditada] = useState(false)
  const [tipo, setTipo] = useState('periodo')
  const [descricao, setDescricao] = useState('')
  const [enviarWhats, setEnviarWhats] = useState(true)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState(null)
  const teste = ambiente !== 'producao'
  const mensal = modelo.periodicidade === 'mensal'
  const descricaoPadrao = dataServico ? descricaoNaData(modelo, dataServico) : ''

  function mudarQuando(v) {
    setQuando(v)
    // a data do serviço acompanha o dia da emissão, até a pessoa mexer nela
    if (!dataEditada && /^\d{4}-\d{2}-\d{2}/.test(v)) setDataServico(v.slice(0, 10))
  }

  function revisar() {
    setMsg(null)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(quando)) return setMsg('Informe o dia e a hora da emissão')
    if (quando.slice(0, 16) <= agoraBrasilia()) return setMsg('Escolha um horário no futuro')
    if (!String(valor).trim()) return setMsg('Digite o valor da nota')
    if (!dataServico) return setMsg('Informe a data do serviço')
    if (dataServico > quando.slice(0, 10)) return setMsg('A data do serviço não pode ser depois do dia da emissão')
    setConfirmando(true)
  }

  async function agendar() {
    setSalvando(true)
    setMsg(null)
    try {
      const r = await chamarNfse('agendamento_criar', {
        cliente_id: clienteId, recorrente_id: modelo.id, ambiente, executar_em: quando.slice(0, 16), valor,
        data_servico: dataServico, tipo, descricao: descricao.trim(), enviar_whatsapp: enviarWhats,
      })
      onPronto?.(`NFS-e de ${modelo.nome} agendada para ${quandoBR(r.executar_em)}`)
    } catch (e) {
      setMsg(e.message)
      setConfirmando(false)
    } finally { setSalvando(false) }
  }

  const periodoTexto = dataServico ? rotuloPeriodo(modelo.periodicidade, ...(() => {
    if (mensal) return [`${dataServico.slice(0, 7)}-01`, dataServico]
    const d = new Date(`${dataServico}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const ini = d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 6)
    return [ini, d.toISOString().slice(0, 10)]
  })()) : ''

  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: 10, padding: '10px 12px', margin: '8px 0', background: 'var(--surface)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlarmClockIcon size={14} /><b>Agendar emissão</b><span style={{ color: 'var(--text2)' }}>· {modelo.nome}</span>
        {teste && <span className="badge badge-warn" style={{ fontSize: 10 }}>homologação</span>}
        <button type="button" className="btn btn-icon btn-ghost" style={{ marginLeft: 'auto' }} title="Fechar" disabled={salvando} onClick={onFechar}><XIcon size={14} /></button>
      </div>

      {!confirmando && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
            <label><div style={rotulo}>Emitir em (horário de Brasília)</div>
              <input type="datetime-local" style={campo} value={quando} min={agoraBrasilia()} onChange={(e) => mudarQuando(e.target.value)} /></label>
            <label><div style={rotulo}>Valor R$</div>
              <input style={{ ...campo, textAlign: 'right' }} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" /></label>
            <label><div style={rotulo}>Data do serviço</div>
              <input type="date" style={campo} value={dataServico} max={quando.slice(0, 10)} onChange={(e) => { setDataEditada(true); setDataServico(e.target.value) }} /></label>
            <label><div style={rotulo}>Conta como</div>
              <select style={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="periodo">A nota {mensal ? 'do mês' : 'da semana'} ({periodoTexto.toLowerCase()})</option>
                <option value="avulsa">Nota avulsa (extra)</option>
              </select></label>
            <label style={{ gridColumn: '1 / -1' }}><div style={rotulo}>Descrição (vazio = a do modelo)</div>
              <textarea style={{ ...campo, minHeight: 48, resize: 'vertical' }} value={descricao} placeholder={descricaoPadrao} onChange={(e) => setDescricao(e.target.value)} /></label>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12 }}>
            <input type="checkbox" checked={enviarWhats} onChange={(e) => setEnviarWhats(e.target.checked)} />
            Depois de emitida, mandar o PDF e o XML no WhatsApp da empresa{teste ? ' (em homologação não é enviada)' : ''}
          </label>
          {msg && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="btn btn-accent" onClick={revisar}><AlarmClockIcon size={13} /> Revisar e agendar</button>
            <button type="button" className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          </div>
        </>
      )}

      {confirmando && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--surface2)', lineHeight: 1.6 }}>
          <div>Emitir em <b>{quandoBR(`${quando.slice(0, 16)}:00-03:00`)}</b>{teste && <b style={{ color: 'var(--warn)' }}> · homologação (teste)</b>}</div>
          <div>Tomador: <b>{modelo.nome}</b> · {tipo === 'periodo' ? periodoTexto : 'nota avulsa'}</div>
          <div>Valor: <b>{brl(String(valor).includes(',') ? String(valor).replace(/\./g, '').replace(',', '.') : valor)}</b> · data do serviço {dataBR(dataServico)}</div>
          <div style={{ color: 'var(--text2)', fontSize: 12 }}>{descricao.trim() || descricaoPadrao}</div>
          <div style={{ color: 'var(--text2)', fontSize: 12 }}>{enviarWhats && !teste ? 'Vai no WhatsApp da empresa depois de emitida.' : 'Não vai no WhatsApp da empresa.'}</div>
          {msg && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-accent" disabled={salvando} onClick={agendar}>{salvando ? 'Agendando…' : 'Confirmar agendamento'}</button>
            <button type="button" className="btn btn-ghost" disabled={salvando} onClick={() => setConfirmando(false)}>Voltar</button>
          </div>
        </div>
      )}
    </div>
  )
}

const SITUACAO = {
  agendada: { texto: 'Agendada', cor: 'var(--accent)' },
  processando: { texto: 'Emitindo…', cor: 'var(--warn)' },
  emitida: { texto: 'Emitida', cor: 'var(--success, #16a34a)' },
  erro: { texto: 'Não saiu', cor: 'var(--danger)' },
  cancelada: { texto: 'Cancelada', cor: 'var(--text3)' },
}

// Lista dos agendamentos de um modelo: os que vão sair (com cancelar) e os últimos executados.
// cancelarCom(a): outra forma de cancelar (a tela NFS-e MEI usa a function nfse-mei)
export function ListaAgendamentos({ clienteId, lista, onMudou, onErro, cancelarCom = null }) {
  const [cancelando, setCancelando] = useState(null)
  if (!lista?.length) return null
  async function cancelar(a) {
    setCancelando(a.id)
    try {
      if (cancelarCom) await cancelarCom(a)
      else await chamarNfse('agendamento_cancelar', { cliente_id: clienteId, id: a.id })
      await onMudou?.()
    } catch (e) { onErro?.(e.message) } finally { setCancelando(null) }
  }
  return (
    <div style={{ marginTop: 6 }}>
      {lista.map((a) => {
        const s = SITUACAO[a.situacao] || { texto: a.situacao, cor: 'var(--text3)' }
        return (
          <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--border)' }}>
            <AlarmClockIcon size={12} />
            <span>{quandoBR(a.executar_em)}</span>
            <b>{brl(a.valor)}</b>
            <span style={{ color: 'var(--text3)' }}>{a.tipo === 'mei' ? `competência ${dataBR(a.data_servico)}` : `${a.tipo === 'avulsa' ? 'avulsa' : 'do período'} · serviço ${dataBR(a.data_servico)}`}</span>
            <span style={{ color: s.cor, fontWeight: 600 }}>{s.texto}</span>
            {(a.mensagem || a.envio) && a.situacao !== 'agendada' && <span style={{ color: 'var(--text2)' }}>{[a.mensagem, a.envio].filter(Boolean).join(' · ')}</span>}
            {a.criado_por && <span style={{ color: 'var(--text3)' }}>por {a.criado_por}</span>}
            {a.situacao === 'agendada' && (
              <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto', padding: '0 6px', fontSize: 11 }} disabled={cancelando === a.id} onClick={() => cancelar(a)}>
                {cancelando === a.id ? 'Cancelando…' : 'Cancelar'}</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
