import { useState, useMemo } from 'react'
import { PlusIcon, XIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, ChevronRightIcon, CalendarIcon, CheckIcon, SaveIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue } from '../components/shared'
import { supabase } from '../lib/supabase'

const DEPTS_DEFAULT = ['Fiscal', 'Folha', 'Societário', 'Contábil', 'Escritório']

const DEPT_OBS_MAP = {
  'Fiscal':     ['PGDAS', 'DCTFWeb', 'NFS-e'],
  'Folha':      ['eSocial', 'Folha'],
  'Societário': ['Documentos'],
  'Contábil':   ['Extrato Bancário'],
  'Escritório': ['Parcelamento'],
}

const ALL_TIPOS = ['PGDAS','DCTFWeb','NFS-e','eSocial','Folha','Documentos','Extrato Bancário','Parcelamento']

const STATUS_OBS       = ['pendente','concluido','nao_aplica','vencido']
const STATUS_OBS_LABEL = { pendente:'Pendente', concluido:'Concluído', nao_aplica:'N/A', vencido:'Vencido' }
const STATUS_OBS_COLOR = {
  pendente:   { bg:'rgba(251,191,36,.18)',  color:'#fbbf24' },
  concluido:  { bg:'rgba(52,211,153,.18)',  color:'#34d399' },
  nao_aplica: { bg:'rgba(96,165,250,.18)',  color:'#60a5fa' },
  vencido:    { bg:'rgba(248,113,113,.18)', color:'#f87171' },
}

const DEPTS_LABELS = ['fiscal','folha','societario','contabil','escritorio','geral','pessoal']

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

function getStatusDept(obsEmp, tarefasEmp, dept) {
  const tipos = DEPT_OBS_MAP[dept] || []
  const obs   = obsEmp.filter(o => tipos.includes(o.tipo))
  const tasks = tarefasEmp.filter(t => (t.departamento||'').toLowerCase() === dept.toLowerCase() && !t.concluida)
  if (obs.length === 0 && tasks.length === 0) return { s:'empty', pct:0, val:'—' }
  const ok   = obs.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
  const venc = obs.filter(o => o.status==='vencido').length
  const naAll = obs.length > 0 && obs.every(o => o.status==='nao_aplica')
  if (naAll) return { s:'na', pct:100, val:'N/A' }
  const pct = obs.length > 0 ? Math.round((ok/obs.length)*100) : 0
  const s   = venc > 0 ? 'danger' : pct===100 ? 'ok' : obs.filter(o=>o.status==='pendente').length > 0 ? 'warn' : 'empty'
  return { s, pct, val: obs.length > 0 ? `${ok}/${obs.length}` : tasks.length > 0 ? `${tasks.length}t` : '—' }
}

const S_COLOR = { ok:'#34d399', warn:'#fbbf24', danger:'#f87171', na:'#60a5fa', empty:'#2d3a5a' }
const S_BG    = { ok:'rgba(52,211,153,.08)', warn:'rgba(251,191,36,.08)', danger:'rgba(248,113,113,.08)', na:'rgba(96,165,250,.08)', empty:'transparent' }
const S_ICON  = { ok:CheckCircleIcon, warn:ClockIcon, danger:AlertCircleIcon, na:MinusCircleIcon, empty:null }

const AVATAR_COLORS = [
  ['#1a2e22','#34d399'],['#2a1f10','#fbbf24'],['#18203a','#93c5fd'],
  ['#2a1820','#f9a8d4'],['#1e1a30','#c4b5fd'],['#182828','#5eead4'],
  ['#1a2a1a','#86efac'],['#1e2a2a','#67e8f9'],['#2a1a1a','#fca5a5'],
]

function DeptPill({ data, onClick }) {
  const Icon = S_ICON[data.s]
  return (
    <div onClick={e => { e.stopPropagation(); onClick() }}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'5px 6px',
        borderRadius:8, background:S_BG[data.s], border:'1px solid transparent',
        cursor:'pointer', minWidth:70, transition:'border-color .12s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='#3b82f6'}
      onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
        {Icon && <Icon size={11} color={S_COLOR[data.s]} />}
        <span style={{ fontSize:11, fontWeight:500, color:S_COLOR[data.s] }}>
          {data.s==='empty'?'—':data.s==='na'?'N/A':`${data.pct}%`}
        </span>
      </div>
      <div style={{ width:50, height:3, background:'#232840', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${data.pct}%`, background:S_COLOR[data.s], borderRadius:99 }} />
      </div>
      <span style={{ fontSize:9, color:'#4b5a80' }}>{data.val}</span>
    </div>
  )
}

export default function Empresas() {
  const clientes        = useStore(s => s.clientes)
  const obrigacoes      = useStore(s => s.obrigacoes || [])
  const tarefas         = useStore(s => s.tarefas)
  const fetchObrigacoes = useStore(s => s.fetchObrigacoes)
  const fetchTarefas    = useStore(s => s.fetchTarefas)
  const addTarefa       = useStore(s => s.addTarefa)

  const [compSel,     setCompSel]     = useState(compMesAtras(1))
  const [busca,       setBusca]       = useState('')
  const [filtro,      setFiltro]      = useState('todos')
  const [carteira,    setCarteira]    = useState('todas')
  const [depts,       setDepts]       = useState(DEPTS_DEFAULT)
  const [showAddDept, setShowAddDept] = useState(false)
  const [novoDept,    setNovoDept]    = useState('')
  const [drawer,      setDrawer]      = useState(null) // {c, dept}
  const [drawerTab,   setDrawerTab]   = useState('obrig')
  const [updatingId,  setUpdatingId]  = useState(null)
  const [nomeColW,    setNomeColW]    = useState(200)
  // Modal nova obrigação / nova tarefa
  const [showNovaObs,   setShowNovaObs]   = useState(false)
  const [showNovaTarefa,setShowNovaTarefa] = useState(false)

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
        depts.forEach(d => { deptData[d] = getStatusDept(obsEmp, tasksEmp, d) })
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
  }, [clientes, obrigacoes, tarefas, compSel, busca, depts, filtro, carteira])

  // Drawer: leitura direta do store (sem useMemo) para refletir mudanças imediatas
  const drawerObs = !drawer ? [] : obrigacoes.filter(o => {
    const tipos = drawer.dept ? (DEPT_OBS_MAP[drawer.dept]||[]) : Object.values(DEPT_OBS_MAP).flat()
    return o.cliente_id===drawer.c.id && o.competencia===compSel && tipos.includes(o.tipo)
  })
  const drawerTasks = !drawer ? [] : tarefas.filter(t =>
    t.cliente_id===drawer.c.id &&
    (drawer.dept ? (t.departamento||'').toLowerCase()===drawer.dept.toLowerCase() : true)
  )

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

  const handleAddDept = () => {
    const d = novoDept.trim()
    if (d && !depts.includes(d)) setDepts(p => [...p, d])
    setNovoDept(''); setShowAddDept(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#1a1f2e', overflow:'hidden' }}>

      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'#12151f', borderBottom:'1px solid #1e2438', flexShrink:0, flexWrap:'wrap', rowGap:6 }}>
        <div>
          <h2 style={{ fontSize:14, fontWeight:500, color:'#e2e8f0', margin:0 }}>Empresas</h2>
          <p style={{ fontSize:10, color:'#4b5a80', margin:0 }}>Status por departamento · {rows.length} empresas</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 9px', marginLeft:12 }}>
          <span style={{ fontSize:12, color:'#4b5a80' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa..."
            style={{ background:'none', border:'none', outline:'none', fontSize:11, color:'#94a3b8', width:160 }} />
        </div>
        {carteiras.length > 1 && (
          <select value={carteira} onChange={e => setCarteira(e.target.value)}
            style={{ background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'#94a3b8' }}>
            {carteiras.map(c => <option key={c} value={c}>{c==='todas'?'Todas as carteiras':c}</option>)}
          </select>
        )}
        <div style={{ marginLeft:'auto' }}>
          <select value={compSel} onChange={e => setCompSel(e.target.value)}
            style={{ background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'#94a3b8' }}>
            {[0,1,2,3].map(i => { const c=compMesAtras(i); return <option key={c} value={c}>{i===0?`Atual (${c})`:i===1?`Anterior (${c})`:c}</option> })}
          </select>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:5, padding:'7px 16px', borderBottom:'1px solid #1e2438', flexShrink:0, background:'#151929', alignItems:'center' }}>
        {[['todos','Todos'],['pendentes','Pendentes'],['criticos','Críticos'],['ok','100% ok']].map(([id,lbl]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ background:filtro===id?'#1a2f5e':'#1a2035', border:`1px solid ${filtro===id?'#2563eb':'#232840'}`,
              borderRadius:99, padding:'3px 9px', fontSize:10, color:filtro===id?'#93c5fd':'#4b5a80', cursor:'pointer', fontWeight:500 }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Área principal */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>

        {/* Tabela com scroll — thead sticky funciona quando o scroll está neste div */}
        <div style={{ flex:1, overflow:'auto', padding:'12px 16px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed',
            minWidth: nomeColW + depts.length*110 + 40,
            background:'#1e2540', borderRadius:10, overflow:'hidden' }}>
            <colgroup>
              <col style={{ width:nomeColW }} />
              {depts.map(d => <col key={d} style={{ width:110 }} />)}
              <col style={{ width:34 }} />
            </colgroup>

            <thead>
              <tr style={{ background:'#0f1320' }}>
                <th style={{ padding:'9px 12px', textAlign:'left', fontWeight:500, fontSize:9, color:'#4b5a80',
                  textTransform:'uppercase', letterSpacing:.6, position:'relative',
                  borderBottom:'2px solid #232840', borderRight:'1px solid #232840', userSelect:'none' }}>
                  Empresa
                  <div onMouseDown={handleResizeNome}
                    style={{ position:'absolute', right:0, top:0, bottom:0, width:5, cursor:'col-resize' }} />
                </th>
                {depts.map(d => (
                  <th key={d} style={{ padding:'9px 6px', textAlign:'center', fontWeight:500, fontSize:9,
                    color:'#4b5a80', textTransform:'uppercase', letterSpacing:.5,
                    borderBottom:'2px solid #232840', borderRight:'1px solid #1e2438' }}>
                    {d}
                    <div style={{ fontSize:8, color:'#2d3a5a', marginTop:1, fontWeight:400 }}>
                      {DEPT_OBS_MAP[d]?.length||0} obrig.
                    </div>
                  </th>
                ))}
                <th style={{ padding:'9px 4px', textAlign:'center', borderBottom:'2px solid #232840' }}>
                  <button onClick={() => setShowAddDept(true)}
                    style={{ background:'none', border:'1px dashed #2d3a5a', borderRadius:4, width:18, height:18,
                      color:'#2d3a5a', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                    <PlusIcon size={9} />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={depts.length+2} style={{ padding:40, textAlign:'center', color:'#3d4a6a', fontSize:12 }}>
                  Nenhuma empresa encontrada
                </td></tr>
              )}
              {rows.map(({ c, deptData }, ri) => {
                const [bg, tc] = AVATAR_COLORS[ri % AVATAR_COLORS.length]
                const initials = c.nome.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
                const isSel = drawer?.c?.id === c.id
                const zebra = ri%2===0 ? '#1e2540' : '#192038'
                return (
                  <tr key={c.id}
                    style={{ background: isSel?'#1a2f5e33':zebra, borderBottom:'1px solid #171c2e', cursor:'pointer' }}
                    onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='#243058' }}
                    onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=zebra }}>
                    <td style={{ padding:'8px 12px', borderRight:'1px solid #1a2035' }}
                      onClick={() => openDrawer(c, null)}>
                      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                        <div style={{ width:24, height:24, borderRadius:6, background:bg, color:tc, flexShrink:0,
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:500 }}>
                          {initials}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:500, color:'#dde4f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.nome}</div>
                          <div style={{ fontSize:9, color:'#4b5a80', display:'flex', gap:4, alignItems:'center' }}>
                            {c.regime||'SN'}
                            {c.carteira && <span style={{ background:'rgba(96,165,250,.15)', color:'#60a5fa', borderRadius:99, padding:'0 4px', fontSize:8, fontWeight:600 }}>{c.carteira}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    {depts.map(d => (
                      <td key={d} style={{ padding:'5px 3px', textAlign:'center', borderRight:'1px solid #1a2035' }}>
                        <DeptPill data={deptData[d]} onClick={() => openDrawer(c, d)} />
                      </td>
                    ))}
                    <td style={{ textAlign:'center' }} onClick={() => openDrawer(c, null)}>
                      <ChevronRightIcon size={13} color="#2d3a5a" />
                    </td>
                  </tr>
                )
              })}
            </tbody>

            <tfoot>
              <tr style={{ background:'#0f1320', borderTop:'1px solid #232840' }}>
                <td colSpan={depts.length+2} style={{ padding:'6px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:10, color:'#2d3a5a' }}>{rows.length} empresas</span>
                    <span style={{ fontSize:10, color:'#3b82f6' }}>{compSel}</span>
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
              background:'#12151f', borderLeft:'1px solid #232840', display:'flex', flexDirection:'column',
              boxShadow:'-8px 0 32px rgba(0,0,0,.5)', animation:'sli .2s ease' }}>
              <style>{`@keyframes sli{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

              {/* Header drawer */}
              <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e2438', flexShrink:0, display:'flex', alignItems:'flex-start', gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {drawer.c.nome}
                  </div>
                  <div style={{ fontSize:10, color:'#4b5a80', marginTop:2 }}>{drawer.dept||'Todos os departamentos'} · {compSel}</div>
                </div>
                <button onClick={() => setDrawer(null)}
                  style={{ background:'#1e2540', border:'1px solid #232840', borderRadius:6, width:24, height:24,
                    display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#7b8abf', flexShrink:0 }}>
                  <XIcon size={13} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display:'flex', borderBottom:'1px solid #1e2438', flexShrink:0 }}>
                {[['obrig',`Obrigações (${drawerObs.length})`],['tarefas',`Tarefas (${drawerTasks.length})`]].map(([id,lbl]) => (
                  <button key={id} onClick={() => setDrawerTab(id)}
                    style={{ flex:1, padding:'8px', fontSize:11, fontWeight:500, border:'none', background:'none', cursor:'pointer',
                      borderBottom:`2px solid ${drawerTab===id?'#3b82f6':'transparent'}`,
                      color:drawerTab===id?'#60a5fa':'#4b5a80' }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:7 }}>

                {/* ── Obrigações ── */}
                {drawerTab === 'obrig' && <>
                  {drawerObs.length === 0 && (
                    <div style={{ textAlign:'center', color:'#3d4a6a', fontSize:12, padding:'24px 0' }}>Sem obrigações registradas</div>
                  )}
                  {drawerObs.map(o => {
                    const cfg = STATUS_OBS_COLOR[o.status] || STATUS_OBS_COLOR.pendente
                    const busy = updatingId === o.id
                    return (
                      <div key={o.id} style={{ background:'#1a2035', border:'1px solid #1e2438', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom: o.vencimento ? 6 : 0 }}>
                          <span style={{ fontSize:12, fontWeight:500, color:'#dde4f0' }}>{o.tipo}</span>
                          {/* Select de status — controlado pelo valor do store */}
                          <select
                            value={o.status || 'pendente'}
                            disabled={busy}
                            onChange={e => handleStatusObs(o.id, e.target.value)}
                            style={{ background:cfg.bg, border:`1px solid ${cfg.color}55`, borderRadius:99,
                              padding:'3px 8px', fontSize:9, color:cfg.color, fontWeight:600,
                              cursor:'pointer', outline:'none', opacity:busy?.6:1,
                              appearance:'none', WebkitAppearance:'none' }}>
                            {STATUS_OBS.map(s => (
                              <option key={s} value={s} style={{ background:'#1a2035', color:'#e2e8f0' }}>
                                {STATUS_OBS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {o.vencimento && (
                          <div style={{ fontSize:10, color:o.status==='vencido'?'#f87171':'#4b5a80', display:'flex', alignItems:'center', gap:4 }}>
                            <CalendarIcon size={9} />
                            {o.status==='vencido'?'⚠ ':''}Venc. {new Date(o.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>}

                {/* ── Tarefas ── */}
                {drawerTab === 'tarefas' && <>
                  {drawerTasks.length === 0 && (
                    <div style={{ textAlign:'center', color:'#3d4a6a', fontSize:12, padding:'24px 0' }}>Sem tarefas</div>
                  )}
                  {drawerTasks.map(t => {
                    const overdue = isOverdue(t.vencimento) && !t.concluida
                    const busy = updatingId === t.id
                    return (
                      <div key={t.id} style={{ background:'#1a2035', border:'1px solid #1e2438', borderRadius:8, padding:'10px 12px' }}>
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
                              color:t.concluida?'#4b5a80':'#dde4f0',
                              textDecoration:t.concluida?'line-through':'none' }}>
                              <PriDot pri={t.prioridade} /> {t.titulo}
                            </div>
                            <div style={{ display:'flex', gap:5, alignItems:'center', marginTop:3, flexWrap:'wrap' }}>
                              <DeptChip dept={t.departamento} />
                              {t.vencimento && (
                                <span style={{ fontSize:10, color:overdue?'#f87171':'#4b5a80', display:'flex', alignItems:'center', gap:2 }}>
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
              <div style={{ padding:'10px 14px', borderTop:'1px solid #1e2438', flexShrink:0, display:'flex', gap:7 }}>
                <button onClick={() => { setShowNovaObs(true) }}
                  style={{ flex:1, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'7px', fontSize:11, color:'#7b8abf', fontWeight:500, cursor:'pointer' }}>
                  + Obrigação
                </button>
                <button onClick={() => { setShowNovaTarefa(true) }}
                  style={{ flex:1, background:'#1a2f5e', border:'1px solid #2563eb', borderRadius:8, padding:'7px', fontSize:11, color:'#93c5fd', fontWeight:500, cursor:'pointer' }}>
                  + Tarefa
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal add departamento */}
      {showAddDept && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowAddDept(false)}>
          <div style={{ background:'#1e2540', border:'1px solid #2a3158', borderRadius:12, padding:20, width:300 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:13, fontWeight:500, color:'#e2e8f0', marginBottom:12 }}>Novo departamento</div>
            <input value={novoDept} onChange={e => setNovoDept(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleAddDept()} autoFocus
              placeholder="Ex: Pessoal, Fiscal Estadual..."
              style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', marginBottom:12, outline:'none' }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setShowAddDept(false)}
                style={{ flex:1, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'8px', fontSize:12, color:'#7b8abf', cursor:'pointer' }}>Cancelar</button>
              <button onClick={handleAddDept}
                style={{ flex:1, background:'#2563eb', border:'none', borderRadius:8, padding:'8px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer' }}>Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nova obrigação */}
      {showNovaObs && drawer && (
        <NovaObrigacaoModal
          cliente={drawer.c}
          dept={drawer.dept}
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
    </div>
  )
}

// ── Modal Nova Obrigação ─────────────────────────────────────────────────────
function NovaObrigacaoModal({ cliente, dept, competencia, onClose, onSaved }) {
  const tiposDisponiveis = dept ? (DEPT_OBS_MAP[dept] || ALL_TIPOS) : ALL_TIPOS
  const [tipo,       setTipo]       = useState(tiposDisponiveis[0] || '')
  const [status,     setStatus]     = useState('pendente')
  const [vencimento, setVencimento] = useState('')
  const [saving,     setSaving]     = useState(false)

  const handleSave = async () => {
    if (!tipo) return
    setSaving(true)
    await supabase.from('obrigacoes').upsert({
      cliente_id: cliente.id, tipo, status, competencia,
      vencimento: vencimento || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cliente_id,tipo,competencia' })
    setSaving(false)
    onSaved()
  }

  return (
    <ModalBase onClose={onClose} titulo={`Nova obrigação — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }}>
            {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Status inicial</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }}>
            {STATUS_OBS.map(s => <option key={s} value={s}>{STATUS_OBS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Vencimento</label>
          <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }} />
        </div>
        <div style={{ fontSize:10, color:'#4b5a80' }}>Competência: <strong style={{ color:'#7b8abf' }}>{competencia}</strong></div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'#7b8abf', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!tipo}
          style={{ flex:1, background:'#2563eb', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:saving?.6:1 }}>
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
  const [departamento, setDepartamento] = useState(dept?.toLowerCase() || 'geral')
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
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Título *</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus
            placeholder="Descreva a tarefa..."
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Departamento</label>
            <select value={departamento} onChange={e => setDepartamento(e.target.value)}
              style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }}>
              {['fiscal','folha','societario','contabil','escritorio','geral','pessoal'].map(d => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase()+d.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Prioridade</label>
            <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
              style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
        </div>
        <div>
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Vencimento</label>
          <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none' }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'#7b8abf', display:'block', marginBottom:4 }}>Observações</label>
          <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
            placeholder="Detalhes adicionais..."
            style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        </div>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'#7b8abf', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!titulo.trim()}
          style={{ flex:1, background:'#2563eb', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!titulo.trim())?.6:1 }}>
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.65)', zIndex:2000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'#1e2540', border:'1px solid #2a3158', borderRadius:12, padding:20,
        width:'100%', maxWidth:400, maxHeight:'90vh', overflowY:'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#e2e8f0' }}>{titulo}</span>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'#7b8abf', cursor:'pointer', fontSize:18, lineHeight:1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
