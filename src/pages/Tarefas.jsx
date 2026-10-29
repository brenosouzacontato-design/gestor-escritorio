import { useState, useMemo, useRef, useEffect } from 'react'
import { Trash2Icon, CheckIcon, XIcon, SaveIcon, MessageSquareIcon, PlusIcon, GripVerticalIcon, SendIcon, TruckIcon,
  BellIcon, BellRingIcon, CalendarIcon, Building2Icon, ArchiveIcon, CircleDashedIcon, Loader2Icon, HourglassIcon, CheckCircle2Icon,
  AlertTriangleIcon, ArrowLeftIcon, SearchIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate } from '../components/shared'
import { supabase } from '../lib/supabase'
import { uploadArquivo, criarLinkAssinado, anexarDocumentoAoItem, abrirLinkAssinado } from './documentos/documentosApi'
import { BotaoAnexos, AnexosItemModal } from '../components/AnexosItem'
import ModalLembrete from '../components/ModalLembrete'
import { estaArquivada, diasDesdeConclusao, situacaoPrazo, dataConclusao, DIAS_PARA_ARQUIVAR } from '../lib/tarefasPrazo'

const DEPTS = [
  { id: 'todos', label: 'Todos' },
  { id: 'fiscal', label: 'Fiscal' },
  { id: 'folha', label: 'Folha' },
  { id: 'societario', label: 'Societário' },
  { id: 'contabil', label: 'Contábil' },
  { id: 'geral', label: 'Geral' },
]

const COLUNAS = [
  { id: 'pendente',    label: 'A Fazer',       color: 'var(--text3)',  bg: 'var(--surface2)', Icon: CircleDashedIcon },
  { id: 'andamento',   label: 'Em Andamento',  color: 'var(--info)',   bg: 'var(--info-dim)', Icon: Loader2Icon },
  { id: 'aguardando',  label: 'Aguardando',    color: 'var(--warn)',   bg: 'var(--warn-dim)', Icon: HourglassIcon },
  { id: 'concluido',   label: 'Concluído',     color: 'var(--ok)',     bg: 'var(--ok-dim)',   Icon: CheckCircle2Icon },
]

// Cor do selo de prazo no card
const COR_PRAZO = {
  atrasada: { cor: 'var(--danger)', bg: 'var(--danger-dim)' },
  hoje:     { cor: 'var(--warn)',   bg: 'var(--warn-dim)' },
  breve:    { cor: 'var(--warn)',   bg: 'var(--warn-dim)' },
  futuro:   { cor: 'var(--text2)',  bg: 'var(--surface2)' },
}

function iniciais(nome = '') {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

// kanban_status: pendente | andamento | aguardando | concluido
// Se não tiver kanban_status, deriva do campo concluida

function getKanbanStatus(t) {
  if (t.kanban_status) return t.kanban_status
  return t.concluida ? 'concluido' : 'pendente'
}

export default function Tarefas({ onAddTarefa, highlightTaskId, onHighlightConsumed, clienteFilterInicial, onClienteFilterConsumido }) {
  const tarefas      = useStore(s => s.tarefas)
  const clientes     = useStore(s => s.clientes)
  const toggleTarefa = useStore(s => s.toggleTarefa)
  const deleteTarefa = useStore(s => s.deleteTarefa)
  const fetchTarefas = useStore(s => s.fetchTarefas)

  const [deptFilter,    setDeptFilter]    = useState('todos')
  const [clienteFilter, setClienteFilter] = useState(clienteFilterInicial || 'todos')
  const [tarefaAberta,  setTarefaAberta]  = useState(null)
  const [dragging,      setDragging]      = useState(null) // { id, fromCol }
  const [dragOver,      setDragOver]      = useState(null) // colId
  // Documentos anexados às tarefas (📎 do card) — mesmo modal de anexos do
  // card da empresa em Empresas.jsx. Inclui os que deram baixa na tarefa
  // pela tela Documentos (inclusive os que chegam pelos grupos do WhatsApp).
  const [anexos,        setAnexos]        = useState([])
  const [anexoAlvo,     setAnexoAlvo]     = useState(null) // tarefa com o modal de anexos aberto
  const carregarAnexos = () => supabase.from('documentos')
    .select('id, tarefa_id, nome_arquivo, storage_path, tamanho_bytes, created_at')
    .not('tarefa_id', 'is', null).eq('status', 'confirmado')
    .order('created_at', { ascending: false })
    .then(({ data }) => setAnexos(data || []))
  useEffect(() => { carregarAnexos() }, [])

  // Lembretes pendentes das tarefas (sino no card). Os lembretes de tarefa
  // ficam todos aqui; no Fechamento a aba de tarefas é só para consulta.
  const [lembretes,     setLembretes]     = useState([])
  const [lembreteAlvo,  setLembreteAlvo]  = useState(null) // { tarefaId, titulo, lembrete }
  const carregarLembretes = () => supabase.from('lembretes').select('*')
    .eq('enviado', false).not('tarefa_id', 'is', null)
    .then(({ data }) => setLembretes(data || []))
  useEffect(() => { carregarLembretes() }, [])
  const lembreteDaTarefa = (id) => lembretes.find(l => l.tarefa_id === id)

  // Concluídas há 7 dias ou mais saem do quadro (ficam em "Arquivadas")
  const [verArquivadas, setVerArquivadas] = useState(false)
  const [buscaArquivo,  setBuscaArquivo]  = useState('')
  const anexosDaTarefa = (id) => anexos.filter(a => a.tarefa_id === id)
  const enviarAnexo = async (arquivo, { darBaixa }) => {
    await anexarDocumentoAoItem({ clienteId: anexoAlvo.cliente_id || null, alvo: { tipo: 'tarefa', id: anexoAlvo.id }, arquivo, darBaixa })
    await Promise.all([carregarAnexos(), darBaixa ? fetchTarefas() : null])
  }

  // Veio do card de uma empresa (Empresas.jsx, clique em "Tarefas") —
  // pré-seleciona o filtro de empresa direto no Kanban.
  useEffect(() => {
    if (!clienteFilterInicial) return
    setClienteFilter(clienteFilterInicial)
    onClienteFilterConsumido?.()
  }, [clienteFilterInicial])

  // Veio de "Abrir tarefa" a partir de um link/notificação — abre direto o
  // detalhe da tarefa em questão.
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

  const arquivadas = useMemo(() => {
    const q = buscaArquivo.trim().toLowerCase()
    return filtered.filter(t => estaArquivada(t))
      .filter(t => !q || `${t.titulo} ${t.clientes?.nome || ''}`.toLowerCase().includes(q))
      .sort((a, b) => String(dataConclusao(b)).localeCompare(String(dataConclusao(a))))
  }, [filtered, buscaArquivo])
  const qtdArquivadas = useMemo(() => filtered.filter(t => estaArquivada(t)).length, [filtered])

  // Números do topo (só tarefas abertas)
  const resumo = useMemo(() => {
    const abertas = filtered.filter(t => getKanbanStatus(t) !== 'concluido')
    const tipos = abertas.map(t => situacaoPrazo(t.vencimento).tipo)
    return {
      abertas: abertas.length,
      atrasadas: tipos.filter(x => x === 'atrasada').length,
      hoje: tipos.filter(x => x === 'hoje').length,
      comLembrete: abertas.filter(t => lembreteDaTarefa(t.id)).length,
    }
  }, [filtered, lembretes])

  const porColuna = useMemo(() => {
    const map = {}
    COLUNAS.forEach(c => { map[c.id] = [] })
    filtered.filter(t => !estaArquivada(t)).forEach(t => {
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

  // "Entregue" é independente do status do quadro — o trabalho pode estar
  // concluído mas ainda não ter sido entregue/comunicado ao cliente.
  const handleToggleEntrega = async (tarefa) => {
    await supabase.from('tarefas').update({ entregue: !tarefa.entregue }).eq('id', tarefa.id)
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
        <button className="btn btn-sm btn-accent" onClick={() => onAddTarefa()} style={{ flexShrink:0 }}>
          <PlusIcon size={12} /> Nova
        </button>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        <select value={clienteFilter} onChange={e => setClienteFilter(e.target.value)} style={{ flex:'1 1 220px', maxWidth:360 }}>
          <option value="todos">— Todos os clientes —</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <div className="tarefas-resumo">
          <span className="tarefas-resumo-item"><b>{resumo.abertas}</b> abertas</span>
          {resumo.atrasadas > 0 && <span className="tarefas-resumo-item perigo"><AlertTriangleIcon size={12} /> <b>{resumo.atrasadas}</b> atrasada{resumo.atrasadas !== 1 ? 's' : ''}</span>}
          {resumo.hoje > 0 && <span className="tarefas-resumo-item alerta"><CalendarIcon size={12} /> <b>{resumo.hoje}</b> vence{resumo.hoje !== 1 ? 'm' : ''} hoje</span>}
          {resumo.comLembrete > 0 && <span className="tarefas-resumo-item"><BellRingIcon size={12} /> <b>{resumo.comLembrete}</b> com lembrete</span>}
        </div>
        <button className={`btn btn-sm ${verArquivadas ? 'btn-accent' : ''}`} onClick={() => setVerArquivadas(v => !v)}
          title={`Tarefas concluídas há ${DIAS_PARA_ARQUIVAR} dias ou mais saem do quadro e ficam aqui`} style={{ marginLeft:'auto' }}>
          {verArquivadas ? <><ArrowLeftIcon size={12} /> Voltar ao quadro</> : <><ArchiveIcon size={12} /> Arquivadas ({qtdArquivadas})</>}
        </button>
      </div>

      {verArquivadas && (
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:12, color:'var(--text3)', flex:1 }}>
              Concluídas há {DIAS_PARA_ARQUIVAR} dias ou mais. Para reabrir, use ⇄ no card e mova para outra coluna.
            </span>
            <div style={{ position:'relative' }}>
              <SearchIcon size={13} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text3)' }} />
              <input value={buscaArquivo} onChange={e => setBuscaArquivo(e.target.value)} placeholder="Buscar nas arquivadas"
                style={{ paddingLeft:28, width:240 }} />
            </div>
          </div>
          {arquivadas.length === 0 && (
            <div style={{ textAlign:'center', color:'var(--text3)', fontSize:13, padding:'40px 0' }}>Nenhuma tarefa arquivada{buscaArquivo ? ' com essa busca' : ''}.</div>
          )}
          <div className="tarefas-arquivo-grade">
            {arquivadas.map(t => (
              <KanbanCard key={t.id} tarefa={t} colunas={COLUNAS} colAtual="concluido" arquivada
                onOpen={() => setTarefaAberta(t)}
                onDelete={() => deleteTarefa(t.id)}
                onMove={novaCol => handleMoveCard(t.id, novaCol)}
                onToggleEntrega={() => handleToggleEntrega(t)}
                qtdAnexos={anexosDaTarefa(t.id).length}
                onAnexos={() => setAnexoAlvo(t)} />
            ))}
          </div>
        </div>
      )}

      {/* Board Kanban — cada coluna rola sozinha e o cabeçalho dela fica fixo */}
      {!verArquivadas && <div className="tarefas-quadro">
        {COLUNAS.map(col => {
          const cards = porColuna[col.id] || []
          const isDragTarget = dragOver === col.id
          return (
            <div key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, col.id)}
              className="tarefas-coluna"
              style={{
                background: isDragTarget ? col.bg : 'var(--surface2)',
                border: `2px solid ${isDragTarget ? col.color : 'var(--border)'}`,
              }}>

              {/* Cabeçalho coluna (fica fixo enquanto a coluna rola) */}
              <div className="tarefas-coluna-cabecalho" style={{ borderBottom:`2px solid ${col.color}` }}>
                <span style={{ fontSize:11, fontWeight:800, color: col.color, textTransform:'uppercase', letterSpacing:'.8px', display:'flex', alignItems:'center', gap:6 }}>
                  <col.Icon size={13} /> {col.label}
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
                  onToggleEntrega={() => handleToggleEntrega(t)}
                  onDragStart={e => handleDragStart(e, t)}
                  isDragging={dragging?.id === t.id}
                  qtdAnexos={anexosDaTarefa(t.id).length}
                  onAnexos={() => setAnexoAlvo(t)}
                  lembrete={lembreteDaTarefa(t.id)}
                  onLembrete={() => setLembreteAlvo({ tarefaId: t.id, titulo: t.titulo, lembrete: lembreteDaTarefa(t.id) })}
                />
              ))}
              {col.id === 'concluido' && cards.length > 0 && (
                <div style={{ fontSize:10.5, color:'var(--text3)', textAlign:'center', padding:'4px 0' }}>
                  <ArchiveIcon size={10} style={{ verticalAlign:-1 }} /> Arquivadas automaticamente {DIAS_PARA_ARQUIVAR} dias após concluir
                </div>
              )}
            </div>
          )
        })}
      </div>}

      {lembreteAlvo && (
        <ModalLembrete
          alvo={lembreteAlvo}
          onClose={() => setLembreteAlvo(null)}
          onSaved={async () => { setLembreteAlvo(null); await carregarLembretes() }}
        />
      )}

      {anexoAlvo && (
        <AnexosItemModal
          titulo={anexoAlvo.titulo}
          subtitulo={`Tarefa${anexoAlvo.clientes?.nome ? ` · ${anexoAlvo.clientes.nome}` : ''}`}
          anexos={anexosDaTarefa(anexoAlvo.id)}
          concluido={!!anexoAlvo.concluida}
          onEnviar={enviarAnexo}
          onAbrir={(doc) => abrirLinkAssinado(doc.storage_path).catch(e => alert('Erro: ' + e.message))}
          onClose={() => setAnexoAlvo(null)}
        />
      )}

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

function KanbanCard({ tarefa, colunas, colAtual, onOpen, onDelete, onMove, onToggleEntrega, onDragStart, isDragging, qtdAnexos = 0, onAnexos, lembrete, onLembrete, arquivada = false }) {
  const concluida = colAtual === 'concluido'
  const prazo = concluida ? { tipo: null } : situacaoPrazo(tarefa.vencimento)
  const [showMove, setShowMove] = useState(false)
  const diasConcluida = concluida ? diasDesdeConclusao(tarefa) : null
  const faltam = diasConcluida !== null ? Math.max(DIAS_PARA_ARQUIVAR - diasConcluida, 0) : null

  // Faixa lateral: atrasada > vence hoje/em breve > prioridade alta > concluída
  const faixa = concluida ? 'var(--ok)'
    : prazo.tipo === 'atrasada' ? 'var(--danger)'
    : (prazo.tipo === 'hoje' || prazo.tipo === 'breve') ? 'var(--warn)'
    : tarefa.prioridade === 'alta' ? 'var(--danger)'
    : 'var(--border2)'
  const corPrazo = COR_PRAZO[prazo.tipo]

  return (
    <div
      draggable={!arquivada}
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`tarefa-card ${concluida ? 'concluida' : ''}`}
      style={{ borderLeftColor: faixa, opacity: isDragging ? 0.4 : 1 }}
      onMouseLeave={() => setShowMove(false)}>

      {/* Linha de cima: empresa + ações */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:6, marginBottom:6 }}>
        <span style={{ display:'flex', alignItems:'center', gap:5, minWidth:0, fontSize:10.5, color:'var(--text2)', fontWeight:600 }}>
          {!arquivada && <GripVerticalIcon size={12} style={{ color:'var(--text3)', cursor:'grab', flexShrink:0 }} />}
          {tarefa.clientes?.nome ? (
            <>
              <Building2Icon size={11} style={{ flexShrink:0, color:'var(--text3)' }} />
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={tarefa.clientes.nome}>
                {tarefa.clientes.nome.split(' ').slice(0,3).join(' ')}
              </span>
            </>
          ) : <span style={{ color:'var(--text3)', fontWeight:500 }}>Sem empresa</span>}
        </span>
        <div style={{ display:'flex', gap:2, flexShrink:0 }} onClick={e => e.stopPropagation()}>
          {onLembrete && (
            <button className="tarefa-card-acao" onClick={onLembrete}
              title={lembrete ? `Lembrete para ${new Date(lembrete.data_hora).toLocaleString('pt-BR')}` : 'Marcar lembrete'}
              style={{ color: lembrete ? 'var(--accent)' : undefined }}>
              {lembrete ? <BellRingIcon size={12} /> : <BellIcon size={12} />}
            </button>
          )}
          <div style={{ position:'relative' }}>
            <button className="tarefa-card-acao" title="Mover para..." onClick={() => setShowMove(v => !v)}>⇄</button>
            {showMove && (
              <div style={{ position:'absolute', right:0, top:22, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', zIndex:50, minWidth:150, boxShadow:'var(--shadow-md)' }}>
                {colunas.filter(c => arquivada || c.id !== colAtual).map(c => (
                  <button key={c.id} onClick={() => { onMove(c.id); setShowMove(false) }}
                    style={{ display:'flex', alignItems:'center', gap:6, width:'100%', padding:'7px 12px', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontSize:12, color: c.color, fontWeight:600 }}>
                    <c.Icon size={12} /> {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="tarefa-card-acao perigo" onClick={onDelete} title="Excluir tarefa">
            <Trash2Icon size={11} />
          </button>
        </div>
      </div>

      {/* Prioridade + título */}
      <div style={{ fontSize:12.5, fontWeight:600, lineHeight:1.4, marginBottom:8, display:'flex', gap:6, alignItems:'flex-start',
        textDecoration: concluida ? 'line-through' : 'none', color: concluida ? 'var(--text3)' : 'var(--text1)' }}>
        <PriDot pri={tarefa.prioridade} />
        <span>{tarefa.titulo}</span>
      </div>

      {/* Selos */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
        {prazo.tipo && (
          <span className="tarefa-selo" style={{ color: corPrazo.cor, background: corPrazo.bg, fontWeight: prazo.tipo === 'futuro' ? 500 : 700 }}
            title={`Vencimento ${fmtDate(String(tarefa.vencimento).slice(0,10))}`}>
            {prazo.tipo === 'atrasada' ? <AlertTriangleIcon size={10} /> : <CalendarIcon size={10} />} {prazo.texto}
          </span>
        )}
        {concluida && diasConcluida !== null && (
          <span className="tarefa-selo" style={{ color:'var(--ok)', background:'var(--ok-dim)' }}
            title={arquivada ? `Concluída em ${new Date(dataConclusao(tarefa)).toLocaleDateString('pt-BR')}` : `Vai para Arquivadas em ${faltam} dia${faltam !== 1 ? 's' : ''}`}>
            <CheckIcon size={10} /> {diasConcluida <= 0 ? 'Concluída hoje' : `Concluída há ${diasConcluida} dia${diasConcluida !== 1 ? 's' : ''}`}
          </span>
        )}
        <DeptChip dept={tarefa.departamento} />
        {tarefa.origem === 'whatsapp' && (
          <span className="tarefa-selo" style={{ background:'var(--info-dim)', color:'var(--info)', fontWeight:700 }}>WhatsApp</span>
        )}
        {tarefa.observacao && <span title="Tem observação" style={{ display:'flex' }}><MessageSquareIcon size={11} style={{ color:'var(--text3)' }} /></span>}
        {onAnexos && <BotaoAnexos qtd={qtdAnexos} onClick={onAnexos} tamanho={11} />}
      </div>

      {/* Rodapé: responsável + entrega */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, paddingTop:7, borderTop:'1px solid var(--border)' }}>
        {tarefa.responsavel ? (
          <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:10.5, color:'var(--text2)', minWidth:0 }} title={`Responsável: ${tarefa.responsavel}`}>
            <span className="tarefa-avatar">{iniciais(tarefa.responsavel)}</span>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tarefa.responsavel.split(' ')[0]}</span>
          </span>
        ) : <span style={{ fontSize:10.5, color:'var(--text3)' }}>Sem responsável</span>}
        <button onClick={e => { e.stopPropagation(); onToggleEntrega() }}
          title={tarefa.entregue ? 'Entregue — clique pra marcar como a entregar' : 'A entregar — clique pra marcar como entregue'}
          style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:3, fontSize:9.5, fontWeight:700, border:'none', cursor:'pointer', borderRadius:99, padding:'2px 8px',
            background: tarefa.entregue ? 'var(--ok-dim)' : 'var(--surface3)',
            color: tarefa.entregue ? 'var(--ok)' : 'var(--text3)' }}>
          <TruckIcon size={10} /> {tarefa.entregue ? 'Entregue' : 'A entregar'}
        </button>
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
  const [entregue,     setEntregue]     = useState(!!tarefa.entregue)
  const [saving,       setSaving]       = useState(false)

  // Chat
  const [comentarios,  setComentarios]  = useState([])
  const [msgTexto,     setMsgTexto]     = useState('')
  const [autor,        setAutor]        = useState(() => localStorage.getItem('gestor_autor') || '')
  const [sendingMsg,   setSendingMsg]   = useState(false)
  const [imagemColada, setImagemColada] = useState(null) // File colado com Ctrl+V, ainda não enviado
  const [imagemPreviewUrl, setImagemPreviewUrl] = useState(null)
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

  // Cola (Ctrl+V) uma imagem no campo de mensagem — fica em prévia até
  // "Enviar" (junto com o texto, se houver algum digitado também).
  const handlePasteMsg = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) return
    if (imagemPreviewUrl) URL.revokeObjectURL(imagemPreviewUrl)
    setImagemColada(file)
    setImagemPreviewUrl(URL.createObjectURL(file))
  }

  const limparImagemColada = () => {
    if (imagemPreviewUrl) URL.revokeObjectURL(imagemPreviewUrl)
    setImagemColada(null)
    setImagemPreviewUrl(null)
  }

  const handleEnviarMsg = async () => {
    if ((!msgTexto.trim() && !imagemColada) || !autor.trim()) return
    setSendingMsg(true)
    localStorage.setItem('gestor_autor', autor)
    try {
      let imagemPath = null, imagemNome = null
      if (imagemColada) {
        imagemPath = await uploadArquivo(imagemColada)
        imagemNome = imagemColada.name
      }
      const { data, error } = await supabase.from('tarefa_comentarios').insert({
        tarefa_id: tarefa.id,
        autor: autor.trim(),
        mensagem: msgTexto.trim(),
        imagem_path: imagemPath,
        imagem_nome: imagemNome,
      }).select().single()
      if (!error && data) setComentarios(c => [...c, data])
      setMsgTexto('')
      limparImagemColada()
    } finally {
      setSendingMsg(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    await supabase.from('tarefas').update({
      titulo, observacao,
      vencimento: vencimento || null,
      prioridade, departamento,
      cliente_id: clienteId || null,
      entregue,
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
              <div style={{ display:'flex', gap:6 }}>
                {[[false,'A entregar'],[true,'Entregue']].map(([val,lbl]) => (
                  <button key={lbl} type="button" onClick={() => setEntregue(val)}
                    style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'8px', borderRadius:'var(--r-sm)', fontSize:12, fontWeight:600, cursor:'pointer',
                      background: entregue===val ? (val ? 'var(--ok-dim)' : 'var(--warn-dim)') : 'var(--surface2)',
                      border: `1px solid ${entregue===val ? (val ? 'var(--ok)' : 'var(--warn)') : 'var(--border)'}`,
                      color: entregue===val ? (val ? 'var(--ok)' : 'var(--warn)') : 'var(--text3)' }}>
                    <TruckIcon size={13} /> {lbl}
                  </button>
                ))}
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
                      maxWidth:'80%', padding: c.imagem_path ? 6 : '8px 12px', borderRadius: isMe ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: isMe ? 'var(--accent)' : 'var(--surface2)',
                      color: isMe ? '#fff' : 'var(--text1)',
                      fontSize:13, lineHeight:1.5,
                      border: isMe ? 'none' : '1px solid var(--border)',
                    }}>
                      {c.imagem_path && <ImagemComentario path={c.imagem_path} nome={c.imagem_nome} />}
                      {c.mensagem && <div style={{ padding: c.imagem_path ? '6px 6px 0' : 0 }}>{c.mensagem}</div>}
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
              {imagemPreviewUrl && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, background:'var(--surface2)',
                  border:'1px solid var(--border)', borderRadius:'var(--r-sm)', padding:6 }}>
                  <img src={imagemPreviewUrl} alt="Prévia" style={{ width:44, height:44, objectFit:'cover', borderRadius:6, flexShrink:0 }} />
                  <span style={{ fontSize:12, color:'var(--text2)', flex:1 }}>Imagem colada — pronta pra enviar</span>
                  <button onClick={limparImagemColada} title="Remover imagem"
                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', flexShrink:0 }}>
                    <XIcon size={14} />
                  </button>
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                {!autor && (
                  <input placeholder="Seu nome..." value={autor} onChange={e => setAutor(e.target.value)}
                    style={{ width:110, flexShrink:0, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
                )}
                <input
                  placeholder="Digite ou cole uma imagem (Ctrl+V)..."
                  value={msgTexto}
                  onChange={e => setMsgTexto(e.target.value)}
                  onPaste={handlePasteMsg}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleEnviarMsg()}
                  style={{ flex:1, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
                <button onClick={handleEnviarMsg} disabled={sendingMsg || (!msgTexto.trim() && !imagemColada) || !autor.trim()}
                  style={{ background:'var(--accent)', border:'none', borderRadius:'var(--r-sm)', padding:'8px 14px', cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', opacity: (!msgTexto.trim() && !imagemColada) || !autor.trim() ? .5 : 1 }}>
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

// Imagem colada no chat — o bucket é privado, então precisa de uma signed
// URL pra exibir (gerada de novo a cada montagem, 30min de validade é de
// sobra pra uma sessão de chat aberta).
function ImagemComentario({ path, nome }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let ativo = true
    criarLinkAssinado(path, 60 * 30).then((u) => { if (ativo) setUrl(u) }).catch(() => {})
    return () => { ativo = false }
  }, [path])

  if (!url) return <div style={{ fontSize:11, color:'var(--text3)', padding:'4px 6px' }}>Carregando imagem...</div>

  return (
    <a href={url} target="_blank" rel="noreferrer" title={nome || 'Ver imagem'}>
      <img src={url} alt={nome || 'imagem anexada'} style={{ maxWidth:220, maxHeight:220, borderRadius:6, display:'block' }} />
    </a>
  )
}
