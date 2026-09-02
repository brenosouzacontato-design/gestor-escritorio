import { useState, useMemo, useEffect } from 'react'
import { PlusIcon, XIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, ChevronRightIcon, CalendarIcon, CheckIcon, ZapIcon, RefreshCwIcon, Trash2Icon, ListIcon, LayoutGridIcon, BarChart3Icon, Share2Icon, EyeIcon, CheckSquareIcon, FileIcon, DownloadIcon, PencilIcon, FileTextIcon, GripVerticalIcon, BellIcon, BellRingIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue, useToast } from '../components/shared'
import { supabase } from '../lib/supabase'
import { listarDepartamentos, criarDepartamento, gerarObrigacoesRecorrentesCompetencia } from './andamento/andamentoApi'
import { NovaObrigacaoModal, NovaTarefaModuloModal, ModalTarefasLote, ModalObrigacoesLote, ModalBase } from './andamento/modaisObrigacao'
import { uploadDeclaracaoSimples, uploadSituacaoFiscal, obterCndManual, salvarCndManual } from './painel/painelApi'
import PainelViewerModal from './painel/PainelViewerModal'
import { listarDocumentosPorCliente, criarLinkAssinado } from './documentos/documentosApi'
import { criarLembrete, listarLembretesPorItens, excluirLembrete } from './andamento/lembretesApi'

// Casamento histórico tipo-texto → departamento, só pra competências
// anteriores à adoção do modelo novo (departamento_id em obrigacoes, ver
// supabase-schema-andamento-recorrencia.sql). "Legalização" é o nome novo
// de "Societário" (mesmo registro, renomeado no banco), por isso a chave
// aqui já é o nome atual. "Escritório" não entra mais — deixou de ser
// módulo; "Parcelamento" (única obrigação que só existia lá) vira tarefa
// avulsa sem módulo se precisar.
const LEGACY_DEPT_TIPOS = {
  'Fiscal':      ['PGDAS', 'DCTFWeb', 'NFS-e'],
  'Folha':       ['eSocial', 'Folha'],
  'Legalização': ['Documentos'],
  'Contábil':    ['Extrato Bancário'],
}

const STATUS_OBS       = ['pendente','concluido','nao_aplica','vencido']
const STATUS_OBS_LABEL = { pendente:'Pendente', concluido:'Concluído', nao_aplica:'N/A', vencido:'Vencido' }
const STATUS_OBS_COLOR = {
  pendente:   { bg:'var(--warn-dim)', color:'var(--warn)' },
  concluido:  { bg:'var(--ok-dim)',   color:'var(--ok)' },
  nao_aplica: { bg:'var(--info-dim)', color:'var(--info)' },
  vencido:    { bg:'var(--danger-dim)', color:'var(--danger)' },
}

// Obrigação pendente cujo vencimento está dentro da janela de lembrete do
// seu tipo (dias_lembrete, embutido via fetchObrigacoes's nested select em
// store/index.js) — "vence em breve", distinto de "vencido" (já passou).
function isVencendo(o) {
  if (o.status !== 'pendente' || !o.vencimento) return false
  const dias = o.tipos_obrigacao?.dias_lembrete
  if (dias == null) return false
  const hoje = new Date(new Date().toDateString())
  const venc = new Date(o.vencimento + 'T00:00:00')
  const diff = Math.round((venc - hoje) / 86400000)
  return diff >= 0 && diff <= dias
}

// dept: linha da tabela "departamentos" ({id, nome, icone}). Une as duas
// fontes de obrigação pra essa competência — modelo novo (departamento_id)
// e modelo legado (tipo-texto, só existe em competências antigas).
function getStatusDept(obsEmp, tarefasEmp, dept) {
  const tiposLegado = LEGACY_DEPT_TIPOS[dept.nome] || []
  const obs   = obsEmp.filter(o => o.departamento_id === dept.id || tiposLegado.includes(o.tipo))
  const tasks = tarefasEmp.filter(t => (t.departamento_id === dept.id || (t.departamento||'').toLowerCase() === dept.nome.toLowerCase()) && !t.concluida)
  if (obs.length === 0 && tasks.length === 0) return { s:'empty', pct:0, val:'—' }
  const ok       = obs.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
  const venc     = obs.filter(o => o.status==='vencido').length
  const vencendo = obs.some(isVencendo)
  const naAll = obs.length > 0 && obs.every(o => o.status==='nao_aplica')
  if (naAll) return { s:'na', pct:100, val:'N/A' }
  const pct = obs.length > 0 ? Math.round((ok/obs.length)*100) : 0
  const s   = venc > 0 ? 'danger' : vencendo ? 'venc_breve' : pct===100 ? 'ok' : obs.filter(o=>o.status==='pendente').length > 0 ? 'warn' : 'empty'
  return { s, pct, val: obs.length > 0 ? `${ok}/${obs.length}` : tasks.length > 0 ? `${tasks.length}t` : '—' }
}

const COR_VENCENDO = '#C2410C'
const S_COLOR = { ok:'var(--ok)', warn:'var(--warn)', venc_breve:COR_VENCENDO, danger:'var(--danger)', na:'var(--info)', empty:'var(--text3)' }
const S_BG    = { ok:'var(--ok-dim)', warn:'var(--warn-dim)', venc_breve:'rgba(194,65,12,.12)', danger:'var(--danger-dim)', na:'var(--info-dim)', empty:'var(--surface2)' }
const S_ICON  = { ok:CheckCircleIcon, warn:ClockIcon, venc_breve:AlertCircleIcon, danger:AlertCircleIcon, na:MinusCircleIcon, empty:null }

const AVATAR_COLORS = [
  ['#1a2e22','#34d399'],['#2a1f10','#fbbf24'],['#18203a','var(--accent)'],
  ['#2a1820','#f9a8d4'],['#1e1a30','#c4b5fd'],['#182828','#5eead4'],
  ['#1a2a1a','#86efac'],['#1e2a2a','#67e8f9'],['#2a1a1a','#fca5a5'],
]

function DeptPill({ data, onClick }) {
  const Icon = S_ICON[data.s]
  return (
    <div onClick={e => { e.stopPropagation(); onClick() }}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'9px 10px',
        borderRadius:10, background:S_BG[data.s], border:'1px solid transparent',
        cursor:'pointer', minWidth:88, transition:'border-color .12s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
      onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        {Icon && <Icon size={16} color={S_COLOR[data.s]} />}
        <span style={{ fontSize:15, fontWeight:700, color:S_COLOR[data.s] }}>
          {data.s==='empty'?'—':data.s==='na'?'N/A':`${data.pct}%`}
        </span>
      </div>
      <div style={{ width:60, height:5, background:'var(--border)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${data.pct}%`, background:S_COLOR[data.s], borderRadius:99 }} />
      </div>
      <span style={{ fontSize:11, color:'var(--text3)', fontWeight:600 }}>{data.val}</span>
    </div>
  )
}

export default function Empresas({ onOpenTarefas, clienteInicialId, onClienteInicialConsumido }) {
  const clientes        = useStore(s => s.clientes)
  const obrigacoes      = useStore(s => s.obrigacoes || [])
  const tarefas         = useStore(s => s.tarefas)
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const fetchTarefas    = useStore(s => s.fetchTarefas)
  const deleteCliente   = useStore(s => s.deleteCliente)
  const { show }        = useToast()

  // Competência única do app — só o Painel tem o seletor; essa tela lê o
  // mesmo valor do store, sem controle próprio.
  const compSel = useStore(s => s.competenciaSelecionada)
  const [busca,       setBusca]       = useState('')
  const [filtro,      setFiltro]      = useState('todos')
  const [carteira,    setCarteira]    = useState('todas')
  const [visualizacao, setVisualizacao] = useState(() => localStorage.getItem('empresas-visualizacao') || 'tabela')
  // Ordem manual dos cards (arrastar e soltar) — persistida no navegador,
  // guarda só os ids na ordem escolhida; empresas fora da lista (novas ou
  // que nunca foram arrastadas) ficam no fim, na ordem natural.
  const [ordemCards, setOrdemCards] = useState(() => {
    try { return JSON.parse(localStorage.getItem('empresas-ordem-cards') || '[]') } catch { return [] }
  })
  const [arrastandoId, setArrastandoId] = useState(null)
  const [departamentos,setDepartamentos] = useState([])
  const [showAddDept, setShowAddDept] = useState(false)
  const [novoDept,    setNovoDept]    = useState('')
  const [drawer,      setDrawer]      = useState(null) // {c, dept}
  const [drawerTab,   setDrawerTab]   = useState('obrig')
  const [updatingId,  setUpdatingId]  = useState(null)
  const [nomeColW,    setNomeColW]    = useState(200)
  const [gerando,     setGerando]     = useState(false)
  // Modal nova obrigação / nova tarefa / tarefas em lote
  const [showNovaObs,     setShowNovaObs]     = useState(false)
  const [showNovaTarefa,  setShowNovaTarefa]  = useState(false)
  const [loteDept,         setLoteDept]       = useState(null) // dept aberto pro modal de tarefas em lote
  const [showLoteObs,      setShowLoteObs]    = useState(false)
  const [tarefaEditando,   setTarefaEditando] = useState(null) // tarefa aberta pro modal de edição
  const [lembreteAlvo,     setLembreteAlvo]   = useState(null) // {obrigacaoId} ou {tarefaId} aberto pro modal de lembrete
  const [showCndManual,   setShowCndManual]   = useState(false) // modal de marcar CND estadual/municipal
  const [painelViewer,    setPainelViewer]    = useState(null) // {indiceInicial} — abre o carrossel de painéis a partir da empresa do drawer
  const [lembretesPendentes, setLembretesPendentes] = useState([]) // dos itens do drawer aberto

  const carregarDepartamentos = () => listarDepartamentos().then(setDepartamentos).catch(() => {})
  useEffect(() => { carregarDepartamentos() }, [])

  const carteiras = useMemo(() => {
    const s = new Set(clientes.map(c => c.carteira).filter(Boolean))
    return ['todas', ...Array.from(s).sort()]
  }, [clientes])

  const rows = useMemo(() => {
    const termo = busca.toLowerCase()
    return clientes
      .filter(c => {
        if (termo && !c.nome.toLowerCase().includes(termo) && !c.cnpj?.includes(termo)) return false
        if (carteira !== 'todas' && c.carteira !== carteira) return false
        return true
      })
      .map(c => {
        const obsEmp   = obrigacoes.filter(o => o.cliente_id===c.id && o.competencia===compSel)
        const tasksEmp = tarefas.filter(t => t.cliente_id===c.id)
        const deptData = {}
        departamentos.forEach(d => { deptData[d.id] = getStatusDept(obsEmp, tasksEmp, d) })
        const hasDanger = Object.values(deptData).some(d => d.s==='danger')
        const hasPend   = Object.values(deptData).some(d => d.s==='warn')
        const allOk     = Object.values(deptData).every(d => d.s==='ok'||d.s==='na'||d.s==='empty')
        return { c, deptData, hasDanger, hasPend, allOk }
      })
      .filter(r => {
        if (filtro==='criticos')  return r.hasDanger
        if (filtro==='pendentes') return r.hasPend || r.hasDanger
        if (filtro==='ok')        return r.allOk
        return true
      })
  }, [clientes, obrigacoes, tarefas, compSel, busca, departamentos, filtro, carteira])

  // Aplica a ordem manual (visão cards) por cima do resultado filtrado —
  // empresas com posição salva vêm primeiro nessa ordem, o resto mantém a
  // ordem natural de `rows` (Array.sort é estável).
  const rowsCards = useMemo(() => {
    if (ordemCards.length === 0) return rows
    const pos = new Map(ordemCards.map((id, i) => [id, i]))
    return [...rows].sort((a, b) => {
      const pa = pos.has(a.c.id) ? pos.get(a.c.id) : Infinity
      const pb = pos.has(b.c.id) ? pos.get(b.c.id) : Infinity
      return pa - pb
    })
  }, [rows, ordemCards])

  const handleDropCard = (targetId) => {
    const arrastado = arrastandoId
    setArrastandoId(null)
    if (!arrastado || arrastado === targetId) return
    const ids = rowsCards.map(r => r.c.id)
    const de = ids.indexOf(arrastado)
    const para = ids.indexOf(targetId)
    if (de === -1 || para === -1) return
    const nova = [...ids]
    nova.splice(de, 1)
    nova.splice(para, 0, arrastado)
    setOrdemCards(nova)
    localStorage.setItem('empresas-ordem-cards', JSON.stringify(nova))
  }

  // Drawer: leitura direta do store (sem useMemo) para refletir mudanças imediatas
  const drawerObs = !drawer ? [] : obrigacoes.filter(o => {
    if (o.cliente_id !== drawer.c.id || o.competencia !== compSel) return false
    if (!drawer.dept) return true
    const tiposLegado = LEGACY_DEPT_TIPOS[drawer.dept.nome] || []
    return o.departamento_id === drawer.dept.id || tiposLegado.includes(o.tipo)
  })
  const drawerTasks = !drawer ? [] : tarefas.filter(t => {
    if (t.cliente_id !== drawer.c.id) return false
    if (!drawer.dept) return true
    return t.departamento_id === drawer.dept.id || (t.departamento||'').toLowerCase() === drawer.dept.nome.toLowerCase()
  })

  // Lembretes pendentes dos itens do drawer aberto — alimenta o sino
  // preenchido nas linhas de obrigação/tarefa.
  useEffect(() => {
    if (!drawer) { setLembretesPendentes([]); return }
    listarLembretesPorItens({ obrigacaoIds: drawerObs.map(o => o.id), tarefaIds: drawerTasks.map(t => t.id) })
      .then(setLembretesPendentes)
      .catch(() => {})
  }, [drawer, drawerObs.length, drawerTasks.length])

  const lembreteDoItem = (obrigacaoId, tarefaId) =>
    lembretesPendentes.find(l => (obrigacaoId && l.obrigacao_id === obrigacaoId) || (tarefaId && l.tarefa_id === tarefaId))

  const recarregarLembretes = () =>
    listarLembretesPorItens({ obrigacaoIds: drawerObs.map(o => o.id), tarefaIds: drawerTasks.map(t => t.id) })
      .then(setLembretesPendentes).catch(() => {})

  const openDrawer = (c, dept) => { setDrawer({c, dept}); setDrawerTab('obrig') }

  // Abre o modal de uma empresa específica quando pedido de fora (ex: ao
  // clicar num cliente dentro de um card do Painel) — mesmo padrão de
  // filtroClienteTarefas no App.jsx/Tarefas.jsx.
  useEffect(() => {
    if (!clienteInicialId) return
    const c = clientes.find(cl => cl.id === clienteInicialId)
    if (c) openDrawer(c, null)
    onClienteInicialConsumido?.()
  }, [clienteInicialId, clientes])

  const escolherVisualizacao = (v) => { setVisualizacao(v); localStorage.setItem('empresas-visualizacao', v) }

  // Upload da Declaração do Simples — sobe pro Storage, IA extrai os
  // números gerenciais (faturamento, RBT12, alíquota, DAS) e grava em
  // dados_gerenciais_simples pra aparecer no painel compartilhável.
  const [enviandoDeclaracao, setEnviandoDeclaracao] = useState(false)
  const handleUploadDeclaracao = async (cliente, arquivo) => {
    if (!arquivo) return
    setEnviandoDeclaracao(true)
    try {
      const salvo = await uploadDeclaracaoSimples(arquivo, compSel, { clienteId: cliente.id })
      show?.(`Declaração processada — competência ${salvo.competencia}${salvo.faturamento_periodo ? `, faturamento R$ ${Number(salvo.faturamento_periodo).toLocaleString('pt-BR')}` : ''}${salvo.historicoPreenchido > 0 ? ` · +${salvo.historicoPreenchido} mês${salvo.historicoPreenchido !== 1 ? 'es' : ''} anterior${salvo.historicoPreenchido !== 1 ? 'es' : ''} preenchido${salvo.historicoPreenchido !== 1 ? 's' : ''}` : ''}`)
    } catch (e) {
      show?.('Erro ao processar declaração: ' + e.message)
    }
    setEnviandoDeclaracao(false)
  }

  // Upload do Relatório de Situação Fiscal (RFB) — sobe pro Storage, IA
  // extrai situação geral, débitos, parcelamentos e dívidas ativas (PGFN)
  // e grava em situacao_fiscal_rfb pra aparecer no painel compartilhável.
  const [enviandoSituacaoFiscal, setEnviandoSituacaoFiscal] = useState(false)
  const handleUploadSituacaoFiscal = async (cliente, arquivo) => {
    if (!arquivo) return
    setEnviandoSituacaoFiscal(true)
    try {
      const salvo = await uploadSituacaoFiscal(arquivo, compSel, { clienteId: cliente.id })
      show?.(`Situação fiscal processada — ${salvo.situacao_geral === 'regular' ? 'sem pendências' : salvo.situacao_geral === 'pendente' ? 'com pendências' : 'situação não identificada'}`)
    } catch (e) {
      show?.('Erro ao processar relatório: ' + e.message)
    }
    setEnviandoSituacaoFiscal(false)
  }

  // Link público do painel consolidado (PainelClientePage.jsx via main.jsx)
  const linkPainel = (cliente) => `${window.location.origin}${window.location.pathname}?painel=${cliente.id}&competencia=${encodeURIComponent(compSel)}`

  // Abre o carrossel interno de painéis (PainelViewerModal) começando na
  // empresa clicada, na mesma ordem/filtro da visão ativa (cards respeita a
  // ordem manual arrastada; tabela usa a ordem natural) — dá pra ir
  // passando pro lado sem voltar pra lista a cada empresa.
  const handleVisualizarPainel = (cliente) => {
    const listaAtual = (visualizacao === 'cards' ? rowsCards : rows).map(r => r.c)
    const indiceInicial = listaAtual.findIndex(c => c.id === cliente.id)
    setPainelViewer({ clientes: listaAtual, indiceInicial: indiceInicial >= 0 ? indiceInicial : 0 })
  }

  const handleCompartilharPainel = (cliente) => {
    const mensagem = `Olá! Segue o painel de ${cliente.nome} — competência ${compSel} — com obrigações, financeiro e demais informações:\n${linkPainel(cliente)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  // Upload "às cegas" (sem empresa pré-selecionada) — manda a lista de
  // clientes pra IA identificar por nome/CNPJ dentro do documento, e ao
  // identificar já abre o modal da empresa + o painel público dela, pra
  // poupar o passo de achar a empresa manualmente antes.
  const clientesParaDetectar = clientes.map(c => ({ id: c.id, nome: c.nome, cnpj: c.cnpj }))

  const aoDetectarEmpresa = (salvo) => {
    const cliente = clientes.find(c => c.id === salvo.cliente_id)
    if (!cliente) return
    openDrawer(cliente, null)
    window.open(linkPainel(cliente), '_blank')
    return cliente
  }

  const [enviandoDeclaracaoAuto, setEnviandoDeclaracaoAuto] = useState(false)
  const handleUploadDeclaracaoAuto = async (arquivo) => {
    if (!arquivo) return
    setEnviandoDeclaracaoAuto(true)
    try {
      const salvo = await uploadDeclaracaoSimples(arquivo, compSel, { clientes: clientesParaDetectar })
      const cliente = aoDetectarEmpresa(salvo)
      const sufixoHistorico = salvo.historicoPreenchido > 0 ? ` · +${salvo.historicoPreenchido} mês${salvo.historicoPreenchido !== 1 ? 'es' : ''} anterior${salvo.historicoPreenchido !== 1 ? 'es' : ''} preenchido${salvo.historicoPreenchido !== 1 ? 's' : ''}` : ''
      show?.((cliente ? `Empresa identificada: ${cliente.nome} — declaração processada` : 'Declaração processada') + sufixoHistorico)
    } catch (e) {
      show?.('Erro: ' + e.message)
    }
    setEnviandoDeclaracaoAuto(false)
  }

  const [enviandoSituacaoFiscalAuto, setEnviandoSituacaoFiscalAuto] = useState(false)
  const handleUploadSituacaoFiscalAuto = async (arquivo) => {
    if (!arquivo) return
    setEnviandoSituacaoFiscalAuto(true)
    try {
      const salvo = await uploadSituacaoFiscal(arquivo, compSel, { clientes: clientesParaDetectar })
      const cliente = aoDetectarEmpresa(salvo)
      show?.(cliente ? `Empresa identificada: ${cliente.nome} — relatório processado` : 'Relatório processado')
    } catch (e) {
      show?.('Erro: ' + e.message)
    }
    setEnviandoSituacaoFiscalAuto(false)
  }

  // Soft-delete (marca ativo=false) — obrigações/tarefas/lançamentos já
  // gerados continuam existindo, só a empresa some das listagens.
  const handleDeleteCliente = async (c) => {
    if (!window.confirm(`Excluir "${c.nome}"? A empresa deixa de aparecer nas listagens (histórico de lançamentos e obrigações é preservado).`)) return
    setDrawer(null)
    const { error } = await deleteCliente(c.id)
    show?.(error ? `Erro: ${error.message}` : `"${c.nome}" excluída`)
  }

  const handleResizeNome = (e) => {
    e.preventDefault()
    const sx = e.clientX, sw = nomeColW
    const mv = ev => setNomeColW(Math.max(140, Math.min(420, sw + ev.clientX - sx)))
    const up = () => { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up) }
    window.addEventListener('mousemove',mv)
    window.addEventListener('mouseup',up)
  }

  // Mudar status da obrigação diretamente via supabase + refetch
  const handleStatusObs = async (obsId, novoStatus) => {
    setUpdatingId(obsId)
    await supabase.from('obrigacoes').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', obsId)
    await fetchObrigacoes()
    setUpdatingId(null)
  }

  // Toggle tarefa diretamente via supabase + refetch
  const handleToggleTask = async (t) => {
    setUpdatingId(t.id)
    const concluida = !t.concluida
    await supabase.from('tarefas').update({ concluida, concluida_em: concluida ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', t.id)
    await fetchTarefas()
    setUpdatingId(null)
  }

  const handleDeleteTask = async (t) => {
    if (!window.confirm(`Excluir a tarefa "${t.titulo}"?`)) return
    setUpdatingId(t.id)
    await supabase.from('tarefas').delete().eq('id', t.id)
    await fetchTarefas()
    setUpdatingId(null)
  }

  const handleAddDept = async () => {
    const nome = novoDept.trim()
    if (!nome) return
    try {
      await criarDepartamento(nome)
      await carregarDepartamentos()
      show?.(`Módulo "${nome}" criado`)
    } catch (e) { show?.('Erro: ' + e.message) }
    setNovoDept(''); setShowAddDept(false)
  }

  const handleGerarCompetencia = async () => {
    setGerando(true)
    try {
      const n = await gerarObrigacoesRecorrentesCompetencia(compSel, clientes.map(c => c.id))
      await fetchObrigacoes()
      show?.(n > 0 ? `${n} obrigação${n!==1?'ões':''} gerada${n!==1?'s':''} para ${compSel}` : `Nada novo pra gerar em ${compSel}`)
    } catch (e) { show?.('Erro: ' + e.message) }
    setGerando(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', overflow:'hidden' }}>

      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap', rowGap:6 }}>
        <div>
          <h2 style={{ fontSize:14, fontWeight:500, color:'var(--text1)', margin:0 }}>Empresas</h2>
          <p style={{ fontSize:10, color:'var(--text3)', margin:0 }}>Status por módulo · {rows.length} empresas</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 9px', marginLeft:12 }}>
          <span style={{ fontSize:12, color:'var(--text3)' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa..."
            style={{ background:'none', border:'none', outline:'none', fontSize:11, color:'var(--text2)', width:160 }} />
        </div>
        {carteiras.length > 1 && (
          <select value={carteira} onChange={e => setCarteira(e.target.value)}
            style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}>
            {carteiras.map(c => <option key={c} value={c}>{c==='todas'?'Todas as carteiras':c}</option>)}
          </select>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:2, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:2 }}>
          <button onClick={() => escolherVisualizacao('tabela')} title="Ver como tabela"
            style={{ display:'flex', alignItems:'center', gap:4, background:visualizacao==='tabela'?'var(--surface)':'none', boxShadow:visualizacao==='tabela'?'var(--shadow-sm)':'none',
              border:'none', borderRadius:6, padding:'5px 9px', fontSize:11, color:visualizacao==='tabela'?'var(--text1)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
            <ListIcon size={12} /> Tabela
          </button>
          <button onClick={() => escolherVisualizacao('cards')} title="Ver como cards"
            style={{ display:'flex', alignItems:'center', gap:4, background:visualizacao==='cards'?'var(--surface)':'none', boxShadow:visualizacao==='cards'?'var(--shadow-sm)':'none',
              border:'none', borderRadius:6, padding:'5px 9px', fontSize:11, color:visualizacao==='cards'?'var(--text1)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
            <LayoutGridIcon size={12} /> Cards
          </button>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={handleGerarCompetencia} disabled={gerando}
            title="Gerar obrigações recorrentes desta competência (automático, todas as empresas)"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:'pointer', fontWeight:500, opacity:gerando?.6:1 }}>
            <RefreshCwIcon size={12} /> {gerando ? 'Gerando...' : `Gerar ${compSel}`}
          </button>
          <button onClick={() => setShowLoteObs(true)}
            title="Criar uma obrigação escolhida à mão pra várias empresas"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:'pointer', fontWeight:500 }}>
            <ZapIcon size={12} /> Obrigações em lote
          </button>
          <label title="Sobe o PDF e identifica a empresa sozinho, sem precisar abrir ela antes"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:enviandoDeclaracaoAuto?'default':'pointer', fontWeight:500, opacity:enviandoDeclaracaoAuto?.6:1 }}>
            <BarChart3Icon size={12} /> {enviandoDeclaracaoAuto ? 'Processando...' : 'Declaração (detectar empresa)'}
            <input type="file" accept=".pdf,application/pdf" style={{ display:'none' }} disabled={enviandoDeclaracaoAuto}
              onChange={(e) => { handleUploadDeclaracaoAuto(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <label title="Sobe o PDF e identifica a empresa sozinho, sem precisar abrir ela antes"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:enviandoSituacaoFiscalAuto?'default':'pointer', fontWeight:500, opacity:enviandoSituacaoFiscalAuto?.6:1 }}>
            <FileTextIcon size={12} /> {enviandoSituacaoFiscalAuto ? 'Processando...' : 'Situação Fiscal (detectar empresa)'}
            <input type="file" accept=".pdf,application/pdf" style={{ display:'none' }} disabled={enviandoSituacaoFiscalAuto}
              onChange={(e) => { handleUploadSituacaoFiscalAuto(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <span style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}
            title="Competência escolhida no Painel">
            {compSel}
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:5, padding:'7px 16px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface2)', alignItems:'center' }}>
        {[['todos','Todos'],['pendentes','Pendentes'],['criticos','Críticos'],['ok','100% ok']].map(([id,lbl]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ background:filtro===id?'var(--accent-dim)':'var(--surface2)', border:`1px solid ${filtro===id?'var(--accent)':'var(--border)'}`,
              borderRadius:99, padding:'3px 9px', fontSize:10, color:filtro===id?'var(--accent)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Área principal */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>

        {/* Scroll container — sticky funciona aqui */}
        {visualizacao === 'tabela' && (
        <div style={{ flex:1, overflow:'auto', padding:'12px 16px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed',
            minWidth: nomeColW + 120 + departamentos.length*120 + 40,
            background:'var(--surface)' }}>
            <colgroup>
              <col style={{ width:nomeColW }} />
              <col style={{ width:120 }} /> {/* Resumo */}
              {departamentos.map(d => <col key={d.id} style={{ width:120 }} />)}
              <col style={{ width:38 }} />
            </colgroup>

            <thead style={{ position:'sticky', top:0, zIndex:5 }}>
              <tr style={{ background:'var(--navy)' }}>
                <th style={{ padding:'12px 14px', textAlign:'left', fontWeight:600, fontSize:12, color:'var(--navy-text)',
                  textTransform:'uppercase', letterSpacing:.6, position:'relative',
                  borderBottom:'1px solid var(--navy2)', userSelect:'none' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:6 }}>🏢 Empresa</span>
                  <div onMouseDown={handleResizeNome}
                    style={{ position:'absolute', right:0, top:0, bottom:0, width:5, cursor:'col-resize' }} />
                </th>
                <th style={{ padding:'12px 8px', textAlign:'center', fontWeight:600, fontSize:12,
                  color:'#fbbf24', textTransform:'uppercase', letterSpacing:.5,
                  borderBottom:'1px solid var(--navy2)', background:'var(--navy2)' }}>
                  <div style={{ fontSize:18, marginBottom:4 }}>📊</div>
                  <div>Resumo</div>
                  <div style={{ fontSize:10, color:'var(--navy-text-dim)', marginTop:2, fontWeight:400 }}>geral</div>
                </th>
                {departamentos.map(d => (
                  <th key={d.id} style={{ padding:'12px 8px', textAlign:'center', fontWeight:600, fontSize:12,
                    color:'var(--navy-text)', textTransform:'uppercase', letterSpacing:.5,
                    borderBottom:'1px solid var(--navy2)' }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{d.icone||'📋'}</div>
                    <div>{d.nome}</div>
                    <button onClick={() => setLoteDept(d)} title={`Tarefas em lote — ${d.nome}`}
                      style={{ marginTop:4, background:'none', border:'1px dashed var(--navy-border)', borderRadius:4,
                        padding:'1px 6px', fontSize:9, color:'var(--navy-text-dim)', cursor:'pointer', fontWeight:400 }}>
                      <ZapIcon size={9} style={{ verticalAlign:-1, marginRight:2 }} />lote
                    </button>
                  </th>
                ))}
                <th style={{ padding:'12px 4px', textAlign:'center', borderBottom:'1px solid var(--navy2)' }}>
                  <button onClick={() => setShowAddDept(true)} title="Novo módulo"
                    style={{ background:'none', border:'1px dashed var(--navy-border)', borderRadius:4, width:22, height:22,
                      color:'var(--navy-text-dim)', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                    <PlusIcon size={12} />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={departamentos.length+3} style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13 }}>
                  Nenhuma empresa encontrada
                </td></tr>
              )}
              {rows.map(({ c, deptData }, ri) => {
                const [bg, tc] = AVATAR_COLORS[ri % AVATAR_COLORS.length]
                const initials = c.nome.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
                const isSel = drawer?.c?.id === c.id
                const zebra = ri%2===0 ? 'var(--surface)' : 'var(--surface2)'

                // Resumo: soma todas obrigações do cliente nesta competência
                const obsTotal = obrigacoes.filter(o => o.cliente_id===c.id && o.competencia===compSel)
                const resOk       = obsTotal.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
                const resVenc     = obsTotal.filter(o => o.status==='vencido').length
                const resPend     = obsTotal.filter(o => o.status==='pendente').length
                const resVencendo = obsTotal.some(isVencendo)
                const resPct  = obsTotal.length > 0 ? Math.round((resOk/obsTotal.length)*100) : 0
                const resS    = resVenc > 0 ? 'danger' : resVencendo ? 'venc_breve' : resPct===100 ? 'ok' : resPend > 0 ? 'warn' : 'empty'
                const resumo  = { s: resS, pct: resPct, val: obsTotal.length > 0 ? `${resOk}/${obsTotal.length}` : '—' }

                return (
                  <tr key={c.id}
                    style={{ background: isSel?'var(--accent-dim)':zebra, borderBottom:'1px solid var(--border)', cursor:'pointer', transition:'background .12s' }}
                    onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='var(--surface2)' }}
                    onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=zebra }}>

                    {/* Empresa */}
                    <td style={{ padding:'13px 14px' }}
                      onClick={() => openDrawer(c, null)}>
                      <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:bg, color:tc, flexShrink:0,
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>
                          {initials}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--text1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.nome}</div>
                          <div style={{ fontSize:11, color:'var(--text3)', display:'flex', gap:4, alignItems:'center', marginTop:2 }}>
                            {c.regime||'SN'}
                            {c.carteira && <span style={{ background:'rgba(59,102,246,.12)', color:'var(--accent)', borderRadius:99, padding:'0 6px', fontSize:10, fontWeight:600 }}>{c.carteira}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Resumo geral */}
                    <td style={{ padding:'6px 4px', textAlign:'center' }}
                      onClick={() => openDrawer(c, null)}>
                      <DeptPill data={resumo} onClick={() => openDrawer(c, null)} />
                    </td>

                    {/* Módulos */}
                    {departamentos.map(d => (
                      <td key={d.id} style={{ padding:'6px 4px', textAlign:'center' }}>
                        <DeptPill data={deptData[d.id]} onClick={() => openDrawer(c, d)} />
                      </td>
                    ))}

                    <td style={{ textAlign:'center' }} onClick={() => openDrawer(c, null)}>
                      <ChevronRightIcon size={15} color="var(--text3)" />
                    </td>
                  </tr>
                )
              })}
            </tbody>

            <tfoot style={{ position:'sticky', bottom:0, zIndex:4 }}>
              <tr style={{ background:'var(--surface2)', borderTop:'1px solid var(--border)' }}>
                <td colSpan={departamentos.length+3} style={{ padding:'7px 14px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:11, color:'var(--text3)' }}>{rows.length} empresas</span>
                    <span style={{ fontSize:11, color:'var(--accent)' }}>{compSel}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}

        {visualizacao === 'cards' && (
          <div style={{ flex:1, overflow:'auto', padding:'16px' }}>
            {rows.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13 }}>Nenhuma empresa encontrada</div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(195px, 1fr))', gap:10 }}>
              {rowsCards.map(({ c, deptData }, ri) => {
                const [bg, tc] = AVATAR_COLORS[ri % AVATAR_COLORS.length]
                const initials = c.nome.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
                const obsTotal = obrigacoes.filter(o => o.cliente_id===c.id && o.competencia===compSel)
                const resOk   = obsTotal.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
                const resVenc = obsTotal.filter(o => o.status==='vencido').length
                const resVencendo = obsTotal.some(isVencendo)
                const resPct  = obsTotal.length > 0 ? Math.round((resOk/obsTotal.length)*100) : 0
                const resS    = resVenc > 0 ? 'danger' : resVencendo ? 'venc_breve' : resPct===100 ? 'ok' : obsTotal.filter(o=>o.status==='pendente').length > 0 ? 'warn' : 'empty'
                const completo = resS === 'ok' && obsTotal.length > 0
                const tasksCliente = tarefas.filter(t => t.cliente_id === c.id)
                const tasksPend = tasksCliente.filter(t => !t.concluida).length
                // Progresso combinado (obrigações + tarefas) só pra guiar o
                // gradiente de fundo do card — os números exibidos (% e
                // "Tudo em dia") continuam olhando só pra obrigações.
                const totalItens = obsTotal.length + tasksCliente.length
                const itensOk = resOk + (tasksCliente.length - tasksPend)
                const progressoGeral = totalItens > 0 ? Math.round((itensOk / totalItens) * 100) : 0
                const arrastando = arrastandoId === c.id
                return (
                  <div key={c.id} onClick={() => openDrawer(c, null)}
                    draggable
                    onDragStart={e => { e.stopPropagation(); setArrastandoId(c.id) }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDropCard(c.id) }}
                    onDragEnd={() => setArrastandoId(null)}
                    style={{ background:`color-mix(in srgb, var(--surface), var(--ok-dim) ${progressoGeral}%)`,
                      border:`1px solid ${completo?'var(--ok)':resS==='danger'?'var(--danger)':'var(--border)'}`, borderRadius:'var(--r-lg)',
                      padding:11, cursor:'grab', transition:'transform .1s, box-shadow .1s, opacity .1s', boxShadow:'var(--shadow-sm)',
                      opacity:arrastando?.4:1 }}
                    onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='var(--shadow-sm)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
                      <div style={{ width:28, height:28, borderRadius:7, background:bg, color:tc, flexShrink:0,
                        display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>
                        {initials}
                      </div>
                      <div style={{ minWidth:0, flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'var(--text1)', wordBreak:'break-word', lineHeight:1.25 }}>{c.nome}</div>
                        <div style={{ fontSize:10, color:'var(--text3)' }}>{c.regime||'SN'}</div>
                      </div>
                      {S_ICON[resS] && (() => { const Icon = S_ICON[resS]; return <Icon size={14} color={S_COLOR[resS]} /> })()}
                      <GripVerticalIcon size={13} color="var(--text3)" style={{ flexShrink:0, cursor:'grab' }} title="Arrastar pra reordenar" />
                    </div>

                    {completo ? (
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:5, background:'var(--ok)', color:'#fff',
                        borderRadius:99, padding:'7px 0', marginBottom:12, fontSize:12, fontWeight:700 }}>
                        <CheckCircleIcon size={14} /> Tudo em dia
                      </div>
                    ) : (
                      <div style={{ marginBottom:12 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
                          <span style={{ fontSize:19, fontWeight:800, color:S_COLOR[resS] }}>{resPct}%</span>
                          <span style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:.3 }}>obrigações</span>
                        </div>
                        <div style={{ height:10, background:'var(--surface2)', borderRadius:99, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${resPct}%`, background:S_COLOR[resS], borderRadius:99, transition:'width .3s' }} />
                        </div>
                      </div>
                    )}

                    <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
                      {departamentos.map(d => (
                        <span key={d.id} title={`${d.nome}: ${deptData[d.id]?.val || '—'}`}
                          style={{ width:22, height:22, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:11, background:completo?'rgba(255,255,255,.5)':S_BG[deptData[d.id]?.s || 'empty'], flexShrink:0 }}>
                          {d.icone || '📋'}
                        </span>
                      ))}
                    </div>

                    <button onClick={(e) => { e.stopPropagation(); onOpenTarefas?.(c.id) }}
                      title="Abrir tarefas dessa empresa no módulo de Tarefas"
                      style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:6,
                        background:completo?'rgba(255,255,255,.5)':'var(--surface2)', border:'1px solid var(--border)', borderRadius:8,
                        padding:'6px 10px', cursor:'pointer' }}>
                      <span style={{ fontSize:11, color:'var(--text2)', display:'flex', alignItems:'center', gap:5, fontWeight:500 }}>
                        <CheckSquareIcon size={12} /> Tarefas
                      </span>
                      <span style={{ fontSize:11, fontWeight:700, color: tasksCliente.length===0 ? 'var(--text3)' : tasksPend>0 ? 'var(--warn)' : 'var(--ok)' }}>
                        {tasksCliente.length===0 ? '—' : `${tasksCliente.length-tasksPend}/${tasksCliente.length}`}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Modal da empresa (era um drawer lateral — agora abre centralizado) */}
        {drawer && (
          <>
            <div style={{ position:'fixed', inset:0, background:'var(--overlay)', zIndex:9 }} onClick={() => setDrawer(null)} />
            <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:640, maxWidth:'calc(100vw - 32px)',
              maxHeight:'85vh', zIndex:10, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)',
              display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'var(--shadow-lg)', animation:'popIn .18s ease' }}>
              <style>{`@keyframes popIn{from{opacity:0; transform:translate(-50%,-50%) scale(.96)}to{opacity:1; transform:translate(-50%,-50%) scale(1)}}`}</style>

              {/* Header drawer — navy */}
              <div style={{ padding:'12px 14px', borderBottom:'1px solid var(--navy2)', flexShrink:0,
                display:'flex', alignItems:'flex-start', gap:8, background:'var(--navy)' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {drawer.c.nome}
                  </div>
                  <div style={{ fontSize:10, color:'var(--navy-text)', marginTop:2 }}>{drawer.dept?.nome||'Todos os módulos'} · {compSel}</div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:6 }}>
                    {drawer.c.cnpj && (
                      <span style={{ fontSize:10, color:'var(--navy-text)', background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)', borderRadius:99, padding:'2px 8px' }}>
                        {drawer.c.cnpj}
                      </span>
                    )}
                    <span style={{ fontSize:10, color:'var(--navy-text)', background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)', borderRadius:99, padding:'2px 8px' }}>
                      {drawer.c.regime || 'SN'}
                    </span>
                    {drawer.c.carteira && (
                      <span style={{ fontSize:10, color:'var(--navy-text)', background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.15)', borderRadius:99, padding:'2px 8px' }}>
                        {drawer.c.carteira}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => handleDeleteCliente(drawer.c)} title="Excluir empresa"
                  style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', borderRadius:6, width:24, height:24,
                    display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#f87171', flexShrink:0 }}>
                  <Trash2Icon size={13} />
                </button>
                <button onClick={() => setDrawer(null)}
                  style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', borderRadius:6, width:24, height:24,
                    display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--navy-text)', flexShrink:0 }}>
                  <XIcon size={13} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
                {[['obrig',`📋 Obrigações (${drawerObs.length})`],['tarefas',`✓ Tarefas (${drawerTasks.length})`],['anexos',`📎 Anexos`]].map(([id,lbl]) => (
                  <button key={id} onClick={() => setDrawerTab(id)}
                    style={{ flex:1, padding:'8px', fontSize:11, fontWeight:500, border:'none', background:'none', cursor:'pointer',
                      borderBottom:`2px solid ${drawerTab===id?'var(--accent)':'transparent'}`,
                      color:drawerTab===id?'var(--accent)':'var(--text3)' }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:7, background:'var(--bg)' }}>

                {/* ── Obrigações ── */}
                {drawerTab === 'obrig' && <>
                  {drawerObs.length === 0 && (
                    <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'24px 0' }}>Sem obrigações registradas</div>
                  )}
                  {drawerObs.map(o => {
                    const cfg = STATUS_OBS_COLOR[o.status] || STATUS_OBS_COLOR.pendente
                    const busy = updatingId === o.id
                    const vencendo = isVencendo(o)
                    const lembrete = lembreteDoItem(o.id, null)
                    return (
                      <div key={o.id} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                        borderLeft: vencendo ? `3px solid ${COR_VENCENDO}` : '1px solid var(--border)', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom: o.vencimento ? 6 : 0 }}>
                          <span style={{ fontSize:12, fontWeight:500, color:'var(--text1)' }}>{o.titulo || o.tipo}</span>
                          <button onClick={() => setLembreteAlvo({ obrigacaoId: o.id, titulo: o.titulo || o.tipo, lembrete })}
                            title={lembrete ? `Lembrete pra ${new Date(lembrete.data_hora).toLocaleString('pt-BR')}` : 'Marcar lembrete'}
                            style={{ background:'none', border:'none', cursor:'pointer', padding:2, flexShrink:0,
                              color: lembrete ? 'var(--accent)' : 'var(--text3)' }}>
                            {lembrete ? <BellRingIcon size={13} /> : <BellIcon size={13} />}
                          </button>
                          <select
                            value={o.status || 'pendente'}
                            disabled={busy}
                            onChange={e => handleStatusObs(o.id, e.target.value)}
                            style={{ background:cfg.bg, border:`1px solid ${cfg.color}55`, borderRadius:99,
                              padding:'3px 8px', fontSize:9, color:cfg.color, fontWeight:600,
                              cursor:'pointer', outline:'none', opacity:busy?.6:1,
                              appearance:'none', WebkitAppearance:'none' }}>
                            {STATUS_OBS.map(s => (
                              <option key={s} value={s} style={{ background:'var(--surface)', color:'var(--text1)' }}>
                                {STATUS_OBS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {o.vencimento && (
                          <div style={{ fontSize:10, color:o.status==='vencido'?'var(--danger)':vencendo?COR_VENCENDO:'var(--text3)', display:'flex', alignItems:'center', gap:4, fontWeight:vencendo?600:400 }}>
                            <CalendarIcon size={9} />
                            {o.status==='vencido'?'⚠ ':vencendo?'⏰ vence em breve · ':''}Venc. {new Date(o.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>}

                {/* ── Tarefas ── */}
                {drawerTab === 'tarefas' && <>
                  {drawerTasks.length === 0 && (
                    <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'24px 0' }}>Sem tarefas</div>
                  )}
                  {drawerTasks.map(t => {
                    const overdue = isOverdue(t.vencimento) && !t.concluida
                    const altaPrioridade = t.prioridade === 'alta' && !t.concluida
                    const corStatus = overdue ? 'var(--danger)' : altaPrioridade ? 'var(--warn)' : 'transparent'
                    const busy = updatingId === t.id
                    const lembrete = lembreteDoItem(null, t.id)
                    return (
                      <div key={t.id} style={{ background:'var(--surface2)', border:'1px solid var(--border)',
                        borderLeft:`3px solid ${corStatus}`, borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                          <button onClick={() => handleToggleTask(t)} disabled={busy}
                            style={{ width:16, height:16, borderRadius:4, flexShrink:0, marginTop:1, cursor:'pointer',
                              border:`1px solid ${t.concluida?'#34d399':'#3b4570'}`,
                              background:t.concluida?'#34d399':'transparent',
                              display:'flex', alignItems:'center', justifyContent:'center', opacity:busy?.5:1 }}>
                            {t.concluida && <CheckIcon size={10} color="#12151f" strokeWidth={3} />}
                          </button>
                          <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={() => setTarefaEditando(t)} title="Editar tarefa">
                            <div style={{ fontSize:11, fontWeight:500, lineHeight:1.4,
                              color:t.concluida?'var(--text3)':'var(--text1)',
                              textDecoration:t.concluida?'line-through':'none' }}>
                              <PriDot pri={t.prioridade} /> {t.titulo}
                            </div>
                            <div style={{ display:'flex', gap:5, alignItems:'center', marginTop:3, flexWrap:'wrap' }}>
                              <DeptChip dept={t.departamento} />
                              {t.vencimento && (
                                <span style={{ fontSize:10, color:overdue?'#f87171':'var(--text3)', display:'flex', alignItems:'center', gap:2 }}>
                                  <CalendarIcon size={9} />{overdue?'⚠ ':''}{fmtDate(t.vencimento)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button onClick={() => setLembreteAlvo({ tarefaId: t.id, titulo: t.titulo, lembrete })}
                            title={lembrete ? `Lembrete pra ${new Date(lembrete.data_hora).toLocaleString('pt-BR')}` : 'Marcar lembrete'}
                            style={{ background:'none', border:'none', cursor:'pointer', padding:2, flexShrink:0,
                              color: lembrete ? 'var(--accent)' : 'var(--text3)' }}>
                            {lembrete ? <BellRingIcon size={12} /> : <BellIcon size={12} />}
                          </button>
                          <button onClick={() => setTarefaEditando(t)} title="Editar"
                            style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', padding:2, flexShrink:0 }}>
                            <PencilIcon size={12} />
                          </button>
                          <button onClick={() => handleDeleteTask(t)} title="Excluir tarefa"
                            style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', padding:2, flexShrink:0 }}>
                            <Trash2Icon size={12} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </>}

                {/* ── Anexos ── */}
                {drawerTab === 'anexos' && <AbaAnexosEmpresa clienteId={drawer.c.id} />}
              </div>

              {/* Footer drawer */}
              <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', flexShrink:0, display:'flex', flexDirection:'column', gap:7, background:'var(--surface)' }}>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={() => { setShowNovaObs(true) }}
                    style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                    🧾 + Obrigação
                  </button>
                  <button onClick={() => { setShowNovaTarefa(true) }}
                    style={{ flex:1, background:'var(--navy)', border:'none', borderRadius:8, padding:'7px', fontSize:11, color:'#fff', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                    ✓ + Tarefa
                  </button>
                </div>
                <div style={{ display:'flex', gap:7 }}>
                  <label style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:enviandoDeclaracao?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4, opacity:enviandoDeclaracao?.6:1 }}>
                    <BarChart3Icon size={12} /> {enviandoDeclaracao ? 'Processando...' : 'Declaração do Simples'}
                    <input type="file" accept=".pdf,application/pdf" style={{ display:'none' }} disabled={enviandoDeclaracao}
                      onChange={(e) => { handleUploadDeclaracao(drawer.c, e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                  <label style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:enviandoSituacaoFiscal?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4, opacity:enviandoSituacaoFiscal?.6:1 }}>
                    <FileTextIcon size={12} /> {enviandoSituacaoFiscal ? 'Processando...' : 'Situação Fiscal RFB'}
                    <input type="file" accept=".pdf,application/pdf" style={{ display:'none' }} disabled={enviandoSituacaoFiscal}
                      onChange={(e) => { handleUploadSituacaoFiscal(drawer.c, e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                </div>
                <button onClick={() => setShowCndManual(true)}
                  style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                  🛡️ CND Estadual/Municipal
                </button>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={() => handleVisualizarPainel(drawer.c)}
                    title="Ver o painel do cliente aqui dentro, com setas pra ir passando pelas outras empresas"
                    style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                    <EyeIcon size={12} /> Visualizar painel
                  </button>
                  <button onClick={() => handleCompartilharPainel(drawer.c)}
                    style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'7px', fontSize:11, color:'#fff', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                    <Share2Icon size={12} /> Compartilhar
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal novo módulo (departamento) */}
      {showAddDept && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowAddDept(false)}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:20, width:300 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:13, fontWeight:500, color:'var(--text1)', marginBottom:12 }}>🏢 Novo módulo</div>
            <input value={novoDept} onChange={e => setNovoDept(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleAddDept()} autoFocus
              placeholder="Ex: Trabalhista, Pessoal..."
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', marginBottom:12, outline:'none' }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setShowAddDept(false)}
                style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
              <button onClick={handleAddDept}
                style={{ flex:1, background:'var(--navy)', border:'none', borderRadius:8, padding:'8px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer' }}>Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nova obrigação (modelo novo: departamentos/tipos_obrigacao) */}
      {showNovaObs && drawer && (
        <NovaObrigacaoModal
          cliente={drawer.c}
          dept={drawer.dept}
          departamentos={departamentos}
          competencia={compSel}
          onClose={() => setShowNovaObs(false)}
          onSaved={async () => { setShowNovaObs(false); await fetchObrigacoes() }}
        />
      )}

      {/* Modal nova tarefa */}
      {showNovaTarefa && drawer && (
        <NovaTarefaModuloModal
          cliente={drawer.c}
          dept={drawer.dept}
          onClose={() => setShowNovaTarefa(false)}
          onSaved={async () => { setShowNovaTarefa(false); await fetchTarefas() }}
        />
      )}

      {/* Modal editar tarefa */}
      {tarefaEditando && drawer && (
        <NovaTarefaModuloModal
          cliente={drawer.c}
          tarefa={tarefaEditando}
          onClose={() => setTarefaEditando(null)}
          onSaved={async () => { setTarefaEditando(null); await fetchTarefas() }}
        />
      )}

      {/* Modal marcar lembrete */}
      {lembreteAlvo && (
        <ModalLembrete
          alvo={lembreteAlvo}
          onClose={() => setLembreteAlvo(null)}
          onSaved={async () => { setLembreteAlvo(null); await recarregarLembretes() }}
        />
      )}

      {/* Modal CND estadual/municipal */}
      {showCndManual && drawer && (
        <ModalCndManual
          cliente={drawer.c}
          competencia={compSel}
          onClose={() => setShowCndManual(false)}
          onSaved={() => { setShowCndManual(false); show?.('CND estadual/municipal atualizada') }}
        />
      )}

      {/* Carrossel interno de painéis — "Visualizar painel" */}
      {painelViewer && (
        <PainelViewerModal
          clientes={painelViewer.clientes}
          indiceInicial={painelViewer.indiceInicial}
          competencia={compSel}
          onClose={() => setPainelViewer(null)}
        />
      )}

      {/* Modal tarefas em lote por módulo */}
      {loteDept && (
        <ModalTarefasLote
          dept={loteDept}
          clientes={clientes}
          onClose={() => setLoteDept(null)}
          onSaved={async () => { setLoteDept(null); await fetchTarefas(); show?.('Tarefas criadas') }}
        />
      )}

      {/* Modal obrigações em lote (escolha manual de empresas + tipo) */}
      {showLoteObs && (
        <ModalObrigacoesLote
          departamentos={departamentos}
          clientes={clientes}
          competenciaInicial={compSel}
          onClose={() => setShowLoteObs(false)}
          onSaved={async (resultado) => {
            setShowLoteObs(false)
            await fetchObrigacoes()
            show?.(`${resultado.criadas} criada${resultado.criadas!==1?'s':''}${resultado.reativadas ? `, ${resultado.reativadas} reativada${resultado.reativadas!==1?'s':''} (estava${resultado.reativadas!==1?'m':''} "não aplica")` : ''}${resultado.jaExistiam ? `, ${resultado.jaExistiam} já existia${resultado.jaExistiam!==1?'m':''}` : ''}`)
          }}
        />
      )}
    </div>
  )
}

// ── Aba Anexos (modal de empresa) ────────────────────────────────────────────
// Documentos da tabela "documentos" (upload manual + IA, ver documentosApi.js)
// filtrados pra esse cliente — reaproveita o mesmo bucket/URL assinada
// usados na aba "Concluídos" de DocumentosPage.jsx.
function AbaAnexosEmpresa({ clienteId }) {
  const [docs, setDocs] = useState(null) // null = carregando
  const [erro, setErro] = useState(null)
  const { show } = useToast()

  useEffect(() => {
    setDocs(null)
    listarDocumentosPorCliente(clienteId).then(setDocs).catch(e => setErro(e.message))
  }, [clienteId])

  const baixar = async (doc) => {
    try {
      const url = await criarLinkAssinado(doc.storage_path)
      window.open(url, '_blank')
    } catch (e) {
      show?.('Erro ao gerar link: ' + e.message)
    }
  }

  if (erro) return <p style={{ color:'var(--danger)', fontSize:12 }}>{erro}</p>
  if (!docs) return <p style={{ color:'var(--text3)', fontSize:12 }}>Carregando...</p>
  if (docs.length === 0) return (
    <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'24px 0' }}>Nenhum anexo pra essa empresa</div>
  )

  return <>
    {docs.map(doc => (
      <div key={doc.id} style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8,
        padding:'10px 12px', display:'flex', alignItems:'center', gap:10 }}>
        <FileIcon size={14} color="var(--text3)" style={{ flexShrink:0 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:500, color:'var(--text1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {doc.tipo_documento_sugerido || doc.nome_arquivo}
          </div>
          <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>
            {new Date(doc.created_at).toLocaleDateString('pt-BR')}
          </div>
        </div>
        <button onClick={() => baixar(doc)} title="Baixar"
          style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', padding:2, flexShrink:0 }}>
          <DownloadIcon size={13} />
        </button>
      </div>
    ))}
  </>
}

// ── Modal marcar lembrete ────────────────────────────────────────────────────
// Data/hora própria (independente do vencimento) numa obrigação ou tarefa —
// disparado por WhatsApp pra o grupo do escritório (lembretes-cron.js).
function ModalLembrete({ alvo, onClose, onSaved }) {
  const [dataHora, setDataHora] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const handleSalvar = async () => {
    if (!dataHora) return
    setSaving(true)
    try {
      await criarLembrete({
        obrigacaoId: alvo.obrigacaoId || null,
        tarefaId: alvo.tarefaId || null,
        dataHora: new Date(dataHora).toISOString(),
        mensagem: mensagem.trim(),
      })
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar lembrete: ' + e.message)
    }
    setSaving(false)
  }

  const handleExcluir = async () => {
    setSaving(true)
    try {
      await excluirLembrete(alvo.lembrete.id)
      onSaved()
    } catch (e) {
      show?.('Erro ao excluir lembrete: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`🔔 Lembrete — ${alvo.titulo}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {alvo.lembrete && (
          <div style={{ fontSize:12, color:'var(--text2)', background:'var(--surface2)', borderRadius:8, padding:'8px 10px' }}>
            Já tem um lembrete marcado pra {new Date(alvo.lembrete.data_hora).toLocaleString('pt-BR')}.
          </div>
        )}
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Data e hora *</label>
          <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)} autoFocus
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Nota (opcional)</label>
          <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
            placeholder="Vai junto na mensagem do WhatsApp..."
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        </div>
        <p style={{ fontSize:11, color:'var(--text3)' }}>Manda um WhatsApp pro grupo do escritório na hora marcada.</p>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        {alvo.lembrete && (
          <button onClick={handleExcluir} disabled={saving}
            style={{ background:'var(--danger-dim)', border:'1px solid var(--danger)', borderRadius:8, padding:'9px 14px', fontSize:12, color:'var(--danger)', cursor:'pointer', opacity:saving?.6:1 }}>
            <Trash2Icon size={13} style={{ verticalAlign:-2 }} />
          </button>
        )}
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSalvar} disabled={saving||!dataHora}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!dataHora)?.6:1 }}>
          {saving?'Salvando...':'Marcar lembrete'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal CND Estadual/Municipal ─────────────────────────────────────────────
// Marcação manual (sem upload/IA — layout de certidão varia demais entre
// estados/prefeituras) que complementa a Situação Fiscal federal (RFB) já
// automatizada. Alimenta a aba CND do painel compartilhável do cliente.
function ModalCndManual({ cliente, competencia, onClose, onSaved }) {
  const [situacaoEstadual, setSituacaoEstadual] = useState('')
  const [situacaoMunicipal, setSituacaoMunicipal] = useState('')
  const [observacao, setObservacao] = useState('')
  const [anexoEstadualAtual, setAnexoEstadualAtual] = useState(null) // {path, nome} já salvo
  const [anexoMunicipalAtual, setAnexoMunicipalAtual] = useState(null)
  const [novoAnexoEstadual, setNovoAnexoEstadual] = useState(null) // File escolhido agora
  const [novoAnexoMunicipal, setNovoAnexoMunicipal] = useState(null)
  const [carregando, setCarregando] = useState(true)
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  useEffect(() => {
    obterCndManual(cliente.id, competencia)
      .then((atual) => {
        if (atual) {
          setSituacaoEstadual(atual.situacao_estadual || '')
          setSituacaoMunicipal(atual.situacao_municipal || '')
          setObservacao(atual.observacao || '')
          setAnexoEstadualAtual(atual.anexo_estadual_path ? { path: atual.anexo_estadual_path, nome: atual.anexo_estadual_nome } : null)
          setAnexoMunicipalAtual(atual.anexo_municipal_path ? { path: atual.anexo_municipal_path, nome: atual.anexo_municipal_nome } : null)
        }
      })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [cliente.id, competencia])

  const handleSalvar = async () => {
    setSaving(true)
    try {
      await salvarCndManual(cliente.id, competencia, {
        situacaoEstadual, situacaoMunicipal, observacao: observacao.trim(),
        anexoEstadual: novoAnexoEstadual, anexoMunicipal: novoAnexoMunicipal,
      })
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSaving(false)
  }

  const baixarAnexo = async (path) => {
    try {
      const url = await criarLinkAssinado(path)
      window.open(url, '_blank')
    } catch (e) {
      show?.('Erro ao gerar link: ' + e.message)
    }
  }

  const SeletorSituacao = ({ label, valor, onChange }) => (
    <div>
      <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>{label}</label>
      <select value={valor} onChange={e => onChange(e.target.value)}
        style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
        <option value="">Não informado</option>
        <option value="regular">Regular</option>
        <option value="pendente">Pendente</option>
      </select>
    </div>
  )

  const AnexoCertidao = ({ label, anexoAtual, novoAnexo, onEscolher }) => (
    <div>
      <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Certidão {label} (PDF, opcional)</label>
      {anexoAtual && !novoAnexo && (
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
          <FileTextIcon size={12} color="var(--text3)" />
          <span style={{ fontSize:11, color:'var(--text2)', flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{anexoAtual.nome}</span>
          <button type="button" onClick={() => baixarAnexo(anexoAtual.path)}
            style={{ background:'none', border:'none', color:'var(--accent)', cursor:'pointer', padding:2, display:'flex' }} title="Baixar">
            <DownloadIcon size={13} />
          </button>
        </div>
      )}
      {novoAnexo && (
        <div style={{ fontSize:11, color:'var(--ok)', marginBottom:5 }}>Novo arquivo selecionado: {novoAnexo.name}</div>
      )}
      <input type="file" accept=".pdf,application/pdf" onChange={(e) => onEscolher(e.target.files?.[0] || null)}
        style={{ width:'100%', fontSize:11 }} />
    </div>
  )

  return (
    <ModalBase onClose={onClose} titulo={`🛡️ CND Estadual/Municipal — ${cliente.nome.split(' ')[0]}`}>
      {carregando ? (
        <p style={{ fontSize:12, color:'var(--text3)' }}>Carregando...</p>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <p style={{ fontSize:11, color:'var(--text3)' }}>Competência {competencia} — marcação manual (sem leitura automática, formato varia demais por estado/prefeitura); o PDF da certidão pode ser anexado como prova.</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <SeletorSituacao label="Estadual" valor={situacaoEstadual} onChange={setSituacaoEstadual} />
            <SeletorSituacao label="Municipal" valor={situacaoMunicipal} onChange={setSituacaoMunicipal} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <AnexoCertidao label="estadual" anexoAtual={anexoEstadualAtual} novoAnexo={novoAnexoEstadual} onEscolher={setNovoAnexoEstadual} />
            <AnexoCertidao label="municipal" anexoAtual={anexoMunicipalAtual} novoAnexo={novoAnexoMunicipal} onEscolher={setNovoAnexoMunicipal} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Observação (opcional)</label>
            <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2}
              placeholder="Ex: certidão estadual vence dia 15..."
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
          </div>
        </div>
      )}
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSalvar} disabled={saving||carregando}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||carregando)?.6:1 }}>
          {saving?'Salvando...':'Salvar'}
        </button>
      </div>
    </ModalBase>
  )
}

