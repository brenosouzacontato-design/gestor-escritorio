import { useState } from 'react'
import { ArrowLeftIcon, PlusIcon, CheckIcon, Trash2Icon, PencilIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, ErpBadge, PriDot, fmtDate, isOverdue, clientTaskStatus } from '../components/shared'
import ClienteFormModal from '../components/ClienteFormModal'

const DEPTS = ['fiscal','pessoal','societario','contabil','comunicacao']
const DEPT_LABELS = { fiscal:'Fiscal', pessoal:'Pessoal', societario:'Societário', contabil:'Contábil', comunicacao:'Comunicação' }

export default function Clientes({ onAddTarefa, selectedId, onSelect }) {
  const clientes = useStore(s => s.clientes)
  const tarefas = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const [showForm, setShowForm] = useState(false)

  if (selectedId) {
    const cliente = clientes.find(c => c.id === selectedId)
    if (!cliente) return null
    return (
      <ClienteDetalhe
        cliente={cliente}
        tarefas={tarefas.filter(t => t.cliente_id === selectedId)}
        fechamentos={fechamentos.filter(f => f.cliente_id === selectedId)}
        onBack={() => onSelect(null)}
        onAddTarefa={() => onAddTarefa(selectedId)}
        clientes={clientes}
      />
    )
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <span className="section-label">Clientes ({clientes.length})</span>
        <button className="btn btn-sm btn-accent" onClick={() => setShowForm(true)}>
          <PlusIcon size={13} /> Novo cliente
        </button>
      </div>

      {clientes.length === 0 && (
        <div className="empty">
          <p>👥</p>
          <p>Nenhum cliente cadastrado</p>
          <button className="btn btn-accent" style={{ marginTop:12 }} onClick={() => setShowForm(true)}>
            Cadastrar primeiro cliente
          </button>
        </div>
      )}

      {clientes.map((c, i) => {
        const clienteTarefas = tarefas.filter(t => t.cliente_id === c.id)
        const f = fechamentos.filter(x => x.cliente_id === c.id)
        const folha = f.find(x => x.tipo === 'folha')?.status
        const fiscal = f.find(x => x.tipo === 'fiscal')?.status
        const status = clientTaskStatus(clienteTarefas)
        const pendentes = clienteTarefas.filter(t => !t.concluida).length

        return (
          <div key={c.id} className="client-row" onClick={() => onSelect(c.id)}>
            <Avatar name={c.nome} size={38} idx={i} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nome}</div>
              <div style={{ fontSize:11, color:'var(--text2)', marginTop:1 }}>{c.cnpj} · {c.regime}</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
              <StatusDots folha={folha} fiscal={fiscal} tarefas={status} />
              {pendentes > 0 && <span style={{ fontSize:11, color:'var(--text2)' }}>{pendentes} pend.</span>}
            </div>
          </div>
        )
      })}

      {showForm && <ClienteFormModal onClose={() => setShowForm(false)} />}
    </div>
  )
}

function ClienteDetalhe({ cliente, tarefas, fechamentos, onBack, onAddTarefa }) {
  const toggleTarefa = useStore(s => s.toggleTarefa)
  const deleteTarefa = useStore(s => s.deleteTarefa)
  const [showEdit, setShowEdit] = useState(false)

  const folha = fechamentos.find(f => f.tipo === 'folha')
  const fiscal = fechamentos.find(f => f.tipo === 'fiscal')

  const tarefasByDept = DEPTS.reduce((acc, d) => {
    acc[d] = tarefas.filter(t => t.departamento === d)
    return acc
  }, {})

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <button className="btn btn-icon btn-ghost" onClick={onBack}>
          <ArrowLeftIcon size={18} />
        </button>
        <Avatar name={cliente.nome} size={40} idx={0} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cliente.nome}</div>
          <div style={{ fontSize:11, color:'var(--text2)' }}>{cliente.cnpj} · {cliente.regime}</div>
        </div>
        <button className="btn btn-icon btn-ghost" onClick={() => setShowEdit(true)} title="Editar cliente">
          <PencilIcon size={16} />
        </button>
      </div>

      {/* Contato */}
      {(cliente.responsavel || cliente.email || cliente.telefone) && (
        <div className="card" style={{ marginBottom:12 }}>
          {cliente.responsavel && (
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>
              👤 {cliente.responsavel}
            </div>
          )}
          {cliente.email && (
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>
              ✉ {cliente.email}
            </div>
          )}
          {cliente.telefone && (
            <div style={{ fontSize:12, color:'var(--text2)' }}>
              📱 {cliente.telefone}
            </div>
          )}
        </div>
      )}

      {/* ERP */}
      <div className="card" style={{ marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--text2)', marginBottom:10 }}>
          Fechamentos ERP · {folha?.competencia || fiscal?.competencia || 'Sem dados'}
        </div>
        <div className="erp-row">
          <span style={{ fontSize:13 }}>Folha de pagamento</span>
          <ErpBadge status={folha?.status} />
        </div>
        <div className="erp-row">
          <span style={{ fontSize:13 }}>Escrituração fiscal</span>
          <ErpBadge status={fiscal?.status} />
        </div>
      </div>

      {/* Tarefas por dept */}
      <div className="section-hdr">
        <span className="section-label">Tarefas</span>
        <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>
          <PlusIcon size={13} /> Nova
        </button>
      </div>

      {DEPTS.map(dept => {
        const list = tarefasByDept[dept]
        if (!list.length) return null
        return (
          <div key={dept} style={{ marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text2)', marginBottom:6 }}>
              <DeptChip dept={dept} />
            </div>
            <div className="card">
              {list.map(t => {
                const overdue = isOverdue(t.vencimento) && !t.concluida
                return (
                  <div key={t.id} className="task-item">
                    <div className={`task-check ${t.concluida ? 'done' : ''}`} onClick={() => toggleTarefa(t.id)}>
                      {t.concluida && <CheckIcon size={11} color="white" strokeWidth={3} />}
                    </div>
                    <div className="task-body">
                      <div className={`task-title ${t.concluida ? 'done' : ''}`}>
                        <PriDot pri={t.prioridade} />{' '}{t.titulo}
                      </div>
                      <div className="task-meta">
                        {t.vencimento && (
                          <span style={{ color: overdue ? 'var(--danger)' : undefined }}>
                            Venc. {fmtDate(t.vencimento)}
                          </span>
                        )}
                        {t.origem === 'erp' && <span className="badge badge-info" style={{ fontSize:10 }}>ERP</span>}
                      </div>
                    </div>
                    <button className="btn btn-icon btn-ghost" onClick={() => deleteTarefa(t.id)} style={{ color:'var(--text3)' }}>
                      <Trash2Icon size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {tarefas.length === 0 && (
        <div className="empty"><p>📁</p><p>Nenhuma tarefa para este cliente</p></div>
      )}

      {showEdit && <ClienteFormModal cliente={cliente} onClose={() => setShowEdit(false)} />}
    </div>
  )
}
