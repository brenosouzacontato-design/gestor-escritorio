import { useState, useEffect, Fragment } from 'react'
import { RefreshCwIcon, SettingsIcon, PlusIcon, LogOutIcon, SearchIcon } from 'lucide-react'
import { MenuTopo, BuscaRapida, MenuCelular, NAV } from './components/MenuTopo'
import { temaInicial, salvarTema } from './lib/tema'
import SeletorTema from './components/SeletorTema'
import { useStore } from './store'
import { ToastContainer } from './components/shared'
import { sair } from './components/ComLogin'
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
import DocumentosPage from './pages/documentos/DocumentosPage'
import PagamentosPage from './pages/pagamentos/PagamentosPage'
import ParcelamentosPage from './pages/parcelamentos/ParcelamentosPage'
import { contarComprovantesPendentes } from './pages/pagamentos/pagamentosApi'
import NotificacoesPage from './pages/Notificacoes'
import HonorariosPage from './pages/honorarios/HonorariosPage'
import PaineisPage from './pages/painel/PaineisPage'
import NotasFiscaisPage from './pages/notasfiscais/NotasFiscaisPage'
import NfseEmissaoPage from './pages/nfse/NfseEmissaoPage'
import AssessorPage from './pages/assessor/AssessorPage'
import AgendaPage from './pages/agenda/AgendaPage'
import HojePage from './pages/hoje/HojePage'

// Tela inicial pela URL (?tela=hoje, ?tela=documentos…) — é o que o app
// instalado no tablet usa (start_url e atalhos do gestor.webmanifest).
const paramsIniciais = new URLSearchParams(window.location.search)
const telaUrl = paramsIniciais.get('tela')
const TELA_INICIAL = NAV.some(i => i.id === telaUrl) ? telaUrl : 'overview'
const ABRIR_NOVA_TAREFA = paramsIniciais.get('acao') === 'nova-tarefa'

export default function App() {
  const [page, setPage]                       = useState(TELA_INICIAL)
  const [selectedCliente, setSelectedCliente] = useState(null)
  const [showNewTask, setShowNewTask]         = useState(ABRIR_NOVA_TAREFA)
  // fotos/arquivos capturados na tela Hoje, entregues à tela Documentos (IA identifica)
  const [arquivosCapturados, setArquivosCapturados] = useState(null)
  const [newTaskClienteId, setNewTaskClienteId] = useState('')
  const [showConfig, setShowConfig]           = useState(false)
  const [highlightTaskId, setHighlightTaskId] = useState(null)
  const [filtroClienteTarefas, setFiltroClienteTarefas] = useState(null)
  const [clienteAbrirEmpresas, setClienteAbrirEmpresas] = useState(null)
  const [showNotifs, setShowNotifs]           = useState(false)
  const [buscaAberta, setBuscaAberta]         = useState(false)
  const [theme, setTheme] = useState(temaInicial)
  useEffect(() => { salvarTema(theme) }, [theme])

  // Ctrl K (ou Cmd K) abre a busca rápida de telas
  useEffect(() => {
    const atalho = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBuscaAberta(true) }
    }
    window.addEventListener('keydown', atalho)
    return () => window.removeEventListener('keydown', atalho)
  }, [])

  const init       = useStore(s => s.init)
  const loading    = useStore(s => s.loading)
  const tarefas    = useStore(s => s.tarefas)
  const obrigacoes = useStore(s => s.obrigacoes || [])

  useEffect(() => { init() }, [])

  // Botão "Atualizar" do topo: busca de novo empresas, tarefas, obrigações e
  // fechamentos e remonta a tela aberta (key), que recarrega os próprios dados
  // (Pagamentos, Documentos, painéis...) — sem recarregar a página inteira.
  const [versaoPagina, setVersaoPagina] = useState(0)
  const [atualizando, setAtualizando] = useState(false)
  const atualizarDados = async () => {
    if (atualizando) return
    setAtualizando(true)
    const s = useStore.getState()
    await Promise.all([s.fetchClientes(), s.fetchTarefas(), s.fetchObrigacoes(), s.fetchFechamentos(),
      contarComprovantesPendentes().then(setComprovantesPendentes).catch(() => {})]).catch(() => {})
    setVersaoPagina(v => v + 1)
    setAtualizando(false)
  }

  // comprovantes do grupo "Pagamentos" esperando conferência (badge do menu);
  // falha silenciosa enquanto a tabela comprovantes_pagamento não existe
  const [comprovantesPendentes, setComprovantesPendentes] = useState(0)
  useEffect(() => {
    const atualizar = () => contarComprovantesPendentes().then(setComprovantesPendentes).catch(() => {})
    atualizar()
    const timer = setInterval(atualizar, 2 * 60 * 1000)
    return () => clearInterval(timer)
  }, [page])

  const pendingCount   = tarefas.filter(t => !t.concluida).length
  const obrigVencidas  = obrigacoes.filter(o => o.status === 'vencido').length
  const obrigPendentes = obrigacoes.filter(o => o.status === 'pendente').length

  // Vários lugares chamam isso direto como onClick={onAddTarefa} sem
  // envolver numa arrow function -- o React passa o SyntheticEvent do
  // clique como primeiro argumento nesse caso, sobrescrevendo o default
  // ''. Já aconteceu 2x (Overview.jsx e Tarefas.jsx) e quebrava a criação
  // de tarefa avulsa: o "cliente" virava o próprio evento de clique, que
  // o Supabase não consegue serializar (estrutura circular). Filtra aqui
  // pra não depender de todo callsite lembrar de embrulhar em arrow fn.
  const openNewTask = (clienteId = '') => { setNewTaskClienteId(typeof clienteId === 'string' ? clienteId : ''); setShowNewTask(true) }
  const navigate    = (p) => { setPage(p); if (p !== 'clientes') setSelectedCliente(null) }
  const badges = {
    tarefas:    { n: pendingCount, tipo: 'warn' },
    pagamentos: { n: comprovantesPendentes, tipo: 'warn' },
    empresas:   { n: obrigVencidas || obrigPendentes, tipo: obrigVencidas > 0 ? 'err' : 'warn' },
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="topbar-marca">
          <MenuCelular page={page} onNavigate={navigate} badges={badges} />
          <span className="topbar-logo" aria-hidden="true">G</span>
          <span className="topbar-title">Gestor</span>
        </div>
        <MenuTopo page={page} onNavigate={navigate} badges={badges} />
        <div style={{ flex:1 }} />
        <button type="button" className="busca-botao" onClick={() => setBuscaAberta(true)} title="Ir para uma tela (Ctrl K)">
          <SearchIcon size={16} /> <span className="busca-botao-texto">Ir para tela…</span> <kbd>Ctrl K</kbd>
        </button>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <button className="btn btn-icon btn-ghost" onClick={atualizarDados} disabled={atualizando}
            title={atualizando ? 'Atualizando...' : 'Atualizar dados desta tela (sem recarregar a página)'}>
            <RefreshCwIcon size={18} style={atualizando ? { animation:'spin 0.8s linear infinite' } : undefined} />
          </button>
          <SeletorTema tema={theme} onEscolher={setTheme} />
          <NotificacoesBell onClick={() => setShowNotifs(true)} />
          <button className="btn btn-icon btn-ghost" onClick={() => setShowConfig(true)} title="Configurações"><SettingsIcon size={18} /></button>
          <button className="btn btn-icon btn-ghost" onClick={sair} title="Sair"><LogOutIcon size={18} /></button>
        </div>
      </div>

      <div className="app-body">
      <main className="app-main">
        {loading && (page === 'overview' || page === 'hoje') ? (
          <div className="center"><div className="spinner" /></div>
        ) : (
          <Fragment key={versaoPagina}>
            {page === 'overview'   && <Overview onAddTarefa={openNewTask} onOpenCliente={(id) => { setSelectedCliente(id); navigate('clientes') }} onOpenEmpresa={(id) => { setClienteAbrirEmpresas(id); navigate('empresas') }} onOpenObrigacoes={() => navigate('empresas')} onOpenTarefas={() => navigate('tarefas')} onOpenContabil={() => navigate('contabil')} />}
            {page === 'empresas'   && <Empresas onOpenTarefas={(clienteId) => { setFiltroClienteTarefas(clienteId ?? null); navigate('tarefas') }}
              onOpenCadastro={(id) => { setSelectedCliente(id); navigate('clientes') }}
              clienteInicialId={clienteAbrirEmpresas} onClienteInicialConsumido={() => setClienteAbrirEmpresas(null)} />}
            {page === 'paineis'    && <PaineisPage />}
            {page === 'documentos' && <DocumentosPage arquivosIniciais={arquivosCapturados} onArquivosIniciaisConsumidos={() => setArquivosCapturados(null)} />}
            {page === 'hoje'       && <HojePage onNavigate={navigate} onAddTarefa={openNewTask}
              onCapturar={(arquivos) => { setArquivosCapturados(arquivos); navigate('documentos') }} />}
            {page === 'pagamentos' && <PagamentosPage />}
            {page === 'parcelamentos' && <ParcelamentosPage />}
            {page === 'notificacoes' && <NotificacoesPage />}
            {page === 'honorarios' && <HonorariosPage />}
            {page === 'tarefas'    && <Tarefas onAddTarefa={openNewTask} highlightTaskId={highlightTaskId} onHighlightConsumed={() => setHighlightTaskId(null)}
              clienteFilterInicial={filtroClienteTarefas} onClienteFilterConsumido={() => setFiltroClienteTarefas(null)} />}
            {page === 'clientes'   && <Clientes onAddTarefa={openNewTask} selectedId={selectedCliente} onSelect={setSelectedCliente} />}
            {page === 'prospectos' && <Prospectos />}
            {page === 'erp'        && <FechamentosERP onOpenConfig={() => setShowConfig(true)} />}
            {page === 'contabil'   && <ContabilPage />}
            {page === 'notasfiscais' && <NotasFiscaisPage />}
            {page === 'nfse' && <NfseEmissaoPage />}
            {page === 'assessor'   && <AssessorPage onNavigate={navigate} />}
            {page === 'agenda'     && <AgendaPage />}
            {page === 'central'    && <Central />}
          </Fragment>
        )}
      </main>
      </div>

      <button className="fab" onClick={() => openNewTask()} title="Nova tarefa"><PlusIcon size={22} /></button>

      {showNewTask && <NovaTarefaModal clienteIdInicial={newTaskClienteId} onClose={() => setShowNewTask(false)} />}
      {showConfig  && <OneflowConfigModal onClose={() => setShowConfig(false)} />}
      {showNotifs  && <NotificacoesPanel onClose={() => setShowNotifs(false)} />}
      <BuscaRapida aberta={buscaAberta} onFechar={() => setBuscaAberta(false)} onNavigate={navigate} badges={badges} />
      <ToastContainer />
    </div>
  )
}
