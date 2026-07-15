import { useState, useMemo, useEffect } from 'react'
import { PlusIcon, EyeOffIcon, CheckCircleIcon, AlertCircleIcon, ClockIcon, SaveIcon } from 'lucide-react'
import { useStore } from '../store'
import { supabase } from '../lib/supabase'
import {
  listarDepartamentos, criarDepartamento, listarTiposObrigacao,
  criarObrigacaoComEtapas, listarObrigacoesComEtapas, statusVisualEtapa,
} from './andamento/andamentoApi'
import DepartamentoTimeline from './andamento/DepartamentoTimeline'
import HistoricoObrigacaoModal from './andamento/HistoricoObrigacaoModal'

const DEPTS_DEFAULT = ['Fiscal', 'Folha', 'Societário', 'Contábil', 'Escritório']
const DEPT_ICONS = { 'Fiscal':'🧾','Folha':'👥','Societário':'💼','Contábil':'🧮','Escritório':'🏠' }

const DEPT_OBS_MAP = {
  'Fiscal':     ['PGDAS', 'DCTFWeb', 'NFS-e'],
  'Folha':      ['eSocial', 'Folha'],
  'Societário': ['Documentos'],
  'Contábil':   ['Extrato Bancário'],
  'Escritório': ['Parcelamento'],
}

const ALL_TIPOS = ['PGDAS','DCTFWeb','NFS-e','eSocial','Folha','Documentos','Extrato Bancário','Parcelamento']
const STATUS_OBS = ['pendente','concluido','nao_aplica','vencido']
const STATUS_OBS_LABEL = { pendente:'Pendente', concluido:'Concluído', nao_aplica:'N/A', vencido:'Vencido' }

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

const AVATAR_COLORS = [
  ['#1a2e22','#34d399'],['#2a1f10','#fbbf24'],['#18203a','var(--accent)'],
  ['#2a1820','#f9a8d4'],['#1e1a30','#c4b5fd'],['#182828','#5eead4'],
  ['#1a2a1a','#86efac'],['#1e2a2a','#67e8f9'],['#2a1a1a','#fca5a5'],
]

// Monta a(s) trilha(s) de um departamento pra uma empresa: prioriza processo
// com etapas ativo (o real); se não tiver, cai pro checklist mensal legado
// tratando cada item como uma pseudo-etapa (sem conceito real de sequência,
// mas dá o mesmo idioma visual pra tudo); se não tiver nada, uma trilha vazia
// de um ponto só. Pode devolver mais de uma trilha se houver 2+ processos
// ativos ao mesmo tempo no mesmo departamento.
function construirTrilhas(obsEmp, procEmp, dept) {
  const ativos = procEmp.filter(p => p.status !== 'concluido')
  const fonte = ativos.length > 0 ? ativos : procEmp.slice(0, 1)

  if (fonte.length > 0) {
    return fonte.map(p => ({
      kind: 'processo',
      titulo: p.titulo,
      stages: (p.etapas_obrigacao || []).map(e => ({
        key: e.id, nome: e.nome, statusVisual: statusVisualEtapa(e), kind: 'processo', raw: e, obrigacaoRef: p,
      })),
    }))
  }

  const tipos = DEPT_OBS_MAP[dept] || []
  const itens = obsEmp.filter(o => tipos.includes(o.tipo))
  if (itens.length > 0) {
    let marcouAtual = false
    const stages = itens.map(o => {
      let sv
      if (o.status === 'vencido') sv = 'atrasado'
      else if (o.status === 'concluido' || o.status === 'nao_aplica') sv = 'concluido'
      else { sv = marcouAtual ? 'pendente' : 'em_andamento'; marcouAtual = true }
      return { key: o.id, nome: o.tipo, statusVisual: sv, kind: 'legacy', raw: o, obrigacaoRef: o }
    })
    return [{ kind: 'legacy', titulo: `Checklist ${dept}`, stages }]
  }

  return [{ kind: 'empty', titulo: 'Sem pendências',
    stages: [{ key: 'empty', nome: '—', statusVisual: 'concluido', kind: 'empty', raw: null }] }]
}

// status agregado do departamento (pros filtros Todos/Pendentes/Críticos/OK,
// que já existiam e continuam funcionando do mesmo jeito)
function statusAgregado(trilhas) {
  const stages = trilhas.flatMap(t => t.stages)
  if (trilhas.every(t => t.kind === 'empty')) return 'empty'
  if (stages.some(s => s.statusVisual === 'atrasado')) return 'danger'
  if (stages.every(s => s.statusVisual === 'concluido')) return 'ok'
  return 'warn'
}

const S_COLOR = { ok:'#2A7A5A', warn:'#9A6B1A', danger:'#A83030', empty:'#8A8F9E' }
const S_BG    = { ok:'rgba(42,122,90,.12)', warn:'rgba(154,107,26,.12)', danger:'rgba(168,48,48,.12)', empty:'var(--surface2)' }
const S_ICON  = { ok:CheckCircleIcon, warn:ClockIcon, danger:AlertCircleIcon, empty:null }

export default function Empresas({ onOpenTarefa } = {}) {
  const clientes        = useStore(s => s.clientes)
  const obrigacoes      = useStore(s => s.obrigacoes || [])
  const tarefas         = useStore(s => s.tarefas)
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const fetchTarefas    = useStore(s => s.fetchTarefas)

  const [compSel,     setCompSel]     = useState(compMesAtras(1))
  const [busca,       setBusca]       = useState('')
  const [filtro,      setFiltro]      = useState('todos')
  const [carteira,    setCarteira]    = useState('todas')
  const [depts,       setDepts]       = useState(DEPTS_DEFAULT)
  const [showAddDept, setShowAddDept] = useState(false)
  const [novoDept,    setNovoDept]    = useState('')
  const [ocultarVazios, setOcultarVazios] = useState(false)

  // Departamentos cadastráveis (tabela "departamentos") + obrigações novas
  // (processos com etapas, tabela "obrigacoes" com tipo_obrigacao_id)
  const [departamentosDb, setDepartamentosDb] = useState([])
  const [processos,       setProcessos]       = useState([])
  const [historicoModal,  setHistoricoModal]  = useState(null) // {cliente, dept, trilha, stage}
  const [novaObs,   setNovaObs]   = useState(null) // {cliente, dept}
  const [novaTarefa, setNovaTarefa] = useState(null) // {cliente}

  const carregarDepartamentos = async () => {
    try {
      const d = await listarDepartamentos()
      if (d.length > 0) { setDepartamentosDb(d); setDepts(d.map(x => x.nome)) }
    } catch { /* migration ainda não rodou — segue com DEPTS_DEFAULT */ }
  }
  const carregarProcessos = async () => {
    if (clientes.length === 0) return
    try { setProcessos(await listarObrigacoesComEtapas(clientes.map(c => c.id))) }
    catch { /* idem */ }
  }

  useEffect(() => { carregarDepartamentos() }, [])
  useEffect(() => { carregarProcessos() }, [clientes.length])

  const deptIdPorNome = useMemo(
    () => Object.fromEntries(departamentosDb.map(d => [d.nome, d.id])),
    [departamentosDb]
  )

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
        const obsEmp  = obrigacoes.filter(o => o.cliente_id===c.id && o.competencia===compSel)
        const procEmp = processos.filter(p => p.cliente_id===c.id)
        const trilhasPorDept = {}
        depts.forEach(d => {
          const procDept = procEmp.filter(p => p.departamento_id === deptIdPorNome[d])
          trilhasPorDept[d] = construirTrilhas(obsEmp, procDept, d)
        })
        const deptStatus = {}
        depts.forEach(d => { deptStatus[d] = statusAgregado(trilhasPorDept[d]) })
        const hasDanger = Object.values(deptStatus).some(s => s === 'danger')
        const hasPend   = Object.values(deptStatus).some(s => s === 'warn')
        const allOk     = Object.values(deptStatus).every(s => s === 'ok' || s === 'empty')
        return { c, trilhasPorDept, deptStatus, hasDanger, hasPend, allOk }
      })
      .filter(r => {
        if (filtro==='criticos')  return r.hasDanger
        if (filtro==='pendentes') return r.hasPend || r.hasDanger
        if (filtro==='ok')        return r.allOk
        return true
      })
  }, [clientes, obrigacoes, processos, compSel, busca, depts, deptIdPorNome, filtro, carteira])

  // Mudar status de item legado direto via supabase + refetch
  const handleStatusObs = async (obsId, novoStatus) => {
    await supabase.from('obrigacoes').update({ status: novoStatus, updated_at: new Date().toISOString() }).eq('id', obsId)
    await fetchObrigacoes()
  }

  // Persiste o departamento novo (antes só ficava em memória e sumia ao
  // recarregar a página)
  const handleAddDept = async () => {
    const d = novoDept.trim()
    if (d && !depts.includes(d)) {
      try { await criarDepartamento(d) } catch { /* ignora — pode já existir */ }
      await carregarDepartamentos()
      setDepts(p => (p.includes(d) ? p : [...p, d]))
    }
    setNovoDept(''); setShowAddDept(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', overflow:'hidden' }}>

      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap', rowGap:6 }}>
        <div>
          <h2 style={{ fontSize:14, fontWeight:500, color:'var(--text1)', margin:0 }}>Empresas</h2>
          <p style={{ fontSize:10, color:'var(--text3)', margin:0 }}>Andamento por departamento · {rows.length} empresas</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 9px', marginLeft:12 }}>
          <span style={{ fontSize:12, color:'var(--text3)' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa..."
            style={{ background:'none', border:'none', outline:'none', fontSize:11, color:'var(--text2)', width:160 }} />
        </div>
        {carteiras.length > 1 && (
          <select value={carteira} onChange={e => setCarteira(e.target.value)}
            style={{ background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}>
            {carteiras.map(c => <option key={c} value={c}>{c==='todas'?'Todas as carteiras':c}</option>)}
          </select>
        )}
        <button onClick={() => setShowAddDept(true)}
          style={{ display:'flex', alignItems:'center', gap:4, background:'var(--surface2)', border:'1px dashed var(--border2)', borderRadius:8, padding:'5px 9px', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>
          <PlusIcon size={11} /> Departamento
        </button>
        <div style={{ marginLeft:'auto' }}>
          <select value={compSel} onChange={e => setCompSel(e.target.value)}
            style={{ background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}>
            {[0,1,2,3].map(i => { const c=compMesAtras(i); return <option key={c} value={c}>{i===0?`Atual (${c})`:i===1?`Anterior (${c})`:c}</option> })}
          </select>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:5, padding:'7px 16px', borderBottom:'1px solid #1e2438', flexShrink:0, background:'var(--surface2)', alignItems:'center' }}>
        {[['todos','Todos'],['pendentes','Pendentes'],['criticos','Críticos'],['ok','100% ok']].map(([id,lbl]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ background:filtro===id?'var(--accent-dim)':'var(--surface2)', border:`1px solid ${filtro===id?'var(--accent)':'var(--border)'}`,
              borderRadius:99, padding:'3px 9px', fontSize:10, color:filtro===id?'var(--accent)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
            {lbl}
          </button>
        ))}
        <button onClick={() => setOcultarVazios(v => !v)}
          title="Ocultar departamentos sem pendência dentro de cada card"
          style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5,
            background:ocultarVazios?'var(--accent-dim)':'var(--surface2)', border:`1px solid ${ocultarVazios?'var(--accent)':'var(--border)'}`,
            borderRadius:99, padding:'3px 9px', fontSize:10, color:ocultarVazios?'var(--accent)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
          <EyeOffIcon size={11} /> Ocultar sem pendência
        </button>
      </div>

      {/* Legenda */}
      <div style={{ display:'flex', gap:18, padding:'8px 16px', flexShrink:0, fontSize:11, color:'var(--text3)', flexWrap:'wrap' }}>
        {[['var(--navy)','var(--navy)','Concluído'],['var(--bg)','var(--navy)','Em andamento'],['var(--danger)','var(--danger)','Atrasado'],['var(--surface2)','var(--border2)','Pendente']].map(([bg,border,label]) => (
          <span key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:12, height:12, borderRadius:'50%', background:bg, border:`2px solid ${border}`, display:'inline-block' }} />
            {label}
          </span>
        ))}
      </div>

      {/* Lista de cards */}
      <div style={{ flex:1, overflow:'auto', padding:'4px 16px 16px' }}>
        {rows.length === 0 && (
          <div style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13 }}>Nenhuma empresa encontrada</div>
        )}
        {rows.map(({ c, trilhasPorDept, deptStatus }, ri) => {
          const [bg, tc] = AVATAR_COLORS[ri % AVATAR_COLORS.length]
          const initials = c.nome.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
          const piorStatus = ['danger','warn','ok','empty'].find(s => Object.values(deptStatus).includes(s)) || 'empty'
          const Icon = S_ICON[piorStatus]
          const deptsCard = ocultarVazios ? depts.filter(d => deptStatus[d] !== 'empty') : depts

          return (
            <div key={c.id} style={{ background:'var(--surface)', borderRadius:12, padding:'16px 20px', marginBottom:14, boxShadow:'var(--shadow-sm)' }}>

              {/* Header do card */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:42, height:42, borderRadius:9, background:bg, color:tc, flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize:15, fontWeight:700, color:'var(--text1)' }}>{c.nome}</div>
                    <div style={{ fontSize:11.5, color:'var(--text3)', marginTop:1, display:'flex', gap:6, alignItems:'center' }}>
                      {c.cnpj || c.regime || 'Simples Nacional'}
                      {c.carteira && <span style={{ background:'var(--accent-dim)', color:'var(--accent)', borderRadius:99, padding:'0 6px', fontSize:10, fontWeight:600 }}>{c.carteira}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ display:'flex', alignItems:'center', gap:5, background:S_BG[piorStatus], color:S_COLOR[piorStatus], borderRadius:99, padding:'4px 10px', fontSize:11, fontWeight:600 }}>
                    {Icon && <Icon size={12} />} {depts.length} departamentos
                  </span>
                  <button onClick={() => setNovaTarefa({ cliente: c })}
                    style={{ background:'var(--navy)', border:'none', borderRadius:8, padding:'5px 10px', fontSize:11, color:'#fff', fontWeight:500, cursor:'pointer' }}>
                    + Tarefa
                  </button>
                </div>
              </div>

              {/* Linhas de departamento */}
              {deptsCard.length === 0 && (
                <div style={{ fontSize:12, color:'var(--text3)', padding:'8px 0' }}>Sem departamentos com pendência.</div>
              )}
              {deptsCard.map((d, di) => (
                <div key={d} style={{ display:'grid', gridTemplateColumns:'150px 1fr auto', alignItems:'center', gap:14, padding:'10px 0',
                  borderTop: di === 0 ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--text1)', display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:13 }}>{DEPT_ICONS[d] || '📋'}</span> {d}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {trilhasPorDept[d].map((trilha, ti) => (
                      <DepartamentoTimeline key={ti} trilha={trilha}
                        onStageClick={(stage) => setHistoricoModal({ cliente: c, dept: d, trilha, stage })} />
                    ))}
                  </div>
                  <button onClick={() => setNovaObs({ cliente: c, dept: d })} title={`Nova obrigação — ${d}`}
                    style={{ background:'none', border:'1px dashed var(--border2)', borderRadius:6, width:22, height:22,
                      color:'var(--text3)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <PlusIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Histórico/etapa (clicou num ponto da trilha) */}
      {historicoModal && (
        <HistoricoObrigacaoModal
          stage={historicoModal.stage}
          titulo={historicoModal.trilha.kind === 'legacy' ? historicoModal.stage.nome : historicoModal.trilha.titulo}
          clienteNome={historicoModal.cliente.nome}
          departamentoNome={historicoModal.dept}
          onClose={() => setHistoricoModal(null)}
          onAtualizado={async () => { setHistoricoModal(null); await Promise.all([carregarProcessos(), fetchObrigacoes()]) }}
          onAbrirTarefa={(taskId) => { setHistoricoModal(null); onOpenTarefa?.(taskId) }}
          onChangeLegacyStatus={handleStatusObs}
        />
      )}

      {/* Modal add departamento */}
      {showAddDept && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowAddDept(false)}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:20, width:300 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:13, fontWeight:500, color:'var(--text1)', marginBottom:12 }}>🏢 Novo departamento</div>
            <input value={novoDept} onChange={e => setNovoDept(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleAddDept()} autoFocus
              placeholder="Ex: Pessoal, Fiscal Estadual..."
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

      {/* Modal nova obrigação */}
      {novaObs && (
        <NovaObrigacaoModal
          cliente={novaObs.cliente}
          dept={novaObs.dept}
          departamentoId={deptIdPorNome[novaObs.dept]}
          competencia={compSel}
          onClose={() => setNovaObs(null)}
          onSaved={async () => { setNovaObs(null); await fetchObrigacoes(); await carregarProcessos() }}
        />
      )}

      {/* Modal nova tarefa */}
      {novaTarefa && (
        <NovaTarefaModal
          cliente={novaTarefa.cliente}
          onClose={() => setNovaTarefa(null)}
          onSaved={async () => { setNovaTarefa(null); await fetchTarefas() }}
        />
      )}
    </div>
  )
}

// ── Modal Nova Obrigação ─────────────────────────────────────────────────────
// Duas naturezas: "simples" (checklist mensal legado, tipo livre) ou
// "processo" (tipo_obrigacao cadastrado com etapas — vira uma timeline).
function NovaObrigacaoModal({ cliente, dept, departamentoId, competencia, onClose, onSaved }) {
  const tiposDisponiveis = dept ? (DEPT_OBS_MAP[dept] || ALL_TIPOS) : ALL_TIPOS
  const [tipo,       setTipo]       = useState(tiposDisponiveis[0] || '')
  const [status,     setStatus]     = useState('pendente')
  const [vencimento, setVencimento] = useState('')
  const [saving,     setSaving]     = useState(false)

  const [tiposProcesso,   setTiposProcesso]   = useState([])
  const [modo,             setModo]           = useState('simples') // simples | processo
  const [tipoProcessoId,   setTipoProcessoId] = useState('')
  const [titulo,           setTitulo]         = useState('')
  const [responsavel,      setResponsavel]    = useState('')

  useEffect(() => {
    if (!departamentoId) return
    listarTiposObrigacao(departamentoId).then(setTiposProcesso).catch(() => {})
  }, [departamentoId])

  const handleSave = async () => {
    setSaving(true)
    try {
      if (modo === 'processo') {
        if (!tipoProcessoId) return
        const tipoObj = tiposProcesso.find(t => t.id === tipoProcessoId)
        await criarObrigacaoComEtapas({
          clienteId: cliente.id, tipoObrigacaoId: tipoProcessoId, departamentoId,
          titulo: titulo.trim() || tipoObj?.nome || 'Obrigação', responsavel: responsavel.trim() || null,
        })
      } else {
        if (!tipo) return
        await supabase.from('obrigacoes').upsert({
          cliente_id: cliente.id, tipo, status, competencia,
          vencimento: vencimento || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'cliente_id,tipo,competencia' })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalBase onClose={onClose} titulo={`Nova obrigação — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

        {tiposProcesso.length > 0 && (
          <div style={{ display:'flex', gap:6 }}>
            {[['simples','Simples'],['processo','Processo c/ etapas']].map(([id,lbl]) => (
              <button key={id} type="button" onClick={() => setModo(id)}
                style={{ flex:1, background:modo===id?'var(--accent-dim)':'var(--surface2)', border:`1px solid ${modo===id?'var(--accent)':'var(--border)'}`,
                  borderRadius:8, padding:'7px', fontSize:11, fontWeight:600, color:modo===id?'var(--accent)':'var(--text3)', cursor:'pointer' }}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {modo === 'processo' ? <>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de obrigação</label>
            <select value={tipoProcessoId} onChange={e => setTipoProcessoId(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="">Selecione...</option>
              {tiposProcesso.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Título (opcional)</label>
            <input value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Rescisão — João da Silva"
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Responsável (opcional)</label>
            <input value={responsavel} onChange={e => setResponsavel(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
        </> : <>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Status inicial</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              {STATUS_OBS.map(s => <option key={s} value={s}>{STATUS_OBS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
          <div style={{ fontSize:10, color:'var(--text3)' }}>Competência: <strong style={{ color:'var(--text2)' }}>{competencia}</strong></div>
        </>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving || (modo==='processo' ? !tipoProcessoId : !tipo)}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:saving?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving?'Salvando...':'Salvar'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Nova Tarefa ────────────────────────────────────────────────────────
function NovaTarefaModal({ cliente, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState('')
  const [departamento, setDepartamento] = useState('geral')
  const [prioridade,   setPrioridade]   = useState('normal')
  const [vencimento,   setVencimento]   = useState('')
  const [observacao,   setObservacao]   = useState('')
  const [saving,       setSaving]       = useState(false)

  const handleSave = async () => {
    if (!titulo.trim()) return
    setSaving(true)
    await supabase.from('tarefas').insert({
      titulo: titulo.trim(), departamento, prioridade,
      vencimento: vencimento || null, observacao: observacao || null,
      cliente_id: cliente.id, concluida: false,
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <ModalBase onClose={onClose} titulo={`Nova tarefa — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Título *</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus
            placeholder="Descreva a tarefa..."
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Departamento</label>
            <select value={departamento} onChange={e => setDepartamento(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              {['fiscal','folha','societario','contabil','escritorio','geral','pessoal'].map(d => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Prioridade</label>
            <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Vencimento</label>
          <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Observações</label>
          <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
            placeholder="Detalhes adicionais..."
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        </div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!titulo.trim()}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!titulo.trim())?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving?'Salvando...':'Criar tarefa'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Base ───────────────────────────────────────────────────────────────
function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(27,43,75,.45)', zIndex:2000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
        overflow:'hidden', width:'100%', maxWidth:400, maxHeight:'90vh', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'12px 16px', background:'#1B2B4B', borderBottom:'1px solid #243660' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'#fff' }}>{titulo}</span>
          <button onClick={onClose}
            style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)',
              borderRadius:6, width:22, height:22, color:'#8fadd4', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>✕</button>
        </div>
        <div style={{ padding:20, overflowY:'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
