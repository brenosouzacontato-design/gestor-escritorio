import { useMemo } from 'react'
import { CheckIcon, ClipboardListIcon, AlertCircleIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, PriDot, fmtDate, isOverdue, clientTaskStatus, ErpBadge } from '../components/shared'

export default function Overview({ onAddTarefa, onOpenCliente, onOpenObrigacoes }) {
  const clientes = useStore(s => s.clientes)
  const tarefas = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const toggleTarefa = useStore(s => s.toggleTarefa)

  // competência anterior (mês passado)
  const compAnt = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1)
    return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
  }, [])

  const compAtual = useMemo(() => {
    const d = new Date()
    return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
  }, [])

  const stats = useMemo(() => {
    const pending = tarefas.filter(t => !t.concluida)
    const alta = pending.filter(t => t.prioridade === 'alta')
    const vencidas = pending.filter(t => isOverdue(t.vencimento))
    const erpAbertos = fechamentos.filter(f => f.status === 'aberto').length

    const obsAnt = obrigacoes.filter(o => o.competencia === compAnt)
    const obsPendentes = obsAnt.filter(o => o.status === 'pendente').length
    const obsVencidas = obsAnt.filter(o => o.status === 'vencido').length
    const obsEmDia = obsAnt.filter(o => o.status === 'em_dia').length

    return { total: pending.length, alta: alta.length, vencidas: vencidas.length, erpAbertos, obsPendentes, obsVencidas, obsEmDia }
  }, [tarefas, fechamentos, obrigacoes, compAnt])

  const urgentes = useMemo(() =>
    tarefas
      .filter(t => !t.concluida && (t.prioridade === 'alta' || isOverdue(t.vencimento)))
      .slice(0, 6),
    [tarefas]
  )

  const getClienteFechamentos = (clienteId) => {
    const f = fechamentos.filter(x => x.cliente_id === clienteId)
    const folha = f.find(x => x.tipo === 'folha')?.status
    const fiscal = f.find(x => x.tipo === 'fiscal')?.status
    return { folha, fiscal }
  }

  return (
    <div className="page">
      {/* Métricas tarefas */}
      <div className="metrics-grid">
        <div className="metric">
          <div className="metric-label">Clientes ativos</div>
          <div className="metric-value accent">{clientes.length}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Alta prioridade</div>
          <div className={`metric-value ${stats.alta > 0 ? 'danger' : ''}`}>{stats.alta}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Vencidas</div>
          <div className={`metric-value ${stats.vencidas > 0 ? 'warn' : ''}`}>{stats.vencidas}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Fecham. abertos</div>
          <div className="metric-value">{stats.erpAbertos}</div>
        </div>
      </div>

      {/* Card Obrigações */}
      {(stats.obsPendentes > 0 || stats.obsVencidas > 0 || stats.obsEmDia > 0) && (
        <div className="card" style={{ marginBottom:14, cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ fontWeight:600, fontSize:13, display:'flex', alignItems:'center', gap:6 }}>
              <ClipboardListIcon size={15} /> Obrigações — {compAnt}
            </span>
            <span style={{ fontSize:11, color:'var(--accent)' }}>ver todas →</span>
          </div>
          <div style={{ display:'flex', gap:16 }}>
            {stats.obsVencidas > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <AlertCircleIcon size={13} color="var(--danger)" />
                <span style={{ fontSize:13, fontWeight:600, color:'var(--danger)' }}>{stats.obsVencidas} vencidas</span>
              </div>
            )}
            {stats.obsPendentes > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--warn)', display:'inline-block' }} />
                <span style={{ fontSize:13, color:'var(--warn)' }}>{stats.obsPendentes} pendentes</span>
              </div>
            )}
            {stats.obsEmDia > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--ok)', display:'inline-block' }} />
                <span style={{ fontSize:13, color:'var(--ok)' }}>{stats.obsEmDia} em dia</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Urgentes */}
      <div className="section-hdr">
        <span className="section-label">Urgentes</span>
        <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>+ Nova tarefa</button>
      </div>

      {urgentes.length === 0 && (
        <div className="empty">
          <p>✅</p>
          <p>Nenhuma tarefa urgente</p>
        </div>
      )}

      {urgentes.length > 0 && (
        <div className="card">
          {urgentes.map(t => (
            <TaskRow key={t.id} tarefa={t} onToggle={() => toggleTarefa(t.id)} />
          ))}
        </div>
      )}

      {/* Status clientes */}
      <div className="section-hdr">
        <span className="section-label">Clientes</span>
        <span style={{ fontSize:11, color:'var(--text2)' }}>● Folha &nbsp; ● Fiscal &nbsp; ● Tarefas</span>
      </div>

      {clientes.map((c, i) => {
        const { folha, fiscal } = getClienteFechamentos(c.id)
        const clienteTarefas = tarefas.filter(t => t.cliente_id === c.id)
        const tarefaStatus = clientTaskStatus(clienteTarefas)
        return (
          <div key={c.id} className="client-row" onClick={() => onOpenCliente(c.id)}>
            <Avatar name={c.nome} size={38} idx={i} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nome}</div>
              <div style={{ fontSize:11, color:'var(--text2)', marginTop:1 }}>{c.regime}</div>
            </div>
            <StatusDots folha={folha} fiscal={fiscal} tarefas={tarefaStatus} />
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
        <div className={`task-title ${tarefa.concluida ? 'done' : ''}`}>
          <PriDot pri={tarefa.prioridade} />{' '}{tarefa.titulo}
        </div>
        <div className="task-meta">
          <span>{tarefa.clientes?.nome}</span>
          <DeptChip dept={tarefa.departamento} />
          {tarefa.vencimento && (
            <span style={{ color: overdue ? 'var(--danger)' : 'var(--text2)' }}>
              {overdue ? '⚠ ' : ''}Venc. {fmtDate(tarefa.vencimento)}
            </span>
          )}
          {tarefa.origem === 'erp' && <span className="badge badge-info" style={{ fontSize:10 }}>ERP</span>}
        </div>
      </div>
    </div>
  )
}
