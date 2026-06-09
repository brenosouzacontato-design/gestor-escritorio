import { useState, useMemo } from 'react'
import { Trash2Icon, CheckIcon, ChevronRightIcon, XIcon, SaveIcon, MessageSquareIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue } from '../components/shared'
import { supabase } from '../lib/supabase'

const DEPTS = [
  { id: 'todos', label: 'Todos' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'folha', label: 'Folha' },
  { id: 'societario', label: 'Societário' },
  { id: 'contabil', label: 'Contábil' },
  { id: 'geral', label: 'Geral' },
]

export default function Tarefas({ onAddTarefa }) {
  const tarefas = useStore(s => s.tarefas)
  const clientes = useStore(s => s.clientes)
  const toggleTarefa = useStore(s => s.toggleTarefa)
  const deleteTarefa = useStore(s => s.deleteTarefa)
  const fetchTarefas = useStore(s => s.fetchTarefas)

  const [deptFilter, setDeptFilter] = useState('todos')
  const [clienteFilter, setClienteFilter] = useState('todos')
  const [showDone, setShowDone] = useState(false)
  const [tarefaAberta, setTarefaAberta] = useState(null)

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
              onOpen={() => setTarefaAberta(t)}
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
                  onOpen={() => setTarefaAberta(t)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal de detalhes */}
      {tarefaAberta && (
        <TarefaModal
          tarefa={tarefaAberta}
          clientes={clientes}
          onClose={() => setTarefaAberta(null)}
          onSaved={() => { fetchTarefas(); setTarefaAberta(null) }}
        />
      )}
    </div>
  )
}

function TarefaRow({ tarefa, onToggle, onDelete, onOpen }) {
  const overdue = isOverdue(tarefa.vencimento) && !tarefa.concluida
  return (
    <div className="task-item" style={{ cursor:'pointer' }} onClick={onOpen}>
      <div className={`task-check ${tarefa.concluida ? 'done' : ''}`} onClick={e => { e.stopPropagation(); onToggle() }}>
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
          {tarefa.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize:10 }}>WhatsApp</span>}
          {tarefa.origem === 'erp' && <span className="badge badge-info" style={{ fontSize:10 }}>ERP</span>}
          {tarefa.observacao && <MessageSquareIcon size={11} style={{ color:'var(--text3)' }} />}
        </div>
      </div>
      <button className="btn btn-icon btn-ghost" onClick={e => { e.stopPropagation(); onDelete() }} style={{ color:'var(--text3)', flexShrink:0 }}>
        <Trash2Icon size={14} />
      </button>
    </div>
  )
}

function TarefaModal({ tarefa, clientes, onClose, onSaved }) {
  const [titulo, setTitulo] = useState(tarefa.titulo || '')
  const [observacao, setObservacao] = useState(tarefa.observacao || '')
  const [vencimento, setVencimento] = useState(tarefa.vencimento ? tarefa.vencimento.split('T')[0] : '')
  const [prioridade, setPrioridade] = useState(tarefa.prioridade || 'normal')
  const [departamento, setDepartamento] = useState(tarefa.departamento || 'geral')
  const [clienteId, setClienteId] = useState(tarefa.cliente_id || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('tarefas').update({
      titulo,
      observacao,
      vencimento: vencimento || null,
      prioridade,
      departamento,
      cliente_id: clienteId || null,
      updated_at: new Date().toISOString(),
    }).eq('id', tarefa.id)
    setSaving(false)
    onSaved()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:600, padding:20, maxHeight:'90vh', overflowY:'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:600, fontSize:15 }}>Detalhes da Tarefa</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
        </div>

        {/* Origem */}
        {tarefa.origem && (
          <div style={{ marginBottom:12 }}>
            <span className="badge badge-info" style={{ fontSize:11 }}>
              {tarefa.origem === 'whatsapp' ? '📱 WhatsApp' : tarefa.origem === 'erp' ? '🔄 ERP' : '✏️ Manual'}
            </span>
          </div>
        )}

        {/* Campos */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Título</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
          </div>

          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Cliente</label>
            <select value={clienteId} onChange={e => setClienteId(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
              <option value="">— Sem cliente —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Vencimento</label>
              <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Prioridade</label>
              <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Departamento</label>
            <select value={departamento} onChange={e => setDepartamento(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
              <option value="fiscal">Fiscal</option>
              <option value="folha">Folha</option>
              <option value="societario">Societário</option>
              <option value="contabil">Contábil</option>
              <option value="geral">Geral</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Observações</label>
            <textarea value={observacao} onChange={e => setObservacao(e.target.value)}
              rows={4} placeholder="Adicione observações, detalhes ou anotações..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)', resize:'vertical', fontFamily:'inherit' }} />
          </div>
        </div>

        {/* Botão salvar */}
        <button className="btn btn-accent" onClick={handleSave} disabled={saving}
          style={{ width:'100%', marginTop:16, padding:'10px', fontSize:14 }}>
          <SaveIcon size={14} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
