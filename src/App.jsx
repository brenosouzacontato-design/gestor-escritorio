import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { RefreshCwIcon, SettingsIcon, PlusIcon, LogOutIcon, SearchIcon } from 'lucide-react'
import { MenuTopo, BuscaRapida, MenuCelular, NAV } from './components/MenuTopo'
import { temaInicial, salvarTema } from './lib/tema'
import SeletorTema from './components/SeletorTema'
import { useStore } from './store'
import { useTelaNoHistorico } from './lib/historico'
import { ToastContainer } from './components/shared'
import { AvisoPainelHost } from './components/AvisoPainelModal'
import { AbasTelas, abasSalvas, salvarAbas, MAX_ABAS, ehAbaEmpresa, abaDaEmpresa, empresaDaAba } from './components/AbasTelas'
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
import EcacPage from './pages/ecac/EcacPage'
import { contarComprovantesPendentes } from './pages/pagamentos/pagamentosApi'
import NotificacoesPage from './pages/Notificacoes'
import HonorariosPage from './pages/honorarios/HonorariosPage'
import PaineisPage from './pages/painel/PaineisPage'
import NotasFiscaisPage from './pages/notasfiscais/NotasFiscaisPage'
import NfseEmissaoPage from './pages/nfse/NfseEmissaoPage'
import NfseMeiPage from './pages/nfse/NfseMeiPage'
import AssessorPage from './pages/assessor/AssessorPage'
import AgendaPage from './pages/agenda/AgendaPage'
import HojePage from './pages/hoje/HojePage'
import LicenciamentoPage from './pages/licenciamento/LicenciamentoPage'
import CentralEntregasPage from './pages/entregas/CentralEntregasPage'
import PedidosNfePage from './pages/pedidonfe/PedidosNfePage'
import AdmissoesPage from './pages/admissao/AdmissoesPage'
import EmpresaAbaPage from './pages/empresa/EmpresaAbaPage'

// Tela inicial pela URL (?tela=hoje, ?tela=documentos…) — é o que o app
// instalado no tablet usa (start_url e atalhos do gestor.webmanifest).
const paramsIniciais = new URLSearchParams(window.location.search)
const telaUrl = paramsIniciais.get('tela')
const TELA_INICIAL = NAV.some(i => i.id === telaUrl) ? telaUrl : 'overview'
const ABRIR_NOVA_TAREFA = paramsIniciais.get('acao') === 'nova-tarefa'
// ?tarefa=<id> — vem do toque na notificação de lembrete: abre a tarefa
const TAREFA_URL = /^[0-9a-f-]{36}$/i.test(paramsIniciais.get('tarefa') || '') ? paramsIniciais.get('tarefa') : null

export default function App() {
  // tela atual (+ cliente aberto na tela Clientes) no histórico do navegador:
  // o voltar do navegador/celular retorna à tela anterior
  const [tela, irPara] = useTelaNoHistorico('tela', { page: TELA_INICIAL, cliente: null })
  const page = tela.page
  const selectedCliente = tela.cliente
  const setSelectedCliente = (id) => irPara((t) => ({ ...t, cliente: id }))
  const [showNewTask, setShowNewTask]         = useState(ABRIR_NOVA_TAREFA)
  // fotos/arquivos capturados na tela Hoje, entregues à tela Documentos (IA identifica)
  const [arquivosCapturados, setArquivosCapturados] = useState(null)
  const [newTaskClienteId, setNewTaskClienteId] = useState('')
  const [showConfig, setShowConfig]           = useState(false)
  const [highlightTaskId, setHighlightTaskId] = useState(TAREFA_URL)
  const [filtroClienteTarefas, setFiltroClienteTarefas] = useState(null)
  const [clienteAbrirEmpresas, setClienteAbrirEmpresas] = useState(null)
  const [showNotifs, setShowNotifs]           = useState(false)
  const [buscaAberta, setBuscaAberta]         = useState(false)
  const [theme, setTheme] = useState(temaInicial)
  useEffect(() => { salvarTema(theme) }, [theme])

  // Multi-telas: telas abertas em abas. `montadas` = abas já visitadas nesta
  // sessão (as que vieram salvas do localStorage só carregam ao clicar).
  const [abas, setAbas] = useState(() => abasSalvas(TELA_INICIAL))
  const [montadas, setMontadas] = useState(() => new Set([TELA_INICIAL]))
  const [versoes, setVersoes] = useState({}) // remonta uma aba (Atualizar, filtro inicial novo)
  const [clienteDaAba, setClienteDaAba] = useState(null) // cliente aberto na aba Clientes
  useEffect(() => {
    setMontadas((m) => m.has(page) ? m : new Set(m).add(page))
    setAbas((lista) => {
      if (lista.includes(page)) return lista
      const nova = [...lista, page]
      // passou do limite: fecha a aba de tela mais antiga (nunca a atual);
      // abas de empresa são lembretes, só saem se não houver tela comum
      while (nova.length > MAX_ABAS) {
        let i = nova.findIndex((id) => id !== page && !ehAbaEmpresa(id))
        if (i < 0) i = nova.findIndex((id) => id !== page)
        nova.splice(i, 1)
      }
      return nova
    })
    if (page === 'clientes') setClienteDaAba(selectedCliente)
  }, [page, selectedCliente])
  useEffect(() => { salvarAbas(abas) }, [abas])
  const remontar = (id) => setVersoes((v) => ({ ...v, [id]: (v[id] || 0) + 1 }))
  const fecharAba = (id) => {
    const resto = abas.filter((a) => a !== id)
    if (!resto.length) return
    setAbas(resto)
    setMontadas((m) => { const n = new Set(m); n.delete(id); return n })
    if (id === page) {
      const i = abas.indexOf(id)
      const proxima = resto[Math.min(i, resto.length - 1)]
      irPara({ page: proxima, cliente: proxima === 'clientes' ? clienteDaAba : null })
    }
  }

  // Ctrl K (ou Cmd K) abre a busca rápida de telas e empresas
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
  const clientes   = useStore(s => s.clientes)
  const obrigacoes = useStore(s => s.obrigacoes || [])

  useEffect(() => { init() }, [])

  // Botão "Atualizar" do topo: busca de novo empresas, tarefas, obrigações e
  // fechamentos e remonta a tela aberta (key), que recarrega os próprios dados
  // (Pagamentos, Documentos, painéis...) — sem recarregar a página inteira.
  const [atualizando, setAtualizando] = useState(false)
  const atualizarDados = async () => {
    if (atualizando) return
    setAtualizando(true)
    const s = useStore.getState()
    await Promise.all([s.fetchClientes(), s.fetchTarefas(), s.fetchObrigacoes(), s.fetchFechamentos(),
      contarComprovantesPendentes().then(setComprovantesPendentes).catch(() => {})]).catch(() => {})
    remontar(page)
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
  const navigate    = (p, cliente = null) => {
    // Clientes sem cliente indicado volta pro que estava aberto na aba
    const c = p === 'clientes' ? (cliente ?? (abas.includes('clientes') && page !== 'clientes' ? clienteDaAba : null)) : null
    irPara({ page: p, cliente: c })
  }
  const abrirEmpresaEmAba = (clienteId) => { if (clienteId) irPara({ page: abaDaEmpresa(clienteId), cliente: null }) }
  const abrirNoFechamento = (clienteId) => { setClienteAbrirEmpresas(clienteId); navigate('empresas') }
  const badges = {
    tarefas:    { n: pendingCount, tipo: 'warn' },
    pagamentos: { n: comprovantesPendentes, tipo: 'warn' },
    empresas:   { n: obrigVencidas || obrigPendentes, tipo: obrigVencidas > 0 ? 'err' : 'warn' },
  }

  const rotulosAbas = useMemo(() => {
    const curto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '')
    const rot = {}
    const c = clienteDaAba && clientes.find((x) => x.id === clienteDaAba)
    if (c) rot.clientes = `Clientes · ${curto(c.nome)}`
    for (const id of abas) {
      if (!ehAbaEmpresa(id)) continue
      const e = clientes.find((x) => x.id === empresaDaAba(id))
      rot[id] = e ? curto(e.nome) : 'Empresa'
    }
    return rot
  }, [clienteDaAba, clientes, abas])

  // cada aba guarda a própria rolagem
  const mainRef = useRef(null)
  const rolagens = useRef({})
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = rolagens.current[page] || 0
  }, [page])
  const abasNaTela = abas.includes(page) ? abas : [...abas, page]

  // Conteúdo de cada tela (as abas abertas ficam montadas ao mesmo tempo)
  const renderTela = (id) => {
    if (loading && (id === 'overview' || id === 'hoje')) return <div className="center"><div className="spinner" /></div>
    if (ehAbaEmpresa(id)) return <EmpresaAbaPage clienteId={empresaDaAba(id)} onNavigate={navigate} onAddTarefa={openNewTask}
      onAbrirFechamento={abrirNoFechamento} onFecharAba={() => fecharAba(id)}
      onAbrirTarefas={(clienteId) => { setFiltroClienteTarefas(clienteId); remontar('tarefas'); navigate('tarefas') }} />
    switch (id) {
      case 'overview': return <Overview onAddTarefa={openNewTask} onOpenCliente={(id) => navigate('clientes', id)} onOpenEmpresa={(id) => { setClienteAbrirEmpresas(id); navigate('empresas') }} onOpenObrigacoes={() => navigate('empresas')} onOpenTarefas={() => navigate('tarefas')} onOpenContabil={() => navigate('contabil')} />
      case 'empresas': return <Empresas onOpenTarefas={(clienteId) => { setFiltroClienteTarefas(clienteId ?? null); remontar('tarefas'); navigate('tarefas') }}
        onOpenCadastro={(id) => navigate('clientes', id)} onAbrirAba={abrirEmpresaEmAba}
        clienteInicialId={clienteAbrirEmpresas} onClienteInicialConsumido={() => setClienteAbrirEmpresas(null)} />
      case 'paineis': return <PaineisPage />
      case 'entregas': return <CentralEntregasPage />
      case 'documentos': return <DocumentosPage arquivosIniciais={arquivosCapturados} onArquivosIniciaisConsumidos={() => setArquivosCapturados(null)} />
      case 'hoje': return <HojePage onNavigate={navigate} onAddTarefa={openNewTask}
        onCapturar={(arquivos) => { setArquivosCapturados(arquivos); navigate('documentos') }} />
      case 'pagamentos': return <PagamentosPage />
      case 'parcelamentos': return <ParcelamentosPage />
      case 'ecac': return <EcacPage />
      case 'notificacoes': return <NotificacoesPage />
      case 'honorarios': return <HonorariosPage />
      case 'tarefas': return <Tarefas onAddTarefa={openNewTask} highlightTaskId={highlightTaskId} onHighlightConsumed={() => setHighlightTaskId(null)}
        clienteFilterInicial={filtroClienteTarefas} onClienteFilterConsumido={() => setFiltroClienteTarefas(null)} />
      case 'clientes': return <Clientes onAddTarefa={openNewTask} selectedId={id === page ? selectedCliente : clienteDaAba} onSelect={setSelectedCliente} onAbrirAba={abrirEmpresaEmAba} />
      case 'prospectos': return <Prospectos />
      case 'erp': return <FechamentosERP onOpenConfig={() => setShowConfig(true)} />
      case 'contabil': return <ContabilPage />
      case 'notasfiscais': return <NotasFiscaisPage />
      case 'nfse': return <NfseEmissaoPage />
      case 'nfsemei': return <NfseMeiPage />
      case 'pedidosnfe': return <PedidosNfePage />
      case 'admissoes': return <AdmissoesPage />
      case 'assessor': return <AssessorPage onNavigate={navigate} />
      case 'agenda': return <AgendaPage />
      case 'licenciamento': return <LicenciamentoPage />
      case 'central': return <Central />
      default: return null
    }
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
        <button type="button" className="busca-botao" onClick={() => setBuscaAberta(true)} title="Buscar tela ou empresa (Ctrl K)">
          <SearchIcon size={16} /> <span className="busca-botao-texto">Buscar tela ou empresa…</span> <kbd>Ctrl K</kbd>
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

      <AbasTelas abas={abas} ativa={page} rotulos={rotulosAbas} onEscolher={(id) => navigate(id)} onFechar={fecharAba} />

      <div className="app-body">
      <main className="app-main" ref={mainRef} onScroll={(e) => { rolagens.current[page] = e.currentTarget.scrollTop }}>
          {abasNaTela.filter((id) => montadas.has(id) || id === page).map((id) => (
            <div key={`${id}-${versoes[id] || 0}`} style={{ display: id === page ? 'contents' : 'none' }}>
              {renderTela(id)}
            </div>
          ))}
      </main>
      </div>

      <button className="fab" onClick={() => openNewTask()} title="Nova tarefa"><PlusIcon size={22} /></button>

      {showNewTask && <NovaTarefaModal clienteIdInicial={newTaskClienteId} onClose={() => setShowNewTask(false)} />}
      {showConfig  && <OneflowConfigModal onClose={() => setShowConfig(false)} />}
      {showNotifs  && <NotificacoesPanel onClose={() => setShowNotifs(false)} />}
      <BuscaRapida aberta={buscaAberta} onFechar={() => setBuscaAberta(false)} onNavigate={navigate} badges={badges}
        onAbrirEmpresa={abrirNoFechamento} onAbrirCadastro={(id) => navigate('clientes', id)} onAbrirAba={abrirEmpresaEmAba} />
      <ToastContainer />
      <AvisoPainelHost />
    </div>
  )
}
