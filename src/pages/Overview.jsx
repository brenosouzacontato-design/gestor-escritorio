import { useState, useMemo } from 'react'
import { CheckIcon, ClipboardListIcon, AlertCircleIcon, TrendingUpIcon, UsersIcon, CheckSquareIcon, ZapIcon, ChevronRightIcon, CalendarIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, PriDot, fmtDate, isOverdue, clientTaskStatus } from '../components/shared'

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

const STATUS_OBS = {
  pendente:   { label: 'Pendente', color: 'var(--warn)',   bg: 'var(--warn-dim)' },
  em_dia:     { label: 'Em dia',   color: 'var(--ok)',     bg: 'var(--ok-dim)' },
  vencido:    { label: 'Vencido',  color: 'var(--danger)', bg: 'var(--danger-dim)' },
  nao_aplica: { label: 'N/A',      color: 'var(--text3)',  bg: 'var(--surface2)' },
}

export default function Overview({ onAddTarefa, onOpenCliente, onOpenObrigacoes, onOpenTarefas }) {
  const clientes = useStore(s => s.clientes)
  const tarefas = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const [compSel, setCompSel] = useState(compMesAtras(1))
  const [expandObs, setExpandObs] = useState(false)

  const stats = useMemo(() => {
    const pending = tarefas.filter(t => !t.concluida)
    const alta = pending.filter(t => t.prioridade === 'alta')
    const vencidas = pending.filter(t => isOverdue(t.vencimento))
    const obs = obrigacoes.filter(o => o.competencia === compSel)
    return {
      clientes: clientes.length,
      tarefasPendentes: pending.length,
      alta: alta.length,
      vencidas: vencidas.length,
      obsPendentes: obs.filter(o => o.status === 'pendente').length,
      obsEmDia: obs.filter(o => o.status === 'em_dia').length,
      obsVencidas: obs.filter(o => o.status === 'vencido').length,
      obsTotal: obs.length,
      erpAbertos: fechamentos.filter(f => f.status === 'aberto').length,
    }
  }, [tarefas, fechamentos, obrigacoes, compSel, clientes])

  const urgentes = useMemo(() =>
    tarefas.filter(t => !t.concluida && (t.prioridade === 'alta' || isOverdue(t.vencimento))).slice(0, 5),
    [tarefas]
  )

  // Por empresa: obrigações + tarefas pendentes
  const resumoPorEmpresa = useMemo(() => {
    return clientes.map((c, i) => {
      const f = fechamentos.filter(x => x.cliente_id === c.id)
      const folha = f.find(x => x.tipo === 'folha')?.status
      const fiscal = f.find(x => x.tipo === 'fiscal')?.status
      const tPend = tarefas.filter(t => t.cliente_id === c.id && !t.concluida).length
      const obs = obrigacoes.filter(o => o.cliente_id === c.id && o.competencia === compSel)
      const obsPend = obs.filter(o => o.status === 'pendente').length
      const obsVenc = obs.filter(o => o.status === 'vencido').length
      return { cliente: c, idx: i, folha, fiscal, tPend, obsPend, obsVenc, obs }
    }).filter(x => x.tPend > 0 || x.obsPend > 0 || x.obsVenc > 0)
  }, [clientes, tarefas, obrigacoes, fechamentos, compSel])

  const progresso = stats.obsTotal > 0 ? Math.round((stats.obsEmDia / stats.obsTotal) * 100) : 0

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Painel</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Visão geral do escritório</p>
        </div>
        <select value={compSel} onChange={e => setCompSel(e.target.value)}
          style={{ fontSize:12, padding:'6px 10px', borderRadius:'var(--r-sm)', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text1)' }}>
          {[0,1,2,3].map(i => {
            const c = compMesAtras(i)
            return <option key={c} value={c}>{i === 0 ? `Atual (${c})` : i === 1 ? `Anterior (${c})` : c}</option>
          })}
        </select>
      </div>

      {/* Métricas */}
      <div className="metrics-grid">
        <div className="metric" style={{ cursor:'pointer' }} onClick={() => onOpenCliente && onOpenCliente(null)}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
            <UsersIcon size={10} /> Clientes
          </div>
          <div className="metric-value accent">{stats.clientes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenTarefas}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
            <CheckSquareIcon size={10} /> Tarefas pend.
          </div>
          <div className={`metric-value ${stats.tarefasPendentes > 0 ? 'warn' : ''}`}>{stats.tarefasPendentes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
            <ClipboardListIcon size={10} /> Obrig. pend.
          </div>
          <div className={`metric-value ${stats.obsPendentes > 0 ? 'warn' : ''}`}>{stats.obsPendentes}</div>
        </div>
        <div className="metric">
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
            <TrendingUpIcon size={10} /> Em dia
          </div>
          <div className="metric-value ok">{stats.obsEmDia}</div>
        </div>
      </div>

      {/* Barra de progresso obrigações */}
      {stats.obsTotal > 0 && (
        <div className="card" style={{ marginBottom:14, cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
              <ClipboardListIcon size={14} color="var(--accent)" /> Obrigações — {compSel}
            </span>
            <span style={{ fontSize:11, color:'var(--accent)', display:'flex', alignItems:'center', gap:3 }}>
              ver todas <ChevronRightIcon size={12} />
            </span>
          </div>

          {/* Barra */}
          <div style={{ height:6, background:'var(--surface2)', borderRadius:99, overflow:'hidden', marginBottom:10 }}>
            <div style={{ height:'100%', width:`${progresso}%`, background:'var(--ok)', borderRadius:99, transition:'width .4s' }} />
          </div>

          <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
            {stats.obsVencidas > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <AlertCircleIcon size={12} color="var(--danger)" />
                <span style={{ fontSize:12, fontWeight:700, color:'var(--danger)' }}>{stats.obsVencidas} vencidas</span>
              </div>
            )}
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--warn)', display:'inline-block', boxShadow:'0 0 5px var(--warn)' }} />
              <span style={{ fontSize:12, color:'var(--warn)' }}>{stats.obsPendentes} pendentes</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--ok)', display:'inline-block', boxShadow:'0 0 5px var(--ok)' }} />
              <span style={{ fontSize:12, color:'var(--ok)' }}>{stats.obsEmDia} em dia</span>
            </div>
            <span style={{ marginLeft:'auto', fontSize:12, fontWeight:700, color: progresso === 100 ? 'var(--ok)' : 'var(--text2)' }}>
              {progresso}% concluído
            </span>
          </div>
        </div>
      )}

      {/* Urgentes */}
      {urgentes.length > 0 && (
        <>
          <div className="section-hdr">
            <span className="section-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
              <ZapIcon size={10} /> Urgentes
            </span>
            <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>+ Nova</button>
          </div>
          <div className="card" style={{ marginBottom:14 }}>
            {urgentes.map(t => (
              <TaskRow key={t.id} tarefa={t} onToggle={() => toggleTarefa(t.id)} />
            ))}
          </div>
        </>
      )}

      {/* Resumo por empresa */}
      {resumoPorEmpresa.length > 0 && (
        <>
          <div className="section-hdr">
            <span className="section-label">Atenção necessária</span>
            <span style={{ fontSize:10, color:'var(--text3)' }}>{resumoPorEmpresa.length} empresa{resumoPorEmpresa.length !== 1 ? 's' : ''}</span>
          </div>
          {resumoPorEmpresa.map(({ cliente, idx, folha, fiscal, tPend, obsPend, obsVenc, obs }) => (
            <div key={cliente.id} className="client-row" onClick={() => onOpenCliente(cliente.id)}>
              <Avatar name={cliente.nome} size={36} idx={idx} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {cliente.nome}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:4, flexWrap:'wrap' }}>
                  {obsVenc > 0 && (
                    <span style={{ fontSize:10, fontWeight:700, color:'var(--danger)', display:'flex', alignItems:'center', gap:3 }}>
                      <AlertCircleIcon size={9} /> {obsVenc} vencida{obsVenc !== 1 ? 's' : ''}
                    </span>
                  )}
                  {obsPend > 0 && (
                    <span style={{ fontSize:10, color:'var(--warn)', display:'flex', alignItems:'center', gap:3 }}>
                      <ClipboardListIcon size={9} /> {obsPend} pend.
                    </span>
                  )}
                  {tPend > 0 && (
                    <span style={{ fontSize:10, color:'var(--info)', display:'flex', alignItems:'center', gap:3 }}>
                      <CheckSquareIcon size={9} /> {tPend} tarefa{tPend !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                <StatusDots folha={folha} fiscal={fiscal} tarefas={tPend > 0 ? 'media' : 'ok'} />
                {/* Mini obrigações */}
                <div style={{ display:'flex', gap:3 }}>
                  {obs.map(o => {
                    const cfg = STATUS_OBS[o.status] || STATUS_OBS.pendente
                    return (
                      <span key={o.tipo} title={`${o.tipo}: ${cfg.label}`}
                        style={{ width:6, height:6, borderRadius:'50%', background: cfg.color, display:'inline-block' }} />
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Todos clientes */}
      <div className="section-hdr" style={{ marginTop: resumoPorEmpresa.length > 0 ? 24 : 0 }}>
        <span className="section-label">Todos os clientes</span>
        <span style={{ fontSize:10, color:'var(--text3)' }}>● Folha ● Fiscal ● Tarefas</span>
      </div>

      {clientes.map((c, i) => {
        const f = fechamentos.filter(x => x.cliente_id === c.id)
        const folha = f.find(x => x.tipo === 'folha')?.status
        const fiscal = f.find(x => x.tipo === 'fiscal')?.status
        const tStatus = clientTaskStatus(tarefas.filter(t => t.cliente_id === c.id))
        return (
          <div key={c.id} className="client-row" onClick={() => onOpenCliente(c.id)}>
            <Avatar name={c.nome} size={36} idx={i} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nome}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>{c.regime}</div>
            </div>
            <StatusDots folha={folha} fiscal={fiscal} tarefas={tStatus} />
          </div>
        )
      })}
    </div>
  )
}

function TaskRow({ tarefa, onToggle }) {
  const overdue = isOverdue(tarefa.vencimento) && !tarefa.concluida
  return (
    <div className="task-item">
      <div className={`task-check ${tarefa.concluida ? 'done' : ''}`} onClick={onToggle}>
        {tarefa.concluida && <CheckIcon size={11} color="white" strokeWidth={3} />}
      </div>
      <div className="task-body">
        <div className="task-title">
          <PriDot pri={tarefa.prioridade} />{' '}{tarefa.titulo}
        </div>
        <div className="task-meta">
          <span style={{ fontWeight:500 }}>{tarefa.clientes?.nome}</span>
          <DeptChip dept={tarefa.departamento} />
          {tarefa.vencimento && (
            <span style={{ color: overdue ? 'var(--danger)' : 'var(--text2)', display:'flex', alignItems:'center', gap:3 }}>
              <CalendarIcon size={9} />
              {overdue ? '⚠ ' : ''}{fmtDate(tarefa.vencimento)}
            </span>
          )}
          {tarefa.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize:9 }}>WhatsApp</span>}
        </div>
      </div>
    </div>
  )
}
