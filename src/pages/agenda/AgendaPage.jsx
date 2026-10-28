import { useEffect, useMemo, useState } from 'react'
import { CalendarDaysIcon, PlusIcon, XIcon, MapPinIcon, ClockIcon, MessageCircleIcon, Trash2Icon, BanIcon, RotateCcwIcon, PencilIcon } from 'lucide-react'
import { Modal, useToast } from '../../components/shared'
import { listarEventos, salvarEvento, cancelarEvento, excluirEvento, listarClientesAtivos, agendaNaoCriada } from './agendaApi'

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

function hojeISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}
function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function rotuloDia(iso, hoje) {
  const [a, m, d] = iso.split('-')
  const semana = DIAS[new Date(iso + 'T12:00:00Z').getUTCDay()]
  const rel = iso === hoje ? 'Hoje' : iso === somarDias(hoje, 1) ? 'Amanhã' : iso === somarDias(hoje, -1) ? 'Ontem' : null
  const txt = `${rel ? rel + ' · ' : ''}${semana}, ${d}/${m}${a !== hoje.slice(0, 4) ? '/' + a : ''}`
  return txt[0].toUpperCase() + txt.slice(1)
}
function horario(ev) {
  if (!ev.hora) return 'Dia todo'
  const ini = ev.hora.slice(0, 5)
  if (!ev.duracao_min) return ini
  const [h, m] = ini.split(':').map(Number)
  const fim = h * 60 + m + ev.duracao_min
  return `${ini}–${String(Math.floor(fim / 60) % 24).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`
}
const ehLink = (s) => /^https?:\/\//i.test(s || '')

const VAZIO = { titulo: '', cliente_id: '', data: '', hora: '', duracao_min: '', local: '', descricao: '' }

export default function AgendaPage() {
  const hoje = hojeISO()
  const [eventos, setEventos] = useState(null) // null = carregando
  const [erro, setErro] = useState(null)
  const [semTabela, setSemTabela] = useState(false)
  const [visao, setVisao] = useState('proximos') // proximos | passados
  const [mostrarCancelados, setMostrarCancelados] = useState(false)
  const [editando, setEditando] = useState(null) // evento | VAZIO
  const [clientes, setClientes] = useState([])
  const { show } = useToast()

  const carregar = () => {
    setErro(null)
    const filtro = visao === 'proximos' ? { de: hoje } : { de: somarDias(hoje, -90), ate: somarDias(hoje, -1) }
    listarEventos(filtro)
      .then((d) => { setEventos(d); setSemTabela(false) })
      .catch((e) => { if (agendaNaoCriada(e)) setSemTabela(true); else setErro(e.message); setEventos([]) })
  }
  useEffect(() => { setEventos(null); carregar() }, [visao]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listarClientesAtivos().then(setClientes).catch(() => {}) }, [])

  const porDia = useMemo(() => {
    const lista = (eventos || []).filter((e) => mostrarCancelados || !e.cancelado)
    if (visao === 'passados') lista.reverse()
    const grupos = new Map()
    for (const ev of lista) {
      if (!grupos.has(ev.data)) grupos.set(ev.data, [])
      grupos.get(ev.data).push(ev)
    }
    return [...grupos.entries()]
  }, [eventos, mostrarCancelados, visao])

  const qtdCancelados = (eventos || []).filter((e) => e.cancelado).length

  const alternarCancelado = async (ev) => {
    try {
      await cancelarEvento(ev.id, !ev.cancelado)
      show(ev.cancelado ? 'Reunião reativada' : 'Reunião cancelada')
      carregar()
    } catch (e) { show('Erro: ' + e.message) }
  }
  const excluir = async (ev) => {
    if (!window.confirm(`Excluir "${ev.titulo}" da agenda?`)) return
    try {
      await excluirEvento(ev.id)
      show('Reunião excluída')
      carregar()
    } catch (e) { show('Erro: ' + e.message) }
  }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
      <div className="section-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarDaysIcon size={18} /> Agenda
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Reuniões do escritório. O grupo do WhatsApp recebe um aviso 1 hora antes de cada uma.
          </p>
        </div>
        {!semTabela && (
          <button className="btn btn-sm btn-accent" onClick={() => setEditando({ ...VAZIO, data: hoje })}>
            <PlusIcon size={14} /> Nova reunião
          </button>
        )}
      </div>

      <DicaWhatsapp />

      {semTabela ? (
        <div className="card" style={{ fontSize: 13, color: 'var(--text2)' }}>
          A Agenda ainda não foi ativada no banco de dados. Falta rodar o arquivo <code>supabase-schema-agenda.sql</code> no Supabase.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="tabs" style={{ maxWidth: 260 }}>
              <button className={`tab-btn ${visao === 'proximos' ? 'active' : ''}`} onClick={() => setVisao('proximos')}>Próximas</button>
              <button className={`tab-btn ${visao === 'passados' ? 'active' : ''}`} onClick={() => setVisao('passados')}>Passadas</button>
            </div>
            {qtdCancelados > 0 && (
              <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={mostrarCancelados} onChange={(e) => setMostrarCancelados(e.target.checked)} />
                Mostrar canceladas ({qtdCancelados})
              </label>
            )}
          </div>

          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          {!erro && !eventos && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>}
          {eventos && porDia.length === 0 && !erro && (
            <div className="empty">
              <p>📅</p>
              {visao === 'proximos' ? 'Nenhuma reunião marcada.' : 'Nenhuma reunião nos últimos 90 dias.'}
            </div>
          )}

          {porDia.map(([dia, lista]) => (
            <section key={dia}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: dia === hoje ? 'var(--accent)' : 'var(--text2)', margin: '4px 0 8px' }}>
                {rotuloDia(dia, hoje)}
              </h3>
              {lista.map((ev) => (
                <Evento key={ev.id} ev={ev}
                  onEditar={() => setEditando({ ...ev, hora: ev.hora?.slice(0, 5) || '', duracao_min: ev.duracao_min || '', cliente_id: ev.cliente_id || '', local: ev.local || '', descricao: ev.descricao || '' })}
                  onCancelar={() => alternarCancelado(ev)}
                  onExcluir={() => excluir(ev)} />
              ))}
            </section>
          ))}
        </>
      )}

      {editando && (
        <EventoModal inicial={editando} clientes={clientes} onClose={() => setEditando(null)}
          onSalvo={() => { setEditando(null); show('Reunião salva'); carregar() }} />
      )}
    </div>
  )
}

function DicaWhatsapp() {
  const exemplos = [
    ['tarefa:', 'conferir DAS da Loja até sexta', 'cria uma tarefa'],
    ['obrigação:', 'DCTFWeb da Loja competência 10/2026', 'cria a obrigação com as etapas do tipo'],
    ['reunião:', 'alinhamento com a Clínica sexta 14h no Meet', 'marca aqui na Agenda'],
    ['lembrete:', 'ligar para o contador amanhã 9h', 'avisa no grupo na hora'],
  ]
  return (
    <details className="card" style={{ fontSize: 12.5 }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontWeight: 600 }}>
        <MessageCircleIcon size={14} /> Pelo WhatsApp: comece a mensagem no grupo do escritório com a categoria
      </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        {exemplos.map(([pref, ex, faz]) => (
          <div key={pref} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <code style={{ background: 'var(--surface2)', padding: '2px 6px', borderRadius: 6, color: 'var(--text1)' }}>{pref} {ex}</code>
            <span style={{ color: 'var(--text3)' }}>→ {faz}</span>
          </div>
        ))}
        <p style={{ color: 'var(--text3)', marginTop: 4 }}>
          Se faltar o dia da reunião, ou o cliente ou o tipo da obrigação, o sistema cria uma tarefa e responde no grupo o que faltou.
        </p>
      </div>
    </details>
  )
}

function Evento({ ev, onEditar, onCancelar, onExcluir }) {
  return (
    <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', opacity: ev.cancelado ? 0.55 : 1 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <ClockIcon size={12} /> {horario(ev)}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text1)', textDecoration: ev.cancelado ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
          {ev.titulo}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>
          {ev.clientes?.nome && <span>👤 {ev.clientes.nome}</span>}
          {ev.local && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflowWrap: 'anywhere' }}>
              <MapPinIcon size={12} style={{ flexShrink: 0 }} />
              {ehLink(ev.local)
                ? <a href={ev.local} target="_blank" rel="noreferrer" title={ev.local}>{(() => { try { return new URL(ev.local).hostname } catch { return 'Abrir link' } })()}</a>
                : ev.local}
            </span>
          )}
          {ev.origem === 'whatsapp' && <span title={ev.descricao || ''}>💬 pelo WhatsApp</span>}
          {ev.cancelado && <span style={{ color: 'var(--danger)' }}>cancelada</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <button className="btn btn-icon btn-ghost" title="Editar" onClick={onEditar}><PencilIcon size={14} /></button>
        <button className="btn btn-icon btn-ghost" title={ev.cancelado ? 'Reativar' : 'Cancelar reunião'} onClick={onCancelar}>
          {ev.cancelado ? <RotateCcwIcon size={14} /> : <BanIcon size={14} />}
        </button>
        <button className="btn btn-icon btn-ghost" title="Excluir" onClick={onExcluir}><Trash2Icon size={14} /></button>
      </div>
    </div>
  )
}

const campo = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text1)', outline: 'none' }
const rotulo = { fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 4 }

function EventoModal({ inicial, clientes, onClose, onSalvo }) {
  const [ev, setEv] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)
  const set = (k) => (e) => setEv((x) => ({ ...x, [k]: e.target.value }))

  const salvar = async () => {
    if (!ev.titulo.trim() || !ev.data) { setErro('Preencha o assunto e o dia.'); return }
    setSalvando(true)
    setErro(null)
    try {
      await salvarEvento(ev, inicial.id ? inicial : null)
      onSalvo()
    } catch (e) {
      setErro(e.message)
      setSalvando(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>{inicial.id ? 'Editar reunião' : 'Nova reunião'}</h3>
        <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={rotulo}>Assunto *</label>
          <input value={ev.titulo} onChange={set('titulo')} autoFocus placeholder="Ex.: Alinhamento da Reforma Tributária" style={campo} />
        </div>
        <div>
          <label style={rotulo}>Cliente</label>
          <select value={ev.cliente_id} onChange={set('cliente_id')} style={campo}>
            <option value="">— Interna / sem cliente —</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
          <div>
            <label style={rotulo}>Dia *</label>
            <input type="date" value={ev.data} onChange={set('data')} style={campo} />
          </div>
          <div>
            <label style={rotulo}>Hora</label>
            <input type="time" value={ev.hora} onChange={set('hora')} style={campo} />
          </div>
          <div>
            <label style={rotulo}>Duração (min)</label>
            <input type="number" min="5" max="600" step="5" value={ev.duracao_min} onChange={set('duracao_min')} placeholder="60" style={campo} />
          </div>
        </div>
        <div>
          <label style={rotulo}>Local ou link</label>
          <input value={ev.local} onChange={set('local')} placeholder="Escritório, endereço ou link do Meet/Zoom" style={campo} />
        </div>
        <div>
          <label style={rotulo}>Observações</label>
          <textarea value={ev.descricao} onChange={set('descricao')} rows={3} style={{ ...campo, resize: 'vertical' }} />
        </div>
        {erro && <p style={{ color: 'var(--danger)', fontSize: 12.5 }}>{erro}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </Modal>
  )
}
