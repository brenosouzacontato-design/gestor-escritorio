import { useState, useMemo, useEffect } from 'react'
import { PlusIcon, XIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, ChevronRightIcon, CalendarIcon, CheckIcon, SaveIcon, ZapIcon, RefreshCwIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue, useToast } from '../components/shared'
import { supabase } from '../lib/supabase'
import {
  listarDepartamentos, criarDepartamento, listarTiposObrigacao, criarTipoObrigacaoComEtapas,
  criarObrigacaoComEtapas, criarTarefasLote, gerarObrigacoesRecorrentesCompetencia, criarObrigacoesLote,
  calcularVencimento,
} from './andamento/andamentoApi'

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
  pendente:   { bg:'rgba(154,107,26,.12)',  color:'#9A6B1A' },
  concluido:  { bg:'rgba(42,122,90,.12)',   color:'#2A7A5A' },
  nao_aplica: { bg:'rgba(30,95,160,.12)',   color:'#1E5FA0' },
  vencido:    { bg:'rgba(168,48,48,.12)',   color:'#A83030' },
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

const S_COLOR = { ok:'#2A7A5A', warn:'#9A6B1A', venc_breve:'#C2540A', danger:'#A83030', na:'#1E5FA0', empty:'#8A8F9E' }
const S_BG    = { ok:'rgba(42,122,90,.10)', warn:'rgba(154,107,26,.10)', venc_breve:'rgba(194,84,10,.12)', danger:'rgba(168,48,48,.10)', na:'rgba(30,95,160,.10)', empty:'var(--surface2)' }
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

export default function Empresas() {
  const clientes        = useStore(s => s.clientes)
  const obrigacoes      = useStore(s => s.obrigacoes || [])
  const tarefas         = useStore(s => s.tarefas)
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const fetchTarefas    = useStore(s => s.fetchTarefas)
  const { show }        = useToast()

  // Competência única do app — só o Painel tem o seletor; essa tela lê o
  // mesmo valor do store, sem controle próprio.
  const compSel = useStore(s => s.competenciaSelecionada)
  const [busca,       setBusca]       = useState('')
  const [filtro,      setFiltro]      = useState('todos')
  const [carteira,    setCarteira]    = useState('todas')
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

  const openDrawer = (c, dept) => { setDrawer({c, dept}); setDrawerTab('obrig') }

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
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={handleGerarCompetencia} disabled={gerando}
            title="Gerar obrigações recorrentes desta competência (automático, todas as empresas)"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:'pointer', fontWeight:500, opacity:gerando?.6:1 }}>
            <RefreshCwIcon size={12} /> {gerando ? 'Gerando...' : `Gerar ${compSel}`}
          </button>
          <button onClick={() => setShowLoteObs(true)}
            title="Criar uma obrigação escolhida à mão pra várias empresas"
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 10px', fontSize:11, color:'var(--text2)', cursor:'pointer', fontWeight:500 }}>
            <ZapIcon size={12} /> Obrigações em lote
          </button>
          <span style={{ background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}
            title="Competência escolhida no Painel">
            {compSel}
          </span>
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
      </div>

      {/* Área principal */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>

        {/* Scroll container — sticky funciona aqui */}
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
              <tr style={{ background:'#1B2B4B' }}>
                <th style={{ padding:'12px 14px', textAlign:'left', fontWeight:600, fontSize:12, color:'#8fadd4',
                  textTransform:'uppercase', letterSpacing:.6, position:'relative',
                  borderBottom:'2px solid #243660', borderRight:'1px solid #243660', userSelect:'none' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:6 }}>🏢 Empresa</span>
                  <div onMouseDown={handleResizeNome}
                    style={{ position:'absolute', right:0, top:0, bottom:0, width:5, cursor:'col-resize' }} />
                </th>
                <th style={{ padding:'12px 8px', textAlign:'center', fontWeight:600, fontSize:12,
                  color:'#fbbf24', textTransform:'uppercase', letterSpacing:.5,
                  borderBottom:'2px solid #243660', borderRight:'2px solid #3b5280', background:'#162240' }}>
                  <div style={{ fontSize:18, marginBottom:4 }}>📊</div>
                  <div>Resumo</div>
                  <div style={{ fontSize:10, color:'#6B80A8', marginTop:2, fontWeight:400 }}>geral</div>
                </th>
                {departamentos.map(d => (
                  <th key={d.id} style={{ padding:'12px 8px', textAlign:'center', fontWeight:600, fontSize:12,
                    color:'#8fadd4', textTransform:'uppercase', letterSpacing:.5,
                    borderBottom:'2px solid #243660', borderRight:'1px solid #243660' }}>
                    <div style={{ fontSize:18, marginBottom:4 }}>{d.icone||'📋'}</div>
                    <div>{d.nome}</div>
                    <button onClick={() => setLoteDept(d)} title={`Tarefas em lote — ${d.nome}`}
                      style={{ marginTop:4, background:'none', border:'1px dashed #3b5280', borderRadius:4,
                        padding:'1px 6px', fontSize:9, color:'#6B80A8', cursor:'pointer', fontWeight:400 }}>
                      <ZapIcon size={9} style={{ verticalAlign:-1, marginRight:2 }} />lote
                    </button>
                  </th>
                ))}
                <th style={{ padding:'12px 4px', textAlign:'center', borderBottom:'2px solid #243660' }}>
                  <button onClick={() => setShowAddDept(true)} title="Novo módulo"
                    style={{ background:'none', border:'1px dashed #3b5280', borderRadius:4, width:22, height:22,
                      color:'#6B80A8', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
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
                    style={{ background: isSel?'rgba(30,95,160,.08)':zebra, borderBottom:'1px solid var(--border)', cursor:'pointer' }}
                    onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='var(--sand-dim)' }}
                    onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=zebra }}>

                    {/* Empresa */}
                    <td style={{ padding:'11px 14px', borderRight:'1px solid var(--border)' }}
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
                            {c.carteira && <span style={{ background:'rgba(30,95,160,.12)', color:'var(--accent)', borderRadius:99, padding:'0 6px', fontSize:10, fontWeight:600 }}>{c.carteira}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Resumo geral */}
                    <td style={{ padding:'6px 4px', textAlign:'center', borderRight:'2px solid var(--border)', background: isSel?'rgba(30,95,160,.05)': ri%2===0?'rgba(27,43,75,.03)':'rgba(27,43,75,.06)' }}
                      onClick={() => openDrawer(c, null)}>
                      <DeptPill data={resumo} onClick={() => openDrawer(c, null)} />
                    </td>

                    {/* Módulos */}
                    {departamentos.map(d => (
                      <td key={d.id} style={{ padding:'6px 4px', textAlign:'center', borderRight:'1px solid var(--border)' }}>
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

        {/* Drawer */}
        {drawer && (
          <>
            <div style={{ position:'absolute', inset:0, zIndex:9 }} onClick={() => setDrawer(null)} />
            <div style={{ position:'absolute', top:0, right:0, bottom:0, width:340, zIndex:10,
              background:'var(--surface)', borderLeft:'1px solid var(--border)', display:'flex', flexDirection:'column',
              boxShadow:'-4px 0 20px rgba(27,43,75,.15)', animation:'sli .2s ease' }}>
              <style>{`@keyframes sli{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

              {/* Header drawer — navy */}
              <div style={{ padding:'12px 14px', borderBottom:'1px solid #243660', flexShrink:0,
                display:'flex', alignItems:'flex-start', gap:8, background:'#1B2B4B' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {drawer.c.nome}
                  </div>
                  <div style={{ fontSize:10, color:'#8fadd4', marginTop:2 }}>{drawer.dept?.nome||'Todos os módulos'} · {compSel}</div>
                </div>
                <button onClick={() => setDrawer(null)}
                  style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', borderRadius:6, width:24, height:24,
                    display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#8fadd4', flexShrink:0 }}>
                  <XIcon size={13} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display:'flex', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)' }}>
                {[['obrig',`📋 Obrigações (${drawerObs.length})`],['tarefas',`✓ Tarefas (${drawerTasks.length})`]].map(([id,lbl]) => (
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
                    return (
                      <div key={o.id} style={{ background:'var(--surface)', border:'1px solid var(--border)',
                        borderLeft: vencendo ? '3px solid #C2540A' : '1px solid var(--border)', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom: o.vencimento ? 6 : 0 }}>
                          <span style={{ fontSize:12, fontWeight:500, color:'var(--text1)' }}>{o.titulo || o.tipo}</span>
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
                          <div style={{ fontSize:10, color:o.status==='vencido'?'#f87171':vencendo?'#C2540A':'var(--text3)', display:'flex', alignItems:'center', gap:4, fontWeight:vencendo?600:400 }}>
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
                    const busy = updatingId === t.id
                    return (
                      <div key={t.id} style={{ background:'var(--surface2)', border:'1px solid #1e2438', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:5 }}>
                          <button onClick={() => handleToggleTask(t)} disabled={busy}
                            style={{ width:16, height:16, borderRadius:4, flexShrink:0, marginTop:1, cursor:'pointer',
                              border:`1px solid ${t.concluida?'#34d399':'#3b4570'}`,
                              background:t.concluida?'#34d399':'transparent',
                              display:'flex', alignItems:'center', justifyContent:'center', opacity:busy?.5:1 }}>
                            {t.concluida && <CheckIcon size={10} color="#12151f" strokeWidth={3} />}
                          </button>
                          <div style={{ flex:1, minWidth:0 }}>
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
                        </div>
                      </div>
                    )
                  })}
                </>}
              </div>

              {/* Footer drawer */}
              <div style={{ padding:'10px 14px', borderTop:'1px solid var(--border)', flexShrink:0, display:'flex', gap:7, background:'var(--surface)' }}>
                <button onClick={() => { setShowNovaObs(true) }}
                  style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px', fontSize:11, color:'var(--text2)', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                  🧾 + Obrigação
                </button>
                <button onClick={() => { setShowNovaTarefa(true) }}
                  style={{ flex:1, background:'#1B2B4B', border:'none', borderRadius:8, padding:'7px', fontSize:11, color:'#fff', fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                  ✓ + Tarefa
                </button>
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
        <NovaTarefaModal
          cliente={drawer.c}
          dept={drawer.dept}
          onClose={() => setShowNovaTarefa(false)}
          onSaved={async () => { setShowNovaTarefa(false); await fetchTarefas() }}
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
            show?.(`${resultado.criadas} criada${resultado.criadas!==1?'s':''}${resultado.jaExistiam ? `, ${resultado.jaExistiam} já existia${resultado.jaExistiam!==1?'m':''}` : ''}`)
          }}
        />
      )}
    </div>
  )
}

// ── Modal Nova Obrigação (modelo novo) ───────────────────────────────────────
function NovaObrigacaoModal({ cliente, dept, departamentos, competencia, onClose, onSaved }) {
  const [departamentoId, setDepartamentoId] = useState(dept?.id || departamentos[0]?.id || '')
  const [tipos,          setTipos]          = useState([])
  const [tipoId,         setTipoId]         = useState('')
  const [criandoNovo,    setCriandoNovo]    = useState(false)
  const [novoNome,       setNovoNome]       = useState('')
  const [novaPeriodicidade, setNovaPeriodicidade] = useState('mensal')
  const [recorrente,     setRecorrente]     = useState(true)
  const [mesVencimento,  setMesVencimento]  = useState('mesmo')
  const [diaVencimento,  setDiaVencimento]  = useState('')
  const [diasLembrete,   setDiasLembrete]   = useState(3)
  const [prazoDias,      setPrazoDias]      = useState(15) // usado só quando não é recorrente (vencimento fixo dia/mês não se aplica)
  const [saving,         setSaving]         = useState(false)
  const [erro,           setErro]           = useState(null)

  useEffect(() => {
    if (!departamentoId) { setTipos([]); setTipoId(''); return }
    listarTiposObrigacao(departamentoId).then(setTipos).catch(() => {})
  }, [departamentoId])

  const podeSalvar = departamentoId && (criandoNovo ? novoNome.trim() : tipoId)

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    setErro(null)
    try {
      let tipoObrigacaoId = tipoId
      let nomeTipo = tipos.find(t => t.id === tipoId)?.nome
      let vencimentoUnico = null
      if (criandoNovo) {
        const novoTipo = await criarTipoObrigacaoComEtapas({
          departamentoId, nome: novoNome.trim(), recorrente,
          periodicidade: recorrente ? novaPeriodicidade : null,
          mesVencimento: recorrente ? mesVencimento : null,
          diaVencimento: recorrente ? diaVencimento : null,
          diasLembrete: recorrente ? diasLembrete : null,
          etapas: [{ nome: 'Concluir', prazoDias: recorrente ? 0 : (Number(prazoDias) || 0) }],
        })
        tipoObrigacaoId = novoTipo.id
        nomeTipo = novoTipo.nome
        if (recorrente && diaVencimento) vencimentoUnico = calcularVencimento(competencia, mesVencimento, Number(diaVencimento))
      } else {
        const tipoEscolhido = tipos.find(t => t.id === tipoId)
        if (tipoEscolhido?.dia_vencimento) {
          vencimentoUnico = calcularVencimento(competencia, tipoEscolhido.mes_vencimento || 'mesmo', tipoEscolhido.dia_vencimento)
        }
      }
      await criarObrigacaoComEtapas({
        clienteId: cliente.id, tipoObrigacaoId, departamentoId,
        titulo: nomeTipo || 'Obrigação', competencia, vencimentoUnico,
      })
      onSaved()
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Nova obrigação — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Módulo</label>
          <select value={departamentoId} onChange={e => setDepartamentoId(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
            {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
          </select>
        </div>

        {!criandoNovo && (
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de obrigação</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)} disabled={!departamentoId}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="">{tipos.length ? 'Selecione...' : 'Nenhum tipo cadastrado ainda'}</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}{t.periodicidade ? ` (${t.periodicidade})` : ''}</option>)}
            </select>
            <button onClick={() => setCriandoNovo(true)}
              style={{ marginTop:8, background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>
              <PlusIcon size={11} style={{ verticalAlign:-1, marginRight:4 }} /> Criar tipo novo
            </button>
          </div>
        )}

        {criandoNovo && (
          <div style={{ background:'var(--surface2)', border:'1px dashed var(--border2)', borderRadius:8, padding:10 }}>
            <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do tipo (ex: PGDAS)"
              style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none', marginBottom:8 }} />
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text2)', marginBottom:8 }}>
              <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} /> Recorrente
            </label>
            {recorrente && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Periodicidade</label>
                    <select value={novaPeriodicidade} onChange={e => setNovaPeriodicidade(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Lembrete (dias antes)</label>
                    <input type="number" value={diasLembrete} onChange={e => setDiasLembrete(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                  </div>
                </div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:4 }}>
                  <select value={mesVencimento} onChange={e => setMesVencimento(e.target.value)}
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                    <option value="mesmo">Mês da competência</option>
                    <option value="seguinte">Mês seguinte</option>
                  </select>
                  <input type="number" min={1} max={31} value={diaVencimento} onChange={e => setDiaVencimento(e.target.value)} placeholder="Dia"
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                </div>
              </>
            )}
            {!recorrente && (
              <div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento (dias após início)</label>
                <input type="number" value={prazoDias} onChange={e => setPrazoDias(e.target.value)}
                  style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
              </div>
            )}
            <button onClick={() => setCriandoNovo(false)}
              style={{ marginTop:6, background:'none', border:'none', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>← usar tipo existente</button>
          </div>
        )}

        <div style={{ fontSize:10, color:'var(--text3)' }}>Competência: <strong style={{ color:'var(--text2)' }}>{competencia}</strong></div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!podeSalvar}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!podeSalvar)?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving?'Salvando...':'Salvar'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Nova Tarefa ────────────────────────────────────────────────────────
function NovaTarefaModal({ cliente, dept, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState('')
  const [departamento, setDepartamento] = useState(dept?.nome?.toLowerCase() || 'geral')
  const [prioridade,   setPrioridade]   = useState('normal')
  const [vencimento,   setVencimento]   = useState('')
  const [observacao,   setObservacao]   = useState('')
  const [saving,       setSaving]       = useState(false)

  const handleSave = async () => {
    if (!titulo.trim()) return
    setSaving(true)
    await supabase.from('tarefas').insert({
      titulo: titulo.trim(), departamento, departamento_id: dept?.id || null, prioridade,
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

// ── Modal Tarefas em Lote (por módulo) ───────────────────────────────────────
function ModalTarefasLote({ dept, clientes, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState('')
  const [prioridade,   setPrioridade]   = useState('normal')
  const [vencimento,   setVencimento]   = useState('')
  const [busca,        setBusca]        = useState('')
  const [clientesSel,  setClientesSel]  = useState([])
  const [saving,       setSaving]       = useState(false)
  const [erro,         setErro]         = useState(null)

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const handleSave = async () => {
    if (!titulo.trim() || clientesSel.length === 0) return
    setSaving(true)
    setErro(null)
    try {
      await criarTarefasLote({
        clienteIds: clientesSel, departamentoId: dept.id,
        titulo: titulo.trim(), prioridade, vencimento: vencimento || null,
      })
      onSaved()
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Tarefas em lote — ${dept.icone||''} ${dept.nome}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Título *</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus
            placeholder="Ex: Solicitar documentos do mês"
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Prioridade</label>
            <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
            Empresas ({clientesSel.length}/{clientes.length})
          </span>
          <button onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}
            style={{ background:'none', border:'none', fontSize:11, color:'var(--accent)', cursor:'pointer' }}>
            {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
          </button>
        </div>
        <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
          {clientesFiltrados.map(c => (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <span style={{ fontSize:12, flex:1, color:'var(--text1)' }}>{c.nome}</span>
            </label>
          ))}
        </div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!titulo.trim()||clientesSel.length===0}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!titulo.trim()||clientesSel.length===0)?.6:1 }}>
          {saving?'Criando...':`Criar para ${clientesSel.length} empresa${clientesSel.length!==1?'s':''}`}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Obrigações em Lote (escolha manual de empresas + tipo) ────────────
function ModalObrigacoesLote({ departamentos, clientes, competenciaInicial, onClose, onSaved }) {
  const [departamentoId, setDepartamentoId] = useState(departamentos[0]?.id || '')
  const [tipos,          setTipos]          = useState([])
  const [tipoId,         setTipoId]         = useState('')
  const [criandoNovo,    setCriandoNovo]    = useState(false)
  const [novoNome,       setNovoNome]       = useState('')
  const [novaPeriodicidade, setNovaPeriodicidade] = useState('mensal')
  const [recorrente,     setRecorrente]     = useState(true)
  const [mesVencimento,  setMesVencimento]  = useState('mesmo')
  const [diaVencimento,  setDiaVencimento]  = useState('')
  const [diasLembrete,   setDiasLembrete]   = useState(3)
  const [prazoDias,      setPrazoDias]      = useState(15) // usado só quando não é recorrente
  const [competencia,    setCompetencia]    = useState(competenciaInicial)
  const [busca,          setBusca]          = useState('')
  const [clientesSel,    setClientesSel]    = useState([])
  const [saving,         setSaving]         = useState(false)
  const [erro,           setErro]           = useState(null)

  useEffect(() => {
    if (!departamentoId) { setTipos([]); setTipoId(''); return }
    listarTiposObrigacao(departamentoId).then(setTipos).catch(() => {})
  }, [departamentoId])

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const podeSalvar = departamentoId && clientesSel.length > 0 && (criandoNovo ? novoNome.trim() : tipoId)

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    setErro(null)
    try {
      let tipoObrigacaoId = tipoId
      let nomeTipo = tipos.find(t => t.id === tipoId)?.nome
      let mesVencimentoFinal = null, diaVencimentoFinal = null
      if (criandoNovo) {
        const novoTipo = await criarTipoObrigacaoComEtapas({
          departamentoId, nome: novoNome.trim(), recorrente,
          periodicidade: recorrente ? novaPeriodicidade : null,
          mesVencimento: recorrente ? mesVencimento : null,
          diaVencimento: recorrente ? diaVencimento : null,
          diasLembrete: recorrente ? diasLembrete : null,
          etapas: [{ nome: 'Concluir', prazoDias: recorrente ? 0 : (Number(prazoDias) || 0) }],
        })
        tipoObrigacaoId = novoTipo.id
        nomeTipo = novoTipo.nome
        if (recorrente && diaVencimento) { mesVencimentoFinal = mesVencimento; diaVencimentoFinal = Number(diaVencimento) }
      } else {
        const tipoEscolhido = tipos.find(t => t.id === tipoId)
        if (tipoEscolhido?.dia_vencimento) { mesVencimentoFinal = tipoEscolhido.mes_vencimento || 'mesmo'; diaVencimentoFinal = tipoEscolhido.dia_vencimento }
      }
      const resultado = await criarObrigacoesLote({
        clienteIds: clientesSel, tipoObrigacaoId, departamentoId,
        titulo: nomeTipo || 'Obrigação', competencia,
        mesVencimento: mesVencimentoFinal, diaVencimento: diaVencimentoFinal,
      })
      onSaved(resultado)
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Obrigações em lote">
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Módulo</label>
            <select value={departamentoId} onChange={e => { setDepartamentoId(e.target.value); setTipoId('') }}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Competência</label>
            <input value={competencia} onChange={e => setCompetencia(e.target.value)} placeholder="MM/AAAA"
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
        </div>

        {!criandoNovo && (
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de obrigação</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)} disabled={!departamentoId}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="">{tipos.length ? 'Selecione...' : 'Nenhum tipo cadastrado ainda'}</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}{t.periodicidade ? ` (${t.periodicidade})` : ''}</option>)}
            </select>
            <button onClick={() => setCriandoNovo(true)}
              style={{ marginTop:8, background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>
              <PlusIcon size={11} style={{ verticalAlign:-1, marginRight:4 }} /> Criar tipo novo
            </button>
          </div>
        )}

        {criandoNovo && (
          <div style={{ background:'var(--surface2)', border:'1px dashed var(--border2)', borderRadius:8, padding:10 }}>
            <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do tipo (ex: PGDAS)"
              style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none', marginBottom:8 }} />
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text2)', marginBottom:8 }}>
              <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} /> Recorrente
            </label>
            {recorrente && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Periodicidade</label>
                    <select value={novaPeriodicidade} onChange={e => setNovaPeriodicidade(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Lembrete (dias antes)</label>
                    <input type="number" value={diasLembrete} onChange={e => setDiasLembrete(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                  </div>
                </div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:4 }}>
                  <select value={mesVencimento} onChange={e => setMesVencimento(e.target.value)}
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                    <option value="mesmo">Mês da competência</option>
                    <option value="seguinte">Mês seguinte</option>
                  </select>
                  <input type="number" min={1} max={31} value={diaVencimento} onChange={e => setDiaVencimento(e.target.value)} placeholder="Dia"
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                </div>
              </>
            )}
            {!recorrente && (
              <div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento (dias após início)</label>
                <input type="number" value={prazoDias} onChange={e => setPrazoDias(e.target.value)}
                  style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
              </div>
            )}
            <button onClick={() => setCriandoNovo(false)}
              style={{ marginTop:6, background:'none', border:'none', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>← usar tipo existente</button>
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
            Empresas ({clientesSel.length}/{clientes.length})
          </span>
          <button onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}
            style={{ background:'none', border:'none', fontSize:11, color:'var(--accent)', cursor:'pointer' }}>
            {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
          </button>
        </div>
        <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
          {clientesFiltrados.map(c => (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <span style={{ fontSize:12, flex:1, color:'var(--text1)' }}>{c.nome}</span>
            </label>
          ))}
        </div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!podeSalvar}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!podeSalvar)?.6:1 }}>
          {saving?'Criando...':`Criar para ${clientesSel.length} empresa${clientesSel.length!==1?'s':''}`}
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
