import { useMemo } from 'react'
import { CheckIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, PriDot, fmtDate, isOverdue, clientTaskStatus, ErpBadge } from '../components/shared'

export default function Overview({ onAddTarefa, onOpenCliente }) {
  const clientes = useStore(s => s.clientes)
  const tarefas = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const stats = useMemo(() => {
    const pending = tarefas.filter(t => !t.concluida)
    const alta = pending.filter(t => t.prioridade === 'alta')
    const vencidas = pending.filter(t => isOverdue(t.vencimento))
    const erpAbertos = fechamentos.filter(f => f.status === 'aberto').length
    return { total: pending.length, alta: alta.length, vencidas: vencidas.length, erpAbertos }
  }, [tarefas, fechamentos])

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
      {/* Métricas */}
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
