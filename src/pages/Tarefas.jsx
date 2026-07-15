import { useState, useMemo, useRef, useEffect } from 'react'
import { Trash2Icon, CheckIcon, XIcon, SaveIcon, MessageSquareIcon, PlusIcon, GripVerticalIcon, SendIcon } from 'lucide-react'
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

export default function Tarefas({ onAddTarefa, highlightTaskId, onHighlightConsumed }) {
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

  // Veio de "Abrir tarefa no Kanban" (Andamento de Obrigações) — abre direto
  // o detalhe da tarefa em questão.
  useEffect(() => {
    if (!highlightTaskId) return
    const t = tarefas.find(x => x.id === highlightTaskId)
    if (t) setTarefaAberta(t)
    onHighlightConsumed?.()
  }, [highlightTaskId, tarefas])

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
  const [aba,          setAba]          = useState('detalhes')
  const [titulo,       setTitulo]       = useState(tarefa.titulo || '')
  const [observacao,   setObservacao]   = useState(tarefa.observacao || '')
  const [vencimento,   setVencimento]   = useState(tarefa.vencimento ? tarefa.vencimento.split('T')[0] : '')
  const [prioridade,   setPrioridade]   = useState(tarefa.prioridade || 'normal')
  const [departamento, setDepartamento] = useState(tarefa.departamento || 'geral')
  const [clienteId,    setClienteId]    = useState(tarefa.cliente_id || '')
  const [saving,       setSaving]       = useState(false)

  // Chat
  const [comentarios,  setComentarios]  = useState([])
  const [msgTexto,     setMsgTexto]     = useState('')
  const [autor,        setAutor]        = useState(() => localStorage.getItem('gestor_autor') || '')
  const [sendingMsg,   setSendingMsg]   = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    if (aba === 'chat') carregarComentarios()
  }, [aba])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comentarios])

  const carregarComentarios = async () => {
    const { data } = await supabase
      .from('tarefa_comentarios')
      .select('*')
      .eq('tarefa_id', tarefa.id)
      .order('created_at', { ascending: true })
    if (data) setComentarios(data)
  }

  const handleEnviarMsg = async () => {
    if (!msgTexto.trim() || !autor.trim()) return
    setSendingMsg(true)
    localStorage.setItem('gestor_autor', autor)
    const { data, error } = await supabase.from('tarefa_comentarios').insert({
      tarefa_id: tarefa.id,
      autor: autor.trim(),
      mensagem: msgTexto.trim(),
    }).select().single()
    if (!error && data) setComentarios(c => [...c, data])
    setMsgTexto('')
    setSendingMsg(false)
  }

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

  const fmtHora = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
  }

  // Cores por autor (hash simples)
  const autorColor = (nome) => {
    const cores = ['var(--accent)', 'var(--ok)', 'var(--warn)', '#8B5CF6', '#EC4899', '#0EA5E9']
    let h = 0; for (let i = 0; i < nome.length; i++) h = nome.charCodeAt(i) + ((h << 5) - h)
    return cores[Math.abs(h) % cores.length]
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', borderRadius:'var(--r-xl)', width:'100%', maxWidth:600, height:'min(680px, 90vh)', display:'flex', flexDirection:'column', boxShadow:'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding:'16px 20px 0', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>{tarefa.titulo}</span>
            <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
          </div>

          {/* Abas */}
          <div style={{ display:'flex', gap:0, borderBottom:'2px solid var(--border)' }}>
            {[{ id:'detalhes', label:'Detalhes' }, { id:'chat', label:`💬 Chat ${comentarios.length > 0 ? `(${comentarios.length})` : ''}` }].map(a => (
              <button key={a.id} onClick={() => setAba(a.id)}
                style={{ padding:'8px 16px', fontSize:13, fontWeight:600, border:'none', background:'none', cursor:'pointer',
                  color: aba === a.id ? 'var(--accent)' : 'var(--text3)',
                  borderBottom: aba === a.id ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -2 }}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aba Detalhes */}
        {aba === 'detalhes' && (
          <div style={{ padding:'16px 20px 20px', overflowY:'auto', flex:1, minHeight:0 }}>
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
        )}

        {/* Aba Chat */}
        {aba === 'chat' && (
          <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
            {/* Campo nome */}
            {!autor && (
              <div style={{ padding:'12px 20px', background:'var(--warn-dim)', borderBottom:'1px solid var(--border)' }}>
                <label style={{ fontSize:12, color:'var(--text2)', display:'block', marginBottom:4 }}>Seu nome (para identificar mensagens)</label>
                <input placeholder="Ex: Breno, Maria..." value={autor} onChange={e => setAutor(e.target.value)}
                  style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
              </div>
            )}

            {/* Mensagens */}
            <div style={{ flex:1, overflowY:'auto', padding:'12px 20px', display:'flex', flexDirection:'column', gap:10 }}>
              {comentarios.length === 0 && (
                <div style={{ textAlign:'center', color:'var(--text3)', fontSize:13, padding:'30px 0' }}>
                  Nenhuma mensagem ainda. Seja o primeiro!
                </div>
              )}
              {comentarios.map(c => {
                const isMe = c.autor === autor
                return (
                  <div key={c.id} style={{ display:'flex', flexDirection:'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                    <div style={{ fontSize:10, color:'var(--text3)', marginBottom:3, display:'flex', gap:6, alignItems:'center' }}>
                      <span style={{ fontWeight:700, color: autorColor(c.autor) }}>{c.autor}</span>
                      <span>{fmtHora(c.created_at)}</span>
                    </div>
                    <div style={{
                      maxWidth:'80%', padding:'8px 12px', borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: isMe ? 'var(--accent)' : 'var(--surface2)',
                      color: isMe ? '#fff' : 'var(--text1)',
                      fontSize:13, lineHeight:1.5,
                      border: isMe ? 'none' : '1px solid var(--border)',
                    }}>
                      {c.mensagem}
                    </div>
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Input mensagem */}
            <div style={{ padding:'12px 20px 20px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
              {autor && (
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>
                  Enviando como <strong style={{ color: autorColor(autor) }}>{autor}</strong>
                  <button onClick={() => { setAutor(''); localStorage.removeItem('gestor_autor') }}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', fontSize:11, marginLeft:6, textDecoration:'underline' }}>
                    trocar
                  </button>
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                {!autor && (
                  <input placeholder="Seu nome..." value={autor} onChange={e => setAutor(e.target.value)}
                    style={{ width:110, flexShrink:0, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
                )}
                <input
                  placeholder="Digite uma mensagem..."
                  value={msgTexto}
                  onChange={e => setMsgTexto(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleEnviarMsg()}
                  style={{ flex:1, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
                <button onClick={handleEnviarMsg} disabled={sendingMsg || !msgTexto.trim() || !autor.trim()}
                  style={{ background:'var(--accent)', border:'none', borderRadius:'var(--r-sm)', padding:'8px 14px', cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', opacity: (!msgTexto.trim() || !autor.trim()) ? .5 : 1 }}>
                  <SendIcon size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
