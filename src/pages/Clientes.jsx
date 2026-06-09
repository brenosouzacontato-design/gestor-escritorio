import { useState, useMemo } from 'react'
import { ArrowLeftIcon, PlusIcon, CheckIcon, Trash2Icon, PencilIcon, RefreshCwIcon, CheckSquareIcon, ClipboardListIcon, ZapIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, ErpBadge, PriDot, fmtDate, isOverdue, clientTaskStatus, useToast } from '../components/shared'
import ClienteFormModal from '../components/ClienteFormModal'
import { supabase } from '../lib/supabase'

const DEPTS = ['fiscal','folha','societario','contabil','geral']
const DEPT_LABELS = { fiscal:'Fiscal', folha:'Folha', societario:'Societário', contabil:'Contábil', geral:'Geral' }

const OBRIGACOES_TIPOS = [
  { tipo: 'PGDAS', label: 'PGDAS-D', dept: 'fiscal' },
  { tipo: 'DCTFWeb', label: 'DCTFWeb', dept: 'fiscal' },
  { tipo: 'eSocial', label: 'eSocial', dept: 'folha' },
  { tipo: 'NFS-e', label: 'NFS-e', dept: 'fiscal' },
]

function competenciaAtual() {
  const d = new Date()
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

function competenciaAnterior() {
  const d = new Date(); d.setMonth(d.getMonth()-1)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

export default function Clientes({ onAddTarefa, selectedId, onSelect }) {
  const clientes = useStore(s => s.clientes)
  const tarefas = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const [showForm, setShowForm] = useState(false)
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() =>
    clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()) || c.cnpj?.includes(busca)),
    [clientes, busca]
  )

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
      />
    )
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <span className="section-label">Clientes ({clientes.length})</span>
        <button className="btn btn-sm btn-accent" onClick={() => setShowForm(true)}>
          <PlusIcon size={13} /> Novo
        </button>
      </div>

      <input
        placeholder="Buscar por nome ou CNPJ..."
        value={busca}
        onChange={e => setBusca(e.target.value)}
        style={{ width:'100%', padding:'8px 12px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)', marginBottom:12 }}
      />

      {filtrados.map((c, i) => {
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
              {pendentes > 0 && <span style={{ fontSize:10, color:'var(--warn)', fontWeight:600 }}>{pendentes} pend.</span>}
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
  const fetchTarefas = useStore(s => s.fetchTarefas)
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const { show } = useToast()

  const [showEdit, setShowEdit] = useState(false)
  const [showLote, setShowLote] = useState(false)
  const [showBaixa, setShowBaixa] = useState(false)
  const [competencia, setCompetencia] = useState(competenciaAnterior())
  const [tarefaAberta, setTarefaAberta] = useState(null)

  const folha = fechamentos.find(f => f.tipo === 'folha')
  const fiscal = fechamentos.find(f => f.tipo === 'fiscal')

  const obrigacoesCliente = useMemo(() =>
    obrigacoes.filter(o => o.cliente_id === cliente.id && o.competencia === competencia),
    [obrigacoes, cliente.id, competencia]
  )

  const tarefasByDept = DEPTS.reduce((acc, d) => {
    acc[d] = tarefas.filter(t => t.departamento === d && !t.concluida)
    return acc
  }, {})

  const tarefasConcluidas = tarefas.filter(t => t.concluida)

  // Stats
  const totalPendentes = tarefas.filter(t => !t.concluida).length
  const totalObsPendentes = obrigacoesCliente.filter(o => o.status === 'pendente').length
  const totalObsEmDia = obrigacoesCliente.filter(o => o.status === 'em_dia').length

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
          {cliente.oneflow_token && <div style={{ fontSize:10, color:'var(--accent)' }}>● Vinculado ao OneFlow</div>}
        </div>
        <button className="btn btn-icon btn-ghost" onClick={() => setShowEdit(true)}>
          <PencilIcon size={16} />
        </button>
      </div>

      {/* Cards de stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14 }}>
        <div className="metric" style={{ padding:'10px 12px' }}>
          <div className="metric-label">Tarefas</div>
          <div className={`metric-value ${totalPendentes > 0 ? 'warn' : ''}`} style={{ fontSize:20 }}>{totalPendentes}</div>
        </div>
        <div className="metric" style={{ padding:'10px 12px' }}>
          <div className="metric-label">Obrig. pend.</div>
          <div className={`metric-value ${totalObsPendentes > 0 ? 'warn' : ''}`} style={{ fontSize:20 }}>{totalObsPendentes}</div>
        </div>
        <div className="metric" style={{ padding:'10px 12px' }}>
          <div className="metric-label">Em dia</div>
          <div className="metric-value accent" style={{ fontSize:20 }}>{totalObsEmDia}</div>
        </div>
      </div>

      {/* ERP Card melhorado */}
      <div className="card" style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>Fechamentos ERP</span>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <select value={competencia} onChange={e => setCompetencia(e.target.value)}
              style={{ fontSize:11, padding:'3px 6px', border:'1px solid var(--border)', borderRadius:4, background:'var(--surface)', color:'var(--text1)' }}>
              {[0,1,2,3].map(i => {
                const d = new Date(); d.setMonth(d.getMonth()-i)
                const c = String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
                return <option key={c} value={c}>{c}</option>
              })}
            </select>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10 }}>
          <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'10px 12px' }}>
            <div style={{ fontSize:11, color:'var(--text2)', marginBottom:6 }}>Folha de Pagamento</div>
            <ErpBadge status={folha?.status} />
            {folha?.sincronizado_em && (
              <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>
                Atualizado {new Date(folha.sincronizado_em).toLocaleDateString('pt-BR')}
              </div>
            )}
          </div>
          <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'10px 12px' }}>
            <div style={{ fontSize:11, color:'var(--text2)', marginBottom:6 }}>Escrituração Fiscal</div>
            <ErpBadge status={fiscal?.status} />
            {fiscal?.sincronizado_em && (
              <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>
                Atualizado {new Date(fiscal.sincronizado_em).toLocaleDateString('pt-BR')}
              </div>
            )}
          </div>
        </div>

        {/* Obrigações da competência */}
        {obrigacoesCliente.length > 0 && (
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:10 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', marginBottom:8 }}>
              Obrigações {competencia}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {obrigacoesCliente.map(o => {
                const cfg = { pendente: { bg:'var(--warn)', label:'⏳' }, em_dia: { bg:'var(--ok)', label:'✓' }, vencido: { bg:'var(--danger)', label:'⚠' }, nao_aplica: { bg:'var(--text3)', label:'—' } }
                const c = cfg[o.status] || cfg.pendente
                return (
                  <span key={o.id} style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:12, background: c.bg + '22', color: c.bg, fontSize:11, fontWeight:600, border:`1px solid ${c.bg}44` }}>
                    {c.label} {o.tipo}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Contato */}
      {(cliente.responsavel || cliente.email || cliente.telefone) && (
        <div className="card" style={{ marginBottom:12, fontSize:12, color:'var(--text2)' }}>
          {cliente.responsavel && <div style={{ marginBottom:3 }}>👤 {cliente.responsavel}</div>}
          {cliente.email && <div style={{ marginBottom:3 }}>✉ {cliente.email}</div>}
          {cliente.telefone && <div>📱 {cliente.telefone}</div>}
        </div>
      )}

      {/* Ações em lote */}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        <button className="btn btn-sm btn-accent" style={{ flex:1 }} onClick={() => setShowLote(true)}>
          <ZapIcon size={13} /> Criar em lote
        </button>
        <button className="btn btn-sm" style={{ flex:1, background:'var(--ok)', color:'white', border:'none' }} onClick={() => setShowBaixa(true)}>
          <CheckSquareIcon size={13} /> Baixa em lote
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onAddTarefa}>
          <PlusIcon size={13} /> Tarefa
        </button>
      </div>

      {/* Tarefas por dept */}
      <div className="section-hdr">
        <span className="section-label">Tarefas pendentes ({totalPendentes})</span>
      </div>

      {totalPendentes === 0 && (
        <div className="empty"><p>✅</p><p>Sem tarefas pendentes</p></div>
      )}

      {DEPTS.map(dept => {
        const list = tarefasByDept[dept]
        if (!list.length) return null
        return (
          <div key={dept} style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
              <DeptChip dept={dept} />
              <span style={{ fontSize:10 }}>({list.length})</span>
            </div>
            <div className="card">
              {list.map(t => {
                const overdue = isOverdue(t.vencimento) && !t.concluida
                return (
                  <div key={t.id} className="task-item" style={{ cursor:'pointer' }} onClick={() => setTarefaAberta(t)}>
                    <div className={`task-check ${t.concluida ? 'done' : ''}`} onClick={e => { e.stopPropagation(); toggleTarefa(t.id) }}>
                      {t.concluida && <CheckIcon size={11} color="white" strokeWidth={3} />}
                    </div>
                    <div className="task-body">
                      <div className="task-title">
                        <PriDot pri={t.prioridade} />{' '}{t.titulo}
                      </div>
                      <div className="task-meta">
                        {t.vencimento && (
                          <span style={{ color: overdue ? 'var(--danger)' : undefined }}>
                            {overdue ? '⚠ ' : ''}Venc. {fmtDate(t.vencimento)}
                          </span>
                        )}
                        {t.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize:10 }}>WhatsApp</span>}
                        {t.observacao && <span style={{ fontSize:10, color:'var(--text3)' }}>📝</span>}
                      </div>
                    </div>
                    <button className="btn btn-icon btn-ghost" onClick={e => { e.stopPropagation(); deleteTarefa(t.id) }} style={{ color:'var(--text3)' }}>
                      <Trash2Icon size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Concluídas */}
      {tarefasConcluidas.length > 0 && (
        <details style={{ marginTop:8 }}>
          <summary style={{ fontSize:12, color:'var(--text2)', cursor:'pointer', padding:'8px 0' }}>
            Concluídas ({tarefasConcluidas.length})
          </summary>
          <div className="card" style={{ marginTop:8 }}>
            {tarefasConcluidas.map(t => (
              <div key={t.id} className="task-item">
                <div className="task-check done" onClick={() => toggleTarefa(t.id)}>
                  <CheckIcon size={11} color="white" strokeWidth={3} />
                </div>
                <div className="task-body">
                  <div className="task-title done">{t.titulo}</div>
                </div>
                <button className="btn btn-icon btn-ghost" onClick={() => deleteTarefa(t.id)} style={{ color:'var(--text3)' }}>
                  <Trash2Icon size={14} />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Modals */}
      {showEdit && <ClienteFormModal cliente={cliente} onClose={() => setShowEdit(false)} />}

      {showLote && (
        <ModalLote
          cliente={cliente}
          competencia={competencia}
          obrigacoesExistentes={obrigacoesCliente}
          onClose={() => setShowLote(false)}
          onSaved={() => { fetchTarefas(); fetchObrigacoes(); setShowLote(false); show('Criado com sucesso!') }}
        />
      )}

      {showBaixa && (
        <ModalBaixa
          cliente={cliente}
          tarefas={tarefas.filter(t => !t.concluida)}
          obrigacoes={obrigacoesCliente}
          competencia={competencia}
          onClose={() => setShowBaixa(false)}
          onSaved={() => { fetchTarefas(); fetchObrigacoes(); setShowBaixa(false); show('Baixa realizada!') }}
        />
      )}

      {tarefaAberta && (
        <TarefaDetalheModal
          tarefa={tarefaAberta}
          onClose={() => setTarefaAberta(null)}
          onSaved={() => { fetchTarefas(); setTarefaAberta(null) }}
        />
      )}
    </div>
  )
}

// ── Modal Criar em Lote ──────────────────────────────────────────────────────
function ModalLote({ cliente, competencia, obrigacoesExistentes, onClose, onSaved }) {
  const [obsSelecionadas, setObsSelecionadas] = useState(
    OBRIGACOES_TIPOS.filter(o => !obrigacoesExistentes.find(e => e.tipo === o.tipo)).map(o => o.tipo)
  )
  const [tarefasSelecionadas, setTarefasSelecionadas] = useState([])
  const [novasTarefas, setNovasTarefas] = useState([
    { titulo: `Fechar folha ${competencia}`, dept: 'folha', pri: 'normal', checked: false },
    { titulo: `Enviar PGDAS ${competencia}`, dept: 'fiscal', pri: 'normal', checked: false },
    { titulo: `Verificar DCTFWeb ${competencia}`, dept: 'fiscal', pri: 'normal', checked: false },
    { titulo: `Emitir NFS-e ${competencia}`, dept: 'fiscal', pri: 'normal', checked: false },
  ])
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const toggleObs = (tipo) => setObsSelecionadas(s => s.includes(tipo) ? s.filter(t => t !== tipo) : [...s, tipo])
  const toggleTarefa = (i) => setNovasTarefas(t => t.map((x, idx) => idx === i ? { ...x, checked: !x.checked } : x))

  const handleSalvar = async () => {
    setSaving(true)
    try {
      // Criar obrigações
      if (obsSelecionadas.length > 0) {
        const VENC = { PGDAS: 20, DCTFWeb: 15, eSocial: 7, 'NFS-e': 10 }
        const [mes, ano] = competencia.split('/')
        const registros = obsSelecionadas.map(tipo => ({
          cliente_id: cliente.id,
          tipo,
          competencia,
          status: 'pendente',
          vencimento: new Date(parseInt(ano), parseInt(mes), VENC[tipo] || 20).toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        }))
        await supabase.from('obrigacoes').upsert(registros, { onConflict: 'cliente_id,tipo,competencia', ignoreDuplicates: true })
      }

      // Criar tarefas
      const tarefasParaCriar = novasTarefas.filter(t => t.checked).map(t => ({
        titulo: t.titulo,
        cliente_id: cliente.id,
        departamento: t.dept,
        prioridade: t.pri,
        concluida: false,
        origem: 'manual',
      }))
      if (tarefasParaCriar.length > 0) {
        await supabase.from('tarefas').insert(tarefasParaCriar)
      }

      onSaved()
    } catch(e) {
      show('Erro: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Criar em lote — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>Competência: <strong>{competencia}</strong></div>

      <div style={{ fontWeight:600, fontSize:12, marginBottom:8 }}>Obrigações</div>
      {OBRIGACOES_TIPOS.map(o => {
        const jaExiste = obrigacoesExistentes.find(e => e.tipo === o.tipo)
        return (
          <label key={o.tipo} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', cursor: jaExiste ? 'default' : 'pointer', opacity: jaExiste ? 0.5 : 1 }}>
            <input type="checkbox" checked={obsSelecionadas.includes(o.tipo)} onChange={() => !jaExiste && toggleObs(o.tipo)} disabled={!!jaExiste} />
            <span style={{ fontSize:13 }}>{o.label}</span>
            {jaExiste && <span style={{ fontSize:10, color:'var(--text3)' }}>(já existe — {jaExiste.status})</span>}
          </label>
        )
      })}

      <div style={{ fontWeight:600, fontSize:12, marginBottom:8, marginTop:14 }}>Tarefas sugeridas</div>
      {novasTarefas.map((t, i) => (
        <label key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', cursor:'pointer' }}>
          <input type="checkbox" checked={t.checked} onChange={() => toggleTarefa(i)} />
          <span style={{ fontSize:13, flex:1 }}>{t.titulo}</span>
          <DeptChip dept={t.dept} />
        </label>
      ))}

      <button className="btn btn-accent" onClick={handleSalvar} disabled={saving}
        style={{ width:'100%', marginTop:16, padding:'10px' }}>
        {saving ? 'Criando...' : `Criar ${obsSelecionadas.length} obrigações + ${novasTarefas.filter(t=>t.checked).length} tarefas`}
      </button>
    </ModalBase>
  )
}

// ── Modal Baixa em Lote ──────────────────────────────────────────────────────
function ModalBaixa({ cliente, tarefas, obrigacoes, competencia, onClose, onSaved }) {
  const [tarefasSel, setTarefasSel] = useState([])
  const [obsSel, setObsSel] = useState([])
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const toggleTarefa = (id) => setTarefasSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleObs = (id) => setObsSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const selecionarTodos = () => {
    setTarefasSel(tarefas.map(t => t.id))
    setObsSel(obrigacoes.filter(o => o.status === 'pendente').map(o => o.id))
  }

  const handleBaixa = async () => {
    setSaving(true)
    try {
      if (tarefasSel.length > 0) {
        await supabase.from('tarefas').update({ concluida: true, concluida_em: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', tarefasSel)
      }
      if (obsSel.length > 0) {
        await supabase.from('obrigacoes').update({ status: 'em_dia', updated_at: new Date().toISOString() }).in('id', obsSel)
      }
      onSaved()
    } catch(e) {
      show('Erro: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Baixa em lote — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:12, color:'var(--text2)' }}>Competência: <strong>{competencia}</strong></div>
        <button className="btn btn-sm btn-ghost" onClick={selecionarTodos}>Selecionar tudo</button>
      </div>

      {tarefas.length > 0 && (
        <>
          <div style={{ fontWeight:600, fontSize:12, marginBottom:8 }}>Tarefas pendentes</div>
          {tarefas.map(t => (
            <label key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', cursor:'pointer' }}>
              <input type="checkbox" checked={tarefasSel.includes(t.id)} onChange={() => toggleTarefa(t.id)} />
              <span style={{ fontSize:13, flex:1 }}>{t.titulo}</span>
              <DeptChip dept={t.departamento} />
            </label>
          ))}
        </>
      )}

      {obrigacoes.filter(o => o.status === 'pendente').length > 0 && (
        <>
          <div style={{ fontWeight:600, fontSize:12, marginBottom:8, marginTop:14 }}>Obrigações pendentes</div>
          {obrigacoes.filter(o => o.status === 'pendente').map(o => (
            <label key={o.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', cursor:'pointer' }}>
              <input type="checkbox" checked={obsSel.includes(o.id)} onChange={() => toggleObs(o.id)} />
              <span style={{ fontSize:13, flex:1 }}>{o.tipo}</span>
              <span style={{ fontSize:11, color:'var(--text2)' }}>venc. {o.vencimento ? fmtDate(o.vencimento.split('T')[0].replace(/-/g,'-')) : '—'}</span>
            </label>
          ))}
        </>
      )}

      {tarefas.length === 0 && obrigacoes.filter(o => o.status === 'pendente').length === 0 && (
        <div className="empty"><p>✅</p><p>Nada pendente para este cliente</p></div>
      )}

      <button className="btn btn-accent" onClick={handleBaixa} disabled={saving || (tarefasSel.length === 0 && obsSel.length === 0)}
        style={{ width:'100%', marginTop:16, padding:'10px', background:'var(--ok)' }}>
        {saving ? 'Salvando...' : `Dar baixa em ${tarefasSel.length + obsSel.length} itens`}
      </button>
    </ModalBase>
  )
}

// ── Modal Detalhe Tarefa ─────────────────────────────────────────────────────
function TarefaDetalheModal({ tarefa, onClose, onSaved }) {
  const clientes = useStore(s => s.clientes)
  const [titulo, setTitulo] = useState(tarefa.titulo || '')
  const [observacao, setObservacao] = useState(tarefa.observacao || '')
  const [vencimento, setVencimento] = useState(tarefa.vencimento ? tarefa.vencimento.split('T')[0] : '')
  const [prioridade, setPrioridade] = useState(tarefa.prioridade || 'normal')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('tarefas').update({ titulo, observacao, vencimento: vencimento || null, prioridade, updated_at: new Date().toISOString() }).eq('id', tarefa.id)
    setSaving(false)
    onSaved()
  }

  return (
    <ModalBase onClose={onClose} titulo="Detalhes da Tarefa">
      {tarefa.origem && (
        <div style={{ marginBottom:12 }}>
          <span className="badge badge-info" style={{ fontSize:11 }}>
            {tarefa.origem === 'whatsapp' ? '📱 WhatsApp' : tarefa.origem === 'erp' ? '🔄 ERP' : '✏️ Manual'}
          </span>
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:12, color:'var(--text2)', display:'block', marginBottom:4 }}>Título</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)}
            style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:12, color:'var(--text2)', display:'block', marginBottom:4 }}>Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
          </div>
          <div>
            <label style={{ fontSize:12, color:'var(--text2)', display:'block', marginBottom:4 }}>Prioridade</label>
            <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize:12, color:'var(--text2)', display:'block', marginBottom:4 }}>Observações</label>
          <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={4}
            placeholder="Observações, detalhes, anotações..."
            style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)', resize:'vertical', fontFamily:'inherit' }} />
        </div>
      </div>
      <button className="btn btn-accent" onClick={handleSave} disabled={saving} style={{ width:'100%', marginTop:16, padding:'10px' }}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </ModalBase>
  )
}

// ── Modal Base ───────────────────────────────────────────────────────────────
function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', borderRadius:'16px 16px 0 0', width:'100%', maxWidth:600, padding:20, maxHeight:'85vh', overflowY:'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:600, fontSize:15 }}>{titulo}</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
