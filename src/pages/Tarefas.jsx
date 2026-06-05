import { useState, useMemo } from 'react'
import { Trash2Icon, CheckIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue } from '../components/shared'

const DEPTS = [
  { id: 'todos', label: 'Todos' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'pessoal', label: 'Pessoal' },
  { id: 'societario', label: 'Societário' },
  { id: 'contabil', label: 'Contábil' },
  { id: 'comunicacao', label: 'Comunicação' },
]

export default function Tarefas({ onAddTarefa }) {
  const tarefas = useStore(s => s.tarefas)
  const clientes = useStore(s => s.clientes)
  const toggleTarefa = useStore(s => s.toggleTarefa)
  const deleteTarefa = useStore(s => s.deleteTarefa)

  const [deptFilter, setDeptFilter] = useState('todos')
  const [clienteFilter, setClienteFilter] = useState('todos')
  const [showDone, setShowDone] = useState(false)

  const filtered = useMemo(() => {
    let t = tarefas
    if (deptFilter !== 'todos') t = t.filter(x => x.departamento === deptFilter)
    if (clienteFilter !== 'todos') t = t.filter(x => x.cliente_id === clienteFilter)
    return t
  }, [tarefas, deptFilter, clienteFilter])

  const pending = filtered.filter(t => !t.concluida)
  const done = filtered.filter(t => t.concluida)

  return (
    <div className="page">
      {/* Filtro dept */}
      <div className="filter-row">
        {DEPTS.map(d => (
          <button
            key={d.id}
            className={`btn btn-sm ${deptFilter === d.id ? 'btn-primary' : ''}`}
            onClick={() => setDeptFilter(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Filtro cliente */}
      <div className="form-field" style={{ marginBottom:12 }}>
        <select value={clienteFilter} onChange={e => setClienteFilter(e.target.value)}>
          <option value="todos">— Todos os clientes —</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {/* Pendentes */}
      <div className="section-hdr">
        <span className="section-label">Pendentes ({pending.length})</span>
        <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>+ Nova</button>
      </div>

      {pending.length === 0 && (
        <div className="empty"><p>📋</p><p>Nenhuma tarefa pendente</p></div>
      )}

      {pending.length > 0 && (
        <div className="card">
          {pending.map(t => (
            <TarefaRow
              key={t.id}
              tarefa={t}
              onToggle={() => toggleTarefa(t.id)}
              onDelete={() => deleteTarefa(t.id)}
            />
          ))}
        </div>
      )}

      {/* Concluídas */}
      {done.length > 0 && (
        <>
          <div className="section-hdr">
            <span className="section-label">Concluídas ({done.length})</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowDone(v => !v)}>
              {showDone ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {showDone && (
            <div className="card">
              {done.map(t => (
                <TarefaRow
                  key={t.id}
                  tarefa={t}
                  onToggle={() => toggleTarefa(t.id)}
                  onDelete={() => deleteTarefa(t.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TarefaRow({ tarefa, onToggle, onDelete }) {
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
            <span style={{ color: overdue ? 'var(--danger)' : undefined }}>
              {overdue ? '⚠ ' : ''}Venc. {fmtDate(tarefa.vencimento)}
            </span>
          )}
          {tarefa.origem === 'erp' && <span className="badge badge-info" style={{ fontSize:10 }}>ERP</span>}
        </div>
      </div>
      <button className="btn btn-icon btn-ghost" onClick={onDelete} style={{ color:'var(--text3)', flexShrink:0 }}>
        <Trash2Icon size={14} />
      </button>
    </div>
  )
}
