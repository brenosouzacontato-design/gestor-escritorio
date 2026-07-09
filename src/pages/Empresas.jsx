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
  pendente:   { bg:'rgba(154,107,26,.12)',  color:'#9A6B1A' },
  concluido:  { bg:'rgba(42,122,90,.12)',   color:'#2A7A5A' },
  nao_aplica: { bg:'rgba(30,95,160,.12)',   color:'#1E5FA0' },
  vencido:    { bg:'rgba(168,48,48,.12)',   color:'#A83030' },
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

const S_COLOR = { ok:'#2A7A5A', warn:'#9A6B1A', danger:'#A83030', na:'#1E5FA0', empty:'#8A8F9E' }
const S_BG    = { ok:'rgba(42,122,90,.10)', warn:'rgba(154,107,26,.10)', danger:'rgba(168,48,48,.10)', na:'rgba(30,95,160,.10)', empty:'var(--surface2)' }
const S_ICON  = { ok:CheckCircleIcon, warn:ClockIcon, danger:AlertCircleIcon, na:MinusCircleIcon, empty:null }

const AVATAR_COLORS = [
  ['#1a2e22','#34d399'],['#2a1f10','#fbbf24'],['#18203a','var(--accent)'],
  ['#2a1820','#f9a8d4'],['#1e1a30','#c4b5fd'],['#182828','#5eead4'],
  ['#1a2a1a','#86efac'],['#1e2a2a','#67e8f9'],['#2a1a1a','#fca5a5'],
]

function DeptPill({ data, onClick }) {
  const Icon = S_ICON[data.s]
  return (
    <div onClick={e => { e.stopPropagation(); onClick() }}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'7px 8px',
        borderRadius:9, background:S_BG[data.s], border:'1px solid transparent',
        cursor:'pointer', minWidth:80, transition:'border-color .12s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
      onMouseLeave={e => e.currentTarget.style.borderColor='transparent'}>
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        {Icon && <Icon size={14} color={S_COLOR[data.s]} />}
        <span style={{ fontSize:13, fontWeight:600, color:S_COLOR[data.s] }}>
          {data.s==='empty'?'—':data.s==='na'?'N/A':`${data.pct}%`}
        </span>
      </div>
      <div style={{ width:56, height:4, background:'var(--border)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${data.pct}%`, background:S_COLOR[data.s], borderRadius:99 }} />
      </div>
      <span style={{ fontSize:10, color:'var(--text3)', fontWeight:500 }}>{data.val}</span>
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
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', overflow:'hidden' }}>

      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap', rowGap:6 }}>
        <div>
          <h2 style={{ fontSize:14, fontWeight:500, color:'var(--text1)', margin:0 }}>Empresas</h2>
          <p style={{ fontSize:10, color:'var(--text3)', margin:0 }}>Status por departamento · {rows.length} empresas</p>
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
      </div>

      {/* Área principal */}
      <div style={{ flex:1, overflow:'hidden', position:'relative', display:'flex' }}>

        {/* Scroll container — sticky funciona aqui */}
        <div style={{ flex:1, overflow:'auto', padding:'12px 16px' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed',
            minWidth: nomeColW + 120 + depts.length*120 + 40,
            background:'var(--surface)' }}>
            <colgroup>
              <col style={{ width:nomeColW }} />
              <col style={{ width:120 }} /> {/* Resumo */}
              {depts.map(d => <col key={d} style={{ width:120 }} />)}
              <col style={{ width:38 }} />
            </colgroup>

            <thead style={{ position:'sticky', top:0, zIndex:5 }}>
              <tr style={{ background:'#1B2B4B' }}>
                {/* Empresa */}
                <th style={{ padding:'10px 14px', textAlign:'left', fontWeight:600, fontSize:11, color:'#8fadd4',
                  textTransform:'uppercase', letterSpacing:.6, position:'relative',
                  borderBottom:'2px solid #243660', borderRight:'1px solid #243660', userSelect:'none' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:6 }}>🏢 Empresa</span>
                  <div onMouseDown={handleResizeNome}
                    style={{ position:'absolute', right:0, top:0, bottom:0, width:5, cursor:'col-resize' }} />
                </th>
                {/* Resumo — primeira coluna de dept */}
                <th style={{ padding:'10px 8px', textAlign:'center', fontWeight:600, fontSize:11,
                  color:'#fbbf24', textTransform:'uppercase', letterSpacing:.5,
                  borderBottom:'2px solid #243660', borderRight:'2px solid #3b5280', background:'#162240' }}>
                  <div style={{ fontSize:16, marginBottom:3 }}>📊</div>
                  <div>Resumo</div>
                  <div style={{ fontSize:9, color:'#6B80A8', marginTop:1, fontWeight:400 }}>geral</div>
                </th>
                {depts.map(d => {
                  const icons = { 'Fiscal':'🧾','Folha':'👥','Societário':'💼','Contábil':'🧮','Escritório':'🏠' }
                  return (
                    <th key={d} style={{ padding:'10px 8px', textAlign:'center', fontWeight:600, fontSize:11,
                      color:'#8fadd4', textTransform:'uppercase', letterSpacing:.5,
                      borderBottom:'2px solid #243660', borderRight:'1px solid #243660' }}>
                      <div style={{ fontSize:16, marginBottom:3 }}>{icons[d]||'📋'}</div>
                      <div>{d}</div>
                      <div style={{ fontSize:9, color:'#6B80A8', marginTop:1, fontWeight:400 }}>
                        {DEPT_OBS_MAP[d]?.length||0} obrig.
                      </div>
                    </th>
                  )
                })}
                <th style={{ padding:'10px 4px', textAlign:'center', borderBottom:'2px solid #243660' }}>
                  <button onClick={() => setShowAddDept(true)}
                    style={{ background:'none', border:'1px dashed #3b5280', borderRadius:4, width:20, height:20,
                      color:'#6B80A8', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                    <PlusIcon size={11} />
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={depts.length+3} style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13 }}>
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
                const resOk   = obsTotal.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
                const resVenc = obsTotal.filter(o => o.status==='vencido').length
                const resPend = obsTotal.filter(o => o.status==='pendente').length
                const resPct  = obsTotal.length > 0 ? Math.round((resOk/obsTotal.length)*100) : 0
                const resS    = resVenc > 0 ? 'danger' : resPct===100 ? 'ok' : resPend > 0 ? 'warn' : 'empty'
                const resumo  = { s: resS, pct: resPct, val: obsTotal.length > 0 ? `${resOk}/${obsTotal.length}` : '—' }

                return (
                  <tr key={c.id}
                    style={{ background: isSel?'rgba(30,95,160,.08)':zebra, borderBottom:'1px solid var(--border)', cursor:'pointer' }}
                    onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='var(--sand-dim)' }}
                    onMouseLeave={e => { if(!isSel) e.currentTarget.style.background=zebra }}>

                    {/* Empresa */}
                    <td style={{ padding:'10px 14px', borderRight:'1px solid var(--border)' }}
                      onClick={() => openDrawer(c, null)}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:28, height:28, borderRadius:7, background:bg, color:tc, flexShrink:0,
                          display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:600 }}>
                          {initials}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--text1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.nome}</div>
                          <div style={{ fontSize:10, color:'var(--text3)', display:'flex', gap:4, alignItems:'center', marginTop:1 }}>
                            {c.regime||'SN'}
                            {c.carteira && <span style={{ background:'rgba(30,95,160,.12)', color:'var(--accent)', borderRadius:99, padding:'0 5px', fontSize:9, fontWeight:600 }}>{c.carteira}</span>}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Resumo geral */}
                    <td style={{ padding:'6px 4px', textAlign:'center', borderRight:'2px solid var(--border)', background: isSel?'rgba(30,95,160,.05)': ri%2===0?'rgba(27,43,75,.03)':'rgba(27,43,75,.06)' }}
                      onClick={() => openDrawer(c, null)}>
                      <DeptPill data={resumo} onClick={() => openDrawer(c, null)} />
                    </td>

                    {/* Departamentos */}
                    {depts.map(d => (
                      <td key={d} style={{ padding:'6px 4px', textAlign:'center', borderRight:'1px solid var(--border)' }}>
                        <DeptPill data={deptData[d]} onClick={() => openDrawer(c, d)} />
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
                <td colSpan={depts.length+3} style={{ padding:'7px 14px' }}>
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
                  <div style={{ fontSize:10, color:'#8fadd4', marginTop:2 }}>{drawer.dept||'Todos os departamentos'} · {compSel}</div>
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
                    return (
                      <div key={o.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom: o.vencimento ? 6 : 0 }}>
                          <span style={{ fontSize:12, fontWeight:500, color:'var(--text1)' }}>{o.tipo}</span>
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
                          <div style={{ fontSize:10, color:o.status==='vencido'?'#f87171':'var(--text3)', display:'flex', alignItems:'center', gap:4 }}>
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
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid #232840', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!tipo}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:saving?.6:1 }}>
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
