import { useState, useEffect } from 'react'
import { LayoutDashboardIcon, CheckSquareIcon, UsersIcon, RefreshCwIcon, SettingsIcon, PlusIcon, ClipboardListIcon, TargetIcon } from 'lucide-react'
import { useStore } from './store'
import { ToastContainer } from './components/shared'
import NovaTarefaModal from './components/NovaTarefaModal'
import OneflowConfigModal from './components/OneflowConfigModal'
import Overview from './pages/Overview'
import Tarefas from './pages/Tarefas'
import Clientes from './pages/Clientes'
import FechamentosERP from './pages/FechamentosERP'
import Obrigacoes from './pages/Obrigacoes'
import Prospectos from './pages/Prospectos'

const NAV = [
  { id: 'overview',   label: 'Painel',      Icon: LayoutDashboardIcon },
  { id: 'obrigacoes', label: 'Obrigações',  Icon: ClipboardListIcon },
  { id: 'tarefas',    label: 'Tarefas',     Icon: CheckSquareIcon },
  { id: 'clientes',   label: 'Clientes',    Icon: UsersIcon },
  { id: 'prospectos', label: 'Prospectos',  Icon: TargetIcon },
  { id: 'erp',        label: 'ERP',         Icon: RefreshCwIcon },
]

export default function App() {
  const [page, setPage]                       = useState('overview')
  const [selectedCliente, setSelectedCliente] = useState(null)
  const [showNewTask, setShowNewTask]         = useState(false)
  const [newTaskClienteId, setNewTaskClienteId] = useState('')
  const [showConfig, setShowConfig]           = useState(false)

  const init       = useStore(s => s.init)
  const loading    = useStore(s => s.loading)
  const tarefas    = useStore(s => s.tarefas)
  const obrigacoes = useStore(s => s.obrigacoes || [])

  useEffect(() => { init() }, [])

  const pendingCount   = tarefas.filter(t => !t.concluida).length
  const obrigVencidas  = obrigacoes.filter(o => o.status === 'vencido').length
  const obrigPendentes = obrigacoes.filter(o => o.status === 'pendente').length

  const openNewTask = (clienteId = '') => { setNewTaskClienteId(clienteId); setShowNewTask(true) }
  const navigate    = (p) => { setPage(p); if (p !== 'clientes') setSelectedCliente(null) }

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="topbar-title"><span style={{ fontSize:20 }}>⬡</span> Gestor</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {(obrigVencidas > 0 || pendingCount > 0) && (
            <span style={{ background:'var(--danger)', color:'#fff', fontSize:10, fontWeight:800, padding:'2px 7px', borderRadius:99 }}>
              {obrigVencidas + (pendingCount > 0 ? 1 : 0)}
            </span>
          )}
          <button className="btn btn-icon btn-ghost" onClick={() => setShowConfig(true)}><SettingsIcon size={18} /></button>
        </div>
      </div>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1><span style={{ fontSize:20 }}>⬡</span> Gestor</h1>
          <p>Escritório Contábil</p>
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}>
            <Icon size={16} /> {label}
            {id === 'tarefas' && pendingCount > 0 && (
              <span className="badge badge-warn" style={{ marginLeft:'auto', fontSize:10 }}>{pendingCount}</span>
            )}
            {id === 'obrigacoes' && (obrigVencidas > 0 || obrigPendentes > 0) && (
              <span className={`badge ${obrigVencidas > 0 ? 'badge-err' : 'badge-warn'}`} style={{ marginLeft:'auto', fontSize:10 }}>
                {obrigVencidas > 0 ? obrigVencidas : obrigPendentes}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex:1 }} />
        <div style={{ height:1, background:'var(--border)', margin:'8px 0' }} />
        <button className="nav-item" onClick={() => setShowConfig(true)}><SettingsIcon size={16} /> Configurações</button>
      </aside>

      <main className="app-main">
        {loading && page === 'overview' ? (
          <div className="center"><div className="spinner" /></div>
        ) : (
          <>
            {page === 'overview'   && <Overview onAddTarefa={openNewTask} onOpenCliente={(id) => { setSelectedCliente(id); navigate('clientes') }} onOpenObrigacoes={() => navigate('obrigacoes')} onOpenTarefas={() => navigate('tarefas')} />}
            {page === 'obrigacoes' && <Obrigacoes />}
            {page === 'tarefas'    && <Tarefas onAddTarefa={openNewTask} />}
            {page === 'clientes'   && <Clientes onAddTarefa={openNewTask} selectedId={selectedCliente} onSelect={setSelectedCliente} />}
            {page === 'prospectos' && <Prospectos />}
            {page === 'erp'        && <FechamentosERP onOpenConfig={() => setShowConfig(true)} />}
          </>
        )}
      </main>

      <nav className="bottom-nav">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className={`bottom-nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}>
            <Icon /> {label}
          </button>
        ))}
      </nav>

      <button className="fab" onClick={() => openNewTask()} title="Nova tarefa"><PlusIcon size={22} /></button>

      {showNewTask && <NovaTarefaModal clienteIdInicial={newTaskClienteId} onClose={() => setShowNewTask(false)} />}
      {showConfig  && <OneflowConfigModal onClose={() => setShowConfig(false)} />}
      <ToastContainer />
    </div>
  )
}
