import { useState, useEffect } from 'react'
import {
  LayoutDashboardIcon, CheckSquareIcon, UsersIcon,
  RefreshCwIcon, SettingsIcon, PlusIcon
} from 'lucide-react'
import { useStore } from './store'
import { ToastContainer } from './components/shared'
import NovaTarefaModal from './components/NovaTarefaModal'
import OneflowConfigModal from './components/OneflowConfigModal'
import { NotificacoesBell, NotificacoesPanel } from './components/Notificacoes'
import Overview from './pages/Overview'
import Tarefas from './pages/Tarefas'
import Clientes from './pages/Clientes'
import FechamentosERP from './pages/FechamentosERP'

const NAV = [
  { id: 'overview',  label: 'Início',     Icon: LayoutDashboardIcon },
  { id: 'tarefas',   label: 'Tarefas',    Icon: CheckSquareIcon },
  { id: 'clientes',  label: 'Clientes',   Icon: UsersIcon },
  { id: 'erp',       label: 'ERP',        Icon: RefreshCwIcon },
]

export default function App() {
  const [page, setPage] = useState('overview')
  const [selectedCliente, setSelectedCliente] = useState(null)
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskClienteId, setNewTaskClienteId] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const init = useStore(s => s.init)
  const loading = useStore(s => s.loading)
  const tarefas = useStore(s => s.tarefas)

  useEffect(() => { init() }, [])

  const pendingCount = tarefas.filter(t => !t.concluida).length

  const openNewTask = (clienteId = '') => {
    setNewTaskClienteId(clienteId)
    setShowNewTask(true)
  }

  const navigate = (p) => {
    setPage(p)
    if (p !== 'clientes') setSelectedCliente(null)
  }

  return (
    <div className="app-shell">
      {/* Topbar (mobile) */}
      <div className="topbar">
        <span className="topbar-title">
          <span style={{ fontSize:18 }}>📊</span> Escritório
        </span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <NotificacoesBell onClick={() => setShowNotifs(true)} />
          <button className="btn btn-icon btn-ghost" onClick={() => setShowConfig(true)}>
            <SettingsIcon size={18} />
          </button>
        </div>
      </div>

      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>📊 Escritório</h1>
          <p>Gestor Contábil</p>
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => navigate(id)}
          >
            <Icon size={17} />
            {label}
            {id === 'tarefas' && pendingCount > 0 && (
              <span className="badge badge-warn" style={{ marginLeft:'auto' }}>{pendingCount}</span>
            )}
          </button>
        ))}
        <div style={{ flex:1 }} />
        <button className="nav-item" onClick={() => setShowNotifs(true)}>
          <NotificacoesBell onClick={() => {}} /> Alertas
        </button>
        <button className="nav-item" onClick={() => setShowConfig(true)}>
          <SettingsIcon size={17} /> Configurações
        </button>
      </aside>

      {/* Main */}
      <main className="app-main">
        {loading && page === 'overview' ? (
          <div className="center"><div className="spinner" /></div>
        ) : (
          <>
            {page === 'overview' && (
              <Overview
                onAddTarefa={openNewTask}
                onOpenCliente={(id) => { setSelectedCliente(id); navigate('clientes') }}
              />
            )}
            {page === 'tarefas' && <Tarefas onAddTarefa={openNewTask} />}
            {page === 'clientes' && (
              <Clientes
                onAddTarefa={openNewTask}
                selectedId={selectedCliente}
                onSelect={setSelectedCliente}
              />
            )}
            {page === 'erp' && <FechamentosERP onOpenConfig={() => setShowConfig(true)} />}
          </>
        )}
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="bottom-nav">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`bottom-nav-item ${page === id ? 'active' : ''}`}
            onClick={() => navigate(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {/* FAB */}
      <button className="fab" onClick={() => openNewTask()} title="Nova tarefa">
        <PlusIcon size={22} />
      </button>

      {/* Painéis */}
      {showNotifs && <NotificacoesPanel onClose={() => setShowNotifs(false)} />}
      {showNewTask && (
        <NovaTarefaModal
          clienteIdInicial={newTaskClienteId}
          onClose={() => setShowNewTask(false)}
        />
      )}
      {showConfig && <OneflowConfigModal onClose={() => setShowConfig(false)} />}

      <ToastContainer />
    </div>
  )
}
