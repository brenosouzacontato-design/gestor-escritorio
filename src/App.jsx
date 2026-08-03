import { useState, useEffect } from 'react'
import { LayoutDashboardIcon, CheckSquareIcon, UsersIcon, RefreshCwIcon, SettingsIcon, PlusIcon, TargetIcon, BuildingIcon, AppWindowIcon, CalculatorIcon, TrendingUpIcon, ChevronsLeftIcon, ChevronsRightIcon, SunIcon, MoonIcon, PaperclipIcon } from 'lucide-react'
import { useStore } from './store'
import { ToastContainer } from './components/shared'
import NovaTarefaModal from './components/NovaTarefaModal'
import OneflowConfigModal from './components/OneflowConfigModal'
import { NotificacoesBell, NotificacoesPanel } from './components/Notificacoes'
import Overview from './pages/Overview'
import Tarefas from './pages/Tarefas'
import Clientes from './pages/Clientes'
import FechamentosERP from './pages/FechamentosERP'
import Prospectos from './pages/Prospectos'
import Empresas from './pages/Empresas'
import Central from './pages/Central'
import ContabilPage from './pages/contabil/ContabilPage'
import AndamentoPage from './pages/andamento/AndamentoPage'
import DocumentosPage from './pages/documentos/DocumentosPage'

const NAV = [
  { id: 'overview',   label: 'Painel',      Icon: LayoutDashboardIcon },
  { id: 'empresas',   label: 'Empresas',    Icon: BuildingIcon },
  { id: 'andamento',  label: 'Andamento',   Icon: TrendingUpIcon },
  { id: 'documentos', label: 'Documentos',  Icon: PaperclipIcon },
  { id: 'tarefas',    label: 'Tarefas',     Icon: CheckSquareIcon },
  { id: 'clientes',   label: 'Clientes',    Icon: UsersIcon },
  { id: 'prospectos', label: 'Prospectos',  Icon: TargetIcon },
  { id: 'erp',        label: 'ERP',         Icon: RefreshCwIcon },
  { id: 'contabil',   label: 'Financeiro',  Icon: CalculatorIcon },
  { id: 'central',    label: 'Central',     Icon: AppWindowIcon },
]

export default function App() {
  const [page, setPage]                       = useState('overview')
  const [selectedCliente, setSelectedCliente] = useState(null)
  const [showNewTask, setShowNewTask]         = useState(false)
  const [newTaskClienteId, setNewTaskClienteId] = useState('')
  const [showConfig, setShowConfig]           = useState(false)
  const [highlightTaskId, setHighlightTaskId] = useState(null)
  const [showNotifs, setShowNotifs]           = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1')
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

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
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const toggleCollapsed = () => setCollapsed(c => {
    localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
    return !c
  })
  const pageTitle = NAV.find(n => n.id === page)?.label || 'Gestor'

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="topbar-title topbar-title--brand"><span style={{ fontSize:20 }}>⬡</span> Gestor</span>
        <span className="topbar-title topbar-title--page">{pageTitle}</span>
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          <button className="btn btn-icon btn-ghost" onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
            {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
          <NotificacoesBell onClick={() => setShowNotifs(true)} />
          <button className="btn btn-icon btn-ghost" onClick={() => setShowConfig(true)}><SettingsIcon size={18} /></button>
        </div>
      </div>

      <div className="app-body">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <h1><span style={{ fontSize:20 }}>⬡</span> <span className="brand-text">Gestor</span></h1>
          <p className="brand-text">Escritório Contábil</p>
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} title={collapsed ? label : undefined}>
            <Icon size={17} /> <span className="nav-label">{label}</span>
            {id === 'tarefas' && pendingCount > 0 && (
              <span className="badge badge-warn" style={{ marginLeft:'auto', fontSize:10 }}>{pendingCount}</span>
            )}
            {id === 'empresas' && (obrigVencidas > 0 || obrigPendentes > 0) && (
              <span className={`badge ${obrigVencidas > 0 ? 'badge-err' : 'badge-warn'}`} style={{ marginLeft:'auto', fontSize:10 }}>
                {obrigVencidas > 0 ? obrigVencidas : obrigPendentes}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex:1 }} />
        <div style={{ height:1, background:'var(--border)', margin:'8px 0' }} />
        <button className="nav-item" onClick={toggleCollapsed} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          {collapsed ? <ChevronsRightIcon size={16} /> : <ChevronsLeftIcon size={16} />} <span className="nav-label">Recolher</span>
        </button>
      </aside>

      <main className="app-main">
        {loading && page === 'overview' ? (
          <div className="center"><div className="spinner" /></div>
        ) : (
          <>
            {page === 'overview'   && <Overview onAddTarefa={openNewTask} onOpenCliente={(id) => { setSelectedCliente(id); navigate('clientes') }} onOpenObrigacoes={() => navigate('empresas')} onOpenTarefas={() => navigate('tarefas')} onOpenContabil={() => navigate('contabil')} />}
            {page === 'empresas'   && <Empresas onOpenTarefas={() => navigate('tarefas')} />}
            {page === 'andamento'  && <AndamentoPage onOpenTarefa={(taskId) => { setHighlightTaskId(taskId); navigate('tarefas') }} />}
            {page === 'documentos' && <DocumentosPage />}
            {page === 'tarefas'    && <Tarefas onAddTarefa={openNewTask} highlightTaskId={highlightTaskId} onHighlightConsumed={() => setHighlightTaskId(null)} />}
            {page === 'clientes'   && <Clientes onAddTarefa={openNewTask} selectedId={selectedCliente} onSelect={setSelectedCliente} />}
            {page === 'prospectos' && <Prospectos />}
            {page === 'erp'        && <FechamentosERP onOpenConfig={() => setShowConfig(true)} />}
            {page === 'contabil'   && <ContabilPage />}
            {page === 'central'    && <Central />}
          </>
        )}
      </main>
      </div>

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
      {showNotifs  && <NotificacoesPanel onClose={() => setShowNotifs(false)} />}
      <ToastContainer />
    </div>
  )
}
