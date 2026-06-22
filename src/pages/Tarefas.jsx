import { useState, useMemo, useRef } from 'react'
import { Trash2Icon, CheckIcon, XIcon, SaveIcon, MessageSquareIcon, PlusIcon, GripVerticalIcon } from 'lucide-react'
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

const COLUNAS = [
  { id: 'pendente',    label: 'A Fazer',       color: 'var(--text3)',  bg: 'var(--surface2)' },
  { id: 'andamento',   label: 'Em Andamento',  color: 'var(--info)',   bg: 'var(--info-dim)' },
  { id: 'aguardando',  label: 'Aguardando',    color: 'var(--warn)',   bg: 'var(--warn-dim)' },
  { id: 'concluido',   label: 'Concluído',     color: 'var(--ok)',     bg: 'var(--ok-dim)'   },
]

// kanban_status: pendente | andamento | aguardando | concluido
// Se não tiver kanban_status, deriva do campo concluida

function getKanbanStatus(t) {
  if (t.kanban_status) return t.kanban_status
  return t.concluida ? 'concluido' : 'pendente'
}

export default function Tarefas({ onAddTarefa }) {
  const tarefas      = useStore(s => s.tarefas)
  const clientes     = useStore(s => s.clientes)
  const toggleTarefa = useStore(s => s.toggleTarefa)
  const deleteTarefa = useStore(s => s.deleteTarefa)
  const fetchTarefas = useStore(s => s.fetchTarefas)

  const [deptFilter,    setDeptFilter]    = useState('todos')
  const [clienteFilter, setClienteFilter] = useState('todos')
  const [tarefaAberta,  setTarefaAberta]  = useState(null)
  const [dragging,      setDragging]      = useState(null) // { id, fromCol }
  const [dragOver,      setDragOver]      = useState(null) // colId

  const filtered = useMemo(() => {
    let t = tarefas
    if (deptFilter !== 'todos')    t = t.filter(x => x.departamento === deptFilter)
    if (clienteFilter !== 'todos') t = t.filter(x => x.cliente_id === clienteFilter)
    return t
  }, [tarefas, deptFilter, clienteFilter])

  const porColuna = useMemo(() => {
    const map = {}
    COLUNAS.forEach(c => { map[c.id] = [] })
    filtered.forEach(t => {
      const col = getKanbanStatus(t)
      if (map[col]) map[col].push(t)
      else map['pendente'].push(t)
    })
    return map
  }, [filtered])

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDragStart = (e, tarefa) => {
    setDragging({ id: tarefa.id, fromCol: getKanbanStatus(tarefa) })
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = async (e, colId) => {
    e.preventDefault()
    if (!dragging || dragging.fromCol === colId) { setDragging(null); setDragOver(null); return }
    const concluida = colId === 'concluido'
    await supabase.from('tarefas').update({
      kanban_status: colId,
      concluida,
      concluida_em: concluida ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', dragging.id)
    await fetchTarefas()
    setDragging(null)
    setDragOver(null)
  }

  const handleMoveCard = async (tarefaId, novaCol) => {
    const concluida = novaCol === 'concluido'
    await supabase.from('tarefas').update({
      kanban_status: novaCol,
      concluida,
      concluida_em: concluida ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', tarefaId)
    await fetchTarefas()
  }

  return (
    <div className="page" style={{ paddingBottom: 16 }}>
      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10, alignItems:'center' }}>
        <div className="filter-row" style={{ margin:0, flex:1, flexWrap:'wrap' }}>
          {DEPTS.map(d => (
            <button key={d.id}
              className={`btn btn-sm ${deptFilter === d.id ? 'btn-accent' : ''}`}
              onClick={() => setDeptFilter(d.id)}>
              {d.label}
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-accent" onClick={onAddTarefa} style={{ flexShrink:0 }}>
          <PlusIcon size={12} /> Nova
        </button>
      </div>

      <div style={{ marginBottom:14 }}>
        <select value={clienteFilter} onChange={e => setClienteFilter(e.target.value)}>
          <option value="todos">— Todos os clientes —</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {/* Board Kanban */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 8,
        minHeight: 'calc(100vh - 240px)',
      }}>
        {COLUNAS.map(col => {
          const cards = porColuna[col.id] || []
          const isDragTarget = dragOver === col.id
          return (
            <div key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, col.id)}
              style={{
                background: isDragTarget ? col.bg : 'var(--surface2)',
                border: `2px solid ${isDragTarget ? col.color : 'var(--border)'}`,
                borderRadius: 'var(--r-lg)',
                padding: '10px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'border-color .15s, background .15s',
                minWidth: 220,
              }}>

              {/* Cabeçalho coluna */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 4px 6px', borderBottom:`2px solid ${col.color}` }}>
                <span style={{ fontSize:11, fontWeight:800, color: col.color, textTransform:'uppercase', letterSpacing:'.8px' }}>
                  {col.label}
                </span>
                <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', background:'var(--surface3)', borderRadius:99, padding:'1px 8px' }}>
                  {cards.length}
                </span>
              </div>

              {/* Cards */}
              {cards.length === 0 && (
                <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'20px 0', opacity:.6 }}>
                  {isDragTarget ? '⬇ Soltar aqui' : 'Sem tarefas'}
                </div>
              )}

              {cards.map(t => (
                <KanbanCard
                  key={t.id}
                  tarefa={t}
                  colunas={COLUNAS}
                  colAtual={col.id}
                  onOpen={() => setTarefaAberta(t)}
                  onDelete={() => deleteTarefa(t.id)}
                  onMove={novaCol => handleMoveCard(t.id, novaCol)}
                  onDragStart={e => handleDragStart(e, t)}
                  isDragging={dragging?.id === t.id}
                />
              ))}
            </div>
          )
        })}
      </div>

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

function KanbanCard({ tarefa, colunas, colAtual, onOpen, onDelete, onMove, onDragStart, isDragging }) {
  const overdue = isOverdue(tarefa.vencimento) && colAtual !== 'concluido'
  const [showMove, setShowMove] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '10px 12px',
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : 1,
        transition: 'box-shadow .15s, transform .15s',
        position: 'relative',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; setShowMove(false) }}>

      {/* Grip + ações */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <GripVerticalIcon size={12} style={{ color:'var(--text3)', cursor:'grab', flexShrink:0 }} />
        <div style={{ display:'flex', gap:4 }} onClick={e => e.stopPropagation()}>
          {/* Mover para coluna */}
          <div style={{ position:'relative' }}>
            <button
              title="Mover para..."
              onClick={e => { e.stopPropagation(); setShowMove(v => !v) }}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text3)', padding:'1px 4px', borderRadius:4 }}>
              ⇄
            </button>
            {showMove && (
              <div style={{ position:'absolute', right:0, top:20, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', zIndex:50, minWidth:140, boxShadow:'var(--shadow-md)' }}>
                {colunas.filter(c => c.id !== colAtual).map(c => (
                  <button key={c.id} onClick={e => { e.stopPropagation(); onMove(c.id); setShowMove(false) }}
                    style={{ display:'block', width:'100%', padding:'7px 12px', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontSize:12, color: c.color, fontWeight:600 }}>
                    → {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', padding:'1px 4px', borderRadius:4 }}>
            <Trash2Icon size={11} color="var(--danger)" style={{ opacity:.5 }} />
          </button>
        </div>
      </div>

      {/* Prioridade + título */}
      <div style={{ fontSize:12, fontWeight:600, color:'var(--text1)', lineHeight:1.4, marginBottom:8, display:'flex', gap:6, alignItems:'flex-start' }}>
        <PriDot pri={tarefa.prioridade} />
        <span style={{ textDecoration: colAtual === 'concluido' ? 'line-through' : 'none', color: colAtual === 'concluido' ? 'var(--text3)' : 'var(--text1)' }}>
          {tarefa.titulo}
        </span>
      </div>

      {/* Meta */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
        {tarefa.clientes?.nome && (
          <span style={{ fontSize:10, color:'var(--text2)', fontWeight:500, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {tarefa.clientes.nome.split(' ').slice(0,2).join(' ')}
          </span>
        )}
        <DeptChip dept={tarefa.departamento} />
        {tarefa.vencimento && (
          <span style={{ fontSize:10, color: overdue ? 'var(--danger)' : 'var(--text3)', fontWeight: overdue ? 700 : 400 }}>
            {overdue ? '⚠ ' : ''}{fmtDate(tarefa.vencimento)}
          </span>
        )}
        {tarefa.origem === 'whatsapp' && (
          <span style={{ fontSize:9, background:'var(--info-dim)', color:'var(--info)', borderRadius:99, padding:'1px 6px', fontWeight:700 }}>WA</span>
        )}
        {tarefa.observacao && <MessageSquareIcon size={10} style={{ color:'var(--text3)' }} />}
      </div>
    </div>
  )
}

function TarefaModal({ tarefa, clientes, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState(tarefa.titulo || '')
  const [observacao,   setObservacao]   = useState(tarefa.observacao || '')
  const [vencimento,   setVencimento]   = useState(tarefa.vencimento ? tarefa.vencimento.split('T')[0] : '')
  const [prioridade,   setPrioridade]   = useState(tarefa.prioridade || 'normal')
  const [departamento, setDepartamento] = useState(tarefa.departamento || 'geral')
  const [clienteId,    setClienteId]    = useState(tarefa.cliente_id || '')
  const [saving,       setSaving]       = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('tarefas').update({
      titulo, observacao,
      vencimento: vencimento || null,
      prioridade, departamento,
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

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:600, fontSize:15, color:'var(--text1)' }}>Detalhes da Tarefa</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
        </div>

        {tarefa.origem && (
          <div style={{ marginBottom:12 }}>
            <span className="badge badge-info" style={{ fontSize:11 }}>
              {tarefa.origem === 'whatsapp' ? '📱 WhatsApp' : tarefa.origem === 'erp' ? '🔄 ERP' : '✏️ Manual'}
            </span>
          </div>
        )}

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

        <button className="btn btn-accent" onClick={handleSave} disabled={saving}
          style={{ width:'100%', marginTop:16, padding:'10px', fontSize:14 }}>
          <SaveIcon size={14} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
