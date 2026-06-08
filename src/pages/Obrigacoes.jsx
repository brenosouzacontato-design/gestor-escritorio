import { useState, useMemo, useEffect } from 'react'
import { PlusIcon, RefreshCwIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, PencilIcon } from 'lucide-react'
import { useStore } from '../store'
import { useToast } from '../components/shared'

const TIPOS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e']

const VENCIMENTOS = {
  PGDAS:    20, // dia 20
  DCTFWeb:  15,
  eSocial:  7,
  'NFS-e':  10,
}

const STATUS_CONFIG = {
  pendente:   { label: 'Pendente',   color: 'var(--warn)',    Icon: ClockIcon },
  em_dia:     { label: 'Em dia',     color: 'var(--ok)',      Icon: CheckCircleIcon },
  vencido:    { label: 'Vencido',    color: 'var(--danger)',  Icon: AlertCircleIcon },
  nao_aplica: { label: 'N/A',        color: 'var(--text3)',   Icon: MinusCircleIcon },
}

function competenciaAtual() {
  const d = new Date()
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

function competenciaAnterior() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}

function vencimentoParaCompetencia(tipo, competencia) {
  const [mes, ano] = competencia.split('/')
  const dia = VENCIMENTOS[tipo] || 20
  // vencimento é no mês seguinte à competência
  const d = new Date(parseInt(ano), parseInt(mes), dia) // mes já é 1-based, new Date usa 0-based então +1 vai pro próximo mês
  return d.toISOString().split('T')[0]
}

export default function Obrigacoes({ onAddTarefa }) {
  const clientes = useStore(s => s.clientes)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const upsertObrigacao = useStore(s => s.upsertObrigacao)
  const gerarObrigacoesMes = useStore(s => s.gerarObrigacoesMes)
  const { show } = useToast()

  const [competencia, setCompetencia] = useState(competenciaAnterior())
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [editando, setEditando] = useState(null) // { clienteId, tipo, competencia }
  const [gerando, setGerando] = useState(false)

  useEffect(() => { fetchObrigacoes && fetchObrigacoes() }, [])

  const obrigacoesFiltradas = useMemo(() => {
    return obrigacoes.filter(o => {
      if (o.competencia !== competencia) return false
      if (filtroTipo !== 'todos' && o.tipo !== filtroTipo) return false
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
      return true
    })
  }, [obrigacoes, competencia, filtroTipo, filtroStatus])

  // Agrupa por cliente
  const porCliente = useMemo(() => {
    const map = {}
    clientes.forEach(c => { map[c.id] = { cliente: c, obrigacoes: {} } })
    obrigacoesFiltradas.forEach(o => {
      if (map[o.cliente_id]) map[o.cliente_id].obrigacoes[o.tipo] = o
    })
    return Object.values(map).filter(({ obrigacoes }) =>
      filtroTipo === 'todos' ? true : obrigacoes[filtroTipo]
    )
  }, [clientes, obrigacoesFiltradas, filtroTipo])

  const stats = useMemo(() => {
    const obs = obrigacoes.filter(o => o.competencia === competencia)
    return {
      total: obs.length,
      pendente: obs.filter(o => o.status === 'pendente').length,
      em_dia: obs.filter(o => o.status === 'em_dia').length,
      vencido: obs.filter(o => o.status === 'vencido').length,
    }
  }, [obrigacoes, competencia])

  const handleGerar = async () => {
    setGerando(true)
    try {
      await gerarObrigacoesMes(competencia)
      show(`Obrigações geradas para ${competencia}`)
    } catch (e) {
      show('Erro ao gerar: ' + e.message)
    }
    setGerando(false)
  }

  const handleStatus = async (clienteId, tipo, novoStatus) => {
    const obs = obrigacoes.find(o => o.cliente_id === clienteId && o.tipo === tipo && o.competencia === competencia)
    await upsertObrigacao({
      ...(obs || {}),
      cliente_id: clienteId,
      tipo,
      competencia,
      status: novoStatus,
      vencimento: vencimentoParaCompetencia(tipo, competencia),
    })
    setEditando(null)
  }

  const handleObs = async (clienteId, tipo, observacao) => {
    const obs = obrigacoes.find(o => o.cliente_id === clienteId && o.tipo === tipo && o.competencia === competencia)
    await upsertObrigacao({ ...(obs || {}), cliente_id: clienteId, tipo, competencia, observacao,
      vencimento: vencimentoParaCompetencia(tipo, competencia) })
    setEditando(null)
    show('Observação salva')
  }

  const tiposExibidos = filtroTipo === 'todos' ? TIPOS : [filtroTipo]

  return (
    <div className="page">
      {/* Cards de resumo */}
      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="metric">
          <div className="metric-label">Pendentes</div>
          <div className={`metric-value ${stats.pendente > 0 ? 'warn' : ''}`}>{stats.pendente}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Em dia</div>
          <div className="metric-value accent">{stats.em_dia}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Vencidas</div>
          <div className={`metric-value ${stats.vencido > 0 ? 'danger' : ''}`}>{stats.vencido}</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, alignItems:'center' }}>
        <select
          value={competencia}
          onChange={e => setCompetencia(e.target.value)}
          style={{ padding:'7px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }}
        >
          {[0,1,2,3].map(i => {
            const d = new Date(); d.setMonth(d.getMonth() - i)
            const c = String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
            return <option key={c} value={c}>{c}</option>
          })}
        </select>

        <div className="tabs" style={{ marginBottom:0 }}>
          {['todos', ...TIPOS].map(t => (
            <button key={t} className={`tab-btn ${filtroTipo === t ? 'active' : ''}`} onClick={() => setFiltroTipo(t)}>
              {t === 'todos' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <div className="tabs" style={{ marginBottom:0, marginLeft:'auto' }}>
          {['todos','pendente','em_dia','vencido'].map(s => (
            <button key={s} className={`tab-btn ${filtroStatus === s ? 'active' : ''}`} onClick={() => setFiltroStatus(s)}>
              {s === 'todos' ? 'Todos' : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>

        <button className="btn btn-accent btn-sm" onClick={handleGerar} disabled={gerando}>
          <RefreshCwIcon size={13} />
          {gerando ? 'Gerando...' : `Gerar ${competencia}`}
        </button>
      </div>

      {/* Tabela */}
      <div className="card" style={{ padding:0, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
              <th style={{ padding:'10px 14px', textAlign:'left', fontWeight:600, color:'var(--text2)', fontSize:11 }}>Cliente</th>
              {tiposExibidos.map(t => (
                <th key={t} style={{ padding:'10px 14px', textAlign:'center', fontWeight:600, color:'var(--text2)', fontSize:11, whiteSpace:'nowrap' }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porCliente.length === 0 && (
              <tr><td colSpan={tiposExibidos.length + 1} style={{ padding:32, textAlign:'center', color:'var(--text3)' }}>
                Nenhuma obrigação para este período. Clique em "Gerar" para criar automaticamente.
              </td></tr>
            )}
            {porCliente.map(({ cliente, obrigacoes: obs }, i) => (
              <tr key={cliente.id} style={{ borderBottom:'1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface2)' }}>
                <td style={{ padding:'10px 14px' }}>
                  <div style={{ fontWeight:500 }}>{cliente.nome}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{cliente.regime}</div>
                </td>
                {tiposExibidos.map(tipo => {
                  const o = obs[tipo]
                  const isEdit = editando?.clienteId === cliente.id && editando?.tipo === tipo
                  return (
                    <td key={tipo} style={{ padding:'8px 14px', textAlign:'center' }}>
                      {isEdit ? (
                        <EditCell
                          status={o?.status || 'pendente'}
                          obs={o?.observacao || ''}
                          onSave={(status, observacao) => {
                            handleStatus(cliente.id, tipo, status)
                            if (observacao !== (o?.observacao || '')) handleObs(cliente.id, tipo, observacao)
                          }}
                          onCancel={() => setEditando(null)}
                        />
                      ) : (
                        <StatusCell
                          status={o?.status}
                          obs={o?.observacao}
                          onClick={() => setEditando({ clienteId: cliente.id, tipo })}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusCell({ status, obs, onClick }) {
  if (!status) return (
    <button onClick={onClick} style={{ background:'none', border:'1px dashed var(--border)', borderRadius:6, padding:'3px 10px', cursor:'pointer', color:'var(--text3)', fontSize:11 }}>
      + add
    </button>
  )
  const cfg = STATUS_CONFIG[status]
  return (
    <div style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      <button
        onClick={onClick}
        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, background: cfg.color + '22', color: cfg.color }}
      >
        <cfg.Icon size={11} />
        {cfg.label}
        <PencilIcon size={9} style={{ opacity:0.6 }} />
      </button>
      {obs && <div style={{ fontSize:10, color:'var(--text3)', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{obs}</div>}
    </div>
  )
}

function EditCell({ status, obs, onSave, onCancel }) {
  const [s, setS] = useState(status)
  const [o, setO] = useState(obs)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:140 }}>
      <select value={s} onChange={e => setS(e.target.value)}
        style={{ fontSize:12, padding:'4px 6px', borderRadius:4, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text1)' }}>
        {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <input value={o} onChange={e => setO(e.target.value)} placeholder="Observação..."
        style={{ fontSize:11, padding:'3px 6px', borderRadius:4, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text1)' }} />
      <div style={{ display:'flex', gap:4 }}>
        <button onClick={() => onSave(s, o)} style={{ flex:1, fontSize:11, padding:'3px', borderRadius:4, background:'var(--accent)', color:'white', border:'none', cursor:'pointer' }}>✓</button>
        <button onClick={onCancel} style={{ flex:1, fontSize:11, padding:'3px', borderRadius:4, background:'var(--surface2)', color:'var(--text2)', border:'1px solid var(--border)', cursor:'pointer' }}>✕</button>
      </div>
    </div>
  )
}
