import { useState, useMemo } from 'react'
import { PlusIcon, XIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, ChevronRightIcon, CalendarIcon, CheckIcon } from 'lucide-react'
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

const STATUS_OBS = ['pendente','concluido','nao_aplica','vencido']
const STATUS_OBS_LABEL = { pendente:'Pendente', concluido:'Concluído', nao_aplica:'N/A', vencido:'Vencido' }
const STATUS_OBS_COLOR = {
  pendente:   { bg:'rgba(251,191,36,.15)',  color:'#fbbf24' },
  concluido:  { bg:'rgba(52,211,153,.15)',  color:'#34d399' },
  nao_aplica: { bg:'rgba(96,165,250,.15)',  color:'#60a5fa' },
  vencido:    { bg:'rgba(248,113,113,.15)', color:'#f87171' },
}

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

function getStatusDept(obsEmp, tarefasEmp, dept) {
  const tipos = DEPT_OBS_MAP[dept] || []
  const obs  = obsEmp.filter(o => tipos.includes(o.tipo))
  const tasks = tarefasEmp.filter(t => (t.departamento || '').toLowerCase() === dept.toLowerCase() && !t.concluida)
  if (obs.length === 0 && tasks.length === 0) return { s:'empty', pct:0, val:'—', obs:[], tasks }
  const ok   = obs.filter(o => o.status === 'concluido' || o.status === 'nao_aplica').length
  const venc = obs.filter(o => o.status === 'vencido').length
  const pend = obs.filter(o => o.status === 'pendente').length
  const naAll = obs.length > 0 && obs.every(o => o.status === 'nao_aplica')
  if (naAll) return { s:'na', pct:100, val:'N/A', obs, tasks }
  const pct = obs.length > 0 ? Math.round((ok / obs.length) * 100) : 0
  const s   = venc > 0 ? 'danger' : pct === 100 ? 'ok' : pend > 0 ? 'warn' : 'empty'
  return { s, pct, val: obs.length > 0 ? `${ok}/${obs.length}` : `${tasks.length}t`, obs, tasks }
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
    <div onClick={onClick}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'5px 6px',
        borderRadius:8, background:S_BG[data.s], border:'1px solid transparent',
        cursor:'pointer', minWidth:70, transition:'border-color .15s' }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
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

export default function Empresas({ onOpenTarefas }) {
  const clientes      = useStore(s => s.clientes)
  const obrigacoes    = useStore(s => s.obrigacoes || [])
  const tarefas       = useStore(s => s.tarefas)
  const upsertObrigacao = useStore(s => s.upsertObrigacao)
  const toggleTarefa    = useStore(s => s.toggleTarefa)

  const [compSel,      setCompSel]      = useState(compMesAtras(1))
  const [busca,        setBusca]        = useState('')
  const [filtro,       setFiltro]       = useState('todos')
  const [carteira,     setCarteira]     = useState('todas')
  const [depts,        setDepts]        = useState(DEPTS_DEFAULT)
  const [showAddDept,  setShowAddDept]  = useState(false)
  const [novoDept,     setNovoDept]     = useState('')
  const [drawer,       setDrawer]       = useState(null)
  const [drawerTab,    setDrawerTab]    = useState('obrig')
  const [updatingId,   setUpdatingId]   = useState(null)
  const [nomeColW,     setNomeColW]     = useState(200)

  // Carteiras únicas dos clientes
  const carteiras = useMemo(() => {
    const set = new Set(clientes.map(c => c.carteira).filter(Boolean))
    return ['todas', ...Array.from(set).sort()]
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
        const obsEmp   = obrigacoes.filter(o => o.cliente_id === c.id && o.competencia === compSel)
        const tasksEmp = tarefas.filter(t => t.cliente_id === c.id)
        const deptData = {}
        depts.forEach(d => { deptData[d] = getStatusDept(obsEmp, tasksEmp, d) })
        const hasDanger = Object.values(deptData).some(d => d.s === 'danger')
        const hasPend   = Object.values(deptData).some(d => d.s === 'warn')
        const allOk     = Object.values(deptData).every(d => d.s === 'ok' || d.s === 'na' || d.s === 'empty')
        return { c, deptData, hasDanger, hasPend, allOk }
      })
      .filter(r => {
        if (filtro === 'criticos')  return r.hasDanger
        if (filtro === 'pendentes') return r.hasPend || r.hasDanger
        if (filtro === 'ok')        return r.allOk
        return true
      })
  }, [clientes, obrigacoes, tarefas, compSel, busca, depts, filtro, carteira])

  const drawerObs = useMemo(() => {
    if (!drawer) return []
    const tipos = drawer.dept ? (DEPT_OBS_MAP[drawer.dept] || []) : Object.values(DEPT_OBS_MAP).flat()
    return obrigacoes.filter(o =>
      o.cliente_id === drawer.c.id &&
      o.competencia === compSel &&
      (drawer.dept ? tipos.includes(o.tipo) : true)
    )
  }, [drawer, obrigacoes, compSel])

  const drawerTasks = useMemo(() => {
    if (!drawer) return []
    return tarefas.filter(t =>
      t.cliente_id === drawer.c.id &&
      (drawer.dept ? (t.departamento || '').toLowerCase() === drawer.dept.toLowerCase() : true)
    )
  }, [drawer, tarefas])

  const openDrawer = (c, dept) => { setDrawer({ c, dept }); setDrawerTab('obrig') }

  const handleResizeNome = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = nomeColW
    const onMove = (ev) => setNomeColW(Math.max(120, Math.min(400, startW + ev.clientX - startX)))
    const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleStatusObs = async (obs, novoStatus) => {
    setUpdatingId(obs.id)
    await upsertObrigacao({ ...obs, status: novoStatus })
    setUpdatingId(null)
  }

  const handleToggleTask = async (taskId) => {
    setUpdatingId(taskId)
    await toggleTarefa(taskId)
    setUpdatingId(null)
  }

  const handleAddDept = () => {
    const d = novoDept.trim()
    if (d && !depts.includes(d)) setDepts(prev => [...prev, d])
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

        {/* Busca */}
        <div style={{ display:'flex', alignItems:'center', gap:5, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 9px', marginLeft:12 }}>
          <span style={{ fontSize:12, color:'#4b5a80' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa..."
            style={{ background:'none', border:'none', outline:'none', fontSize:11, color:'#94a3b8', width:160 }} />
        </div>

        {/* Carteira */}
        {carteiras.length > 1 && (
          <select value={carteira} onChange={e => setCarteira(e.target.value)}
            style={{ background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'#94a3b8' }}>
            {carteiras.map(c => <option key={c} value={c}>{c === 'todas' ? 'Todas as carteiras' : c}</option>)}
          </select>
        )}

        <div style={{ display:'flex', gap:6, marginLeft:'auto', alignItems:'center' }}>
          <select value={compSel} onChange={e => setCompSel(e.target.value)}
            style={{ background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'5px 8px', fontSize:11, color:'#94a3b8' }}>
            {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{i===0?`Atual (${c})`:i===1?`Anterior (${c})`:c}</option> })}
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

        {/* Tabela — ocupa tudo, drawer sobrepõe */}
        <div style={{ flex:1, overflowY:'auto', overflowX:'auto', padding:'12px 16px' }}>
          <div style={{ background:'#1e2540', border:'1px solid #232840', borderRadius:10, overflow:'auto', minWidth: nomeColW + depts.length * 100 + 40 }}>

            {/* Header — sticky */}
            <div style={{ display:'grid', gridTemplateColumns:`${nomeColW}px repeat(${depts.length}, minmax(90px,120px)) 34px`,
              background:'#12151f', borderBottom:'1px solid #232840',
              position:'sticky', top:0, zIndex:5 }}>
              <div style={{ padding:'8px 12px', display:'flex', alignItems:'center', gap:0, position:'relative' }}>
                <span style={{ fontSize:9, fontWeight:500, color:'#3d4a6a', textTransform:'uppercase', letterSpacing:.5 }}>Empresa</span>
                {/* Handle de resize */}
                <div onMouseDown={handleResizeNome}
                  style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ width:2, height:14, background:'#2a3158', borderRadius:1 }} />
                </div>
              </div>
              {depts.map(d => (
                <div key={d} style={{ padding:'8px 6px', textAlign:'center' }}>
                  <div style={{ fontSize:9, fontWeight:500, color:'#3d4a6a', textTransform:'uppercase', letterSpacing:.5 }}>{d}</div>
                  <div style={{ fontSize:9, color:'#2d3a5a', marginTop:2 }}>{DEPT_OBS_MAP[d]?.length || 0} obrig.</div>
                </div>
              ))}
              <div style={{ padding:'8px 4px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <button onClick={() => setShowAddDept(true)} title="Adicionar departamento"
                  style={{ background:'none', border:'1px dashed #2d3a5a', borderRadius:5, width:20, height:20, color:'#2d3a5a', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <PlusIcon size={10} />
                </button>
              </div>
            </div>

            {/* Linhas */}
            {rows.length === 0 && (
              <div style={{ padding:40, textAlign:'center', color:'#3d4a6a', fontSize:12 }}>Nenhuma empresa encontrada</div>
            )}
            {rows.map(({ c, deptData }, ri) => {
              const [bg, tc] = AVATAR_COLORS[ri % AVATAR_COLORS.length]
              const initials = c.nome.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase()
              const isSel = drawer?.c?.id === c.id
              return (
                <div key={c.id}
                  style={{ display:'grid', gridTemplateColumns:`${nomeColW}px repeat(${depts.length}, minmax(90px,120px)) 34px`,
                    borderBottom:'1px solid #171c2e', background: isSel ? '#1a2f5e22' : 'transparent', transition:'background .1s' }}
                  onMouseEnter={e => { if(!isSel) e.currentTarget.style.background='#1a2035' }}
                  onMouseLeave={e => { if(!isSel) e.currentTarget.style.background='transparent' }}>

                  {/* Empresa */}
                  <div style={{ padding:'8px 12px', display:'flex', alignItems:'center', gap:7, cursor:'pointer' }}
                    onClick={() => openDrawer(c, null)}>
                    <div style={{ width:24, height:24, borderRadius:6, background:bg, color:tc, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:500, flexShrink:0 }}>
                      {initials}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:500, color:'#dde4f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {c.nome.split(' ').slice(0,3).join(' ')}
                      </div>
                      <div style={{ fontSize:9, color:'#4b5a80', display:'flex', gap:4 }}>
                        {c.regime || 'SN'}
                        {c.carteira && <span style={{ background:'rgba(96,165,250,.15)', color:'#60a5fa', borderRadius:99, padding:'0 4px', fontSize:8, fontWeight:600 }}>{c.carteira}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Departamentos */}
                  {depts.map(d => (
                    <div key={d} style={{ padding:'5px 3px', display:'flex', alignItems:'center', justifyContent:'center', borderLeft:'1px solid #171c2e' }}
                      onClick={() => openDrawer(c, d)}>
                      <DeptPill data={deptData[d]} onClick={() => {}} />
                    </div>
                  ))}

                  {/* Ação */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderLeft:'1px solid #171c2e', cursor:'pointer' }}
                    onClick={() => openDrawer(c, null)}>
                    <ChevronRightIcon size={13} color="#2d3a5a" />
                  </div>
                </div>
              )
            })}

            <div style={{ padding:'7px 12px', borderTop:'1px solid #232840', display:'flex', justifyContent:'space-between', background:'#12151f' }}>
              <span style={{ fontSize:10, color:'#2d3a5a' }}>{rows.length} empresas</span>
              <span style={{ fontSize:10, color:'#3b82f6' }}>{compSel}</span>
            </div>
          </div>
        </div>

        {/* Drawer — sobrepõe sem comprimir */}
        {drawer && (
          <>
            {/* Overlay clicável para fechar */}
            <div style={{ position:'absolute', inset:0, zIndex:9 }} onClick={() => setDrawer(null)} />
            <div style={{ position:'absolute', top:0, right:0, bottom:0, width:340, zIndex:10,
              background:'#12151f', borderLeft:'1px solid #232840', display:'flex', flexDirection:'column',
              boxShadow:'-8px 0 32px rgba(0,0,0,.4)', animation:'slideIn .2s ease' }}>
              <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

              {/* Header */}
              <div style={{ padding:'12px 14px', borderBottom:'1px solid #1e2438', flexShrink:0, display:'flex', alignItems:'flex-start', gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {drawer.c.nome.split(' ').slice(0,3).join(' ')}
                  </div>
                  <div style={{ fontSize:10, color:'#4b5a80', marginTop:2 }}>
                    {drawer.dept || 'Todos os departamentos'} · {compSel}
                  </div>
                </div>
                <button onClick={() => setDrawer(null)}
                  style={{ background:'#1e2540', border:'1px solid #232840', borderRadius:6, width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#7b8abf', flexShrink:0 }}>
                  <XIcon size={13} />
                </button>
              </div>

              {/* Tabs */}
              <div style={{ display:'flex', borderBottom:'1px solid #1e2438', flexShrink:0 }}>
                {[['obrig',`Obrigações (${drawerObs.length})`],['tarefas',`Tarefas (${drawerTasks.length})`]].map(([id,lbl]) => (
                  <button key={id} onClick={() => setDrawerTab(id)}
                    style={{ flex:1, padding:'7px', fontSize:11, fontWeight:500, border:'none', background:'none', cursor:'pointer',
                      borderBottom:`2px solid ${drawerTab===id?'#3b82f6':'transparent'}`,
                      color:drawerTab===id?'#60a5fa':'#4b5a80' }}>
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:7 }}>

                {/* Obrigações */}
                {drawerTab === 'obrig' && (
                  <>
                    {drawerObs.length === 0 && (
                      <div style={{ textAlign:'center', color:'#3d4a6a', fontSize:12, padding:'30px 0' }}>Sem obrigações registradas</div>
                    )}
                    {drawerObs.map(o => {
                      const cfg = STATUS_OBS_COLOR[o.status] || STATUS_OBS_COLOR.pendente
                      return (
                        <div key={o.id} style={{ background:'#1a2035', border:'1px solid #1e2438', borderRadius:8, padding:'10px 12px' }}>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom:6 }}>
                            <span style={{ fontSize:12, fontWeight:500, color:'#dde4f0' }}>{o.tipo}</span>
                            {/* Dropdown de status inline */}
                            <select
                              value={o.status}
                              disabled={updatingId === o.id}
                              onChange={e => handleStatusObs(o, e.target.value)}
                              style={{ background:cfg.bg, border:`1px solid ${cfg.color}44`, borderRadius:99, padding:'2px 7px',
                                fontSize:9, color:cfg.color, fontWeight:600, cursor:'pointer', outline:'none',
                                opacity: updatingId === o.id ? .5 : 1 }}>
                              {STATUS_OBS.map(s => (
                                <option key={s} value={s} style={{ background:'#1a2035', color:'#dde4f0' }}>{STATUS_OBS_LABEL[s]}</option>
                              ))}
                            </select>
                          </div>
                          {o.vencimento && (
                            <div style={{ fontSize:10, color: o.status==='vencido' ? '#f87171' : '#4b5a80', display:'flex', alignItems:'center', gap:4 }}>
                              <CalendarIcon size={9} />
                              {o.status==='vencido' ? '⚠ ' : ''}Venc. {new Date(o.vencimento+'T12:00:00').toLocaleDateString('pt-BR')}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}

                {/* Tarefas */}
                {drawerTab === 'tarefas' && (
                  <>
                    {drawerTasks.length === 0 && (
                      <div style={{ textAlign:'center', color:'#3d4a6a', fontSize:12, padding:'30px 0' }}>Sem tarefas</div>
                    )}
                    {drawerTasks.map(t => {
                      const overdue = isOverdue(t.vencimento) && !t.concluida
                      const loading = updatingId === t.id
                      return (
                        <div key={t.id} style={{ background:'#1a2035', border:'1px solid #1e2438', borderRadius:8, padding:'10px 12px' }}>
                          <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:5 }}>
                            {/* Checkbox toggle */}
                            <button
                              onClick={() => handleToggleTask(t.id)}
                              disabled={loading}
                              style={{ width:16, height:16, borderRadius:4, border:`1px solid ${t.concluida?'#34d399':'#3b4570'}`,
                                background: t.concluida ? '#34d399' : 'transparent', flexShrink:0, marginTop:1,
                                display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
                                opacity: loading ? .5 : 1 }}>
                              {t.concluida && <CheckIcon size={10} color="#12151f" strokeWidth={3} />}
                            </button>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:11, fontWeight:500, color: t.concluida ? '#4b5a80' : '#dde4f0',
                                textDecoration: t.concluida ? 'line-through' : 'none', lineHeight:1.4 }}>
                                <PriDot pri={t.prioridade} /> {t.titulo}
                              </div>
                            </div>
                          </div>
                          <div style={{ display:'flex', gap:5, alignItems:'center', fontSize:10, color:'#4b5a80', flexWrap:'wrap', paddingLeft:24 }}>
                            <DeptChip dept={t.departamento} />
                            {t.vencimento && (
                              <span style={{ color: overdue ? '#f87171' : '#4b5a80', display:'flex', alignItems:'center', gap:2 }}>
                                <CalendarIcon size={9} />{overdue?'⚠ ':''}{fmtDate(t.vencimento)}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding:'10px 14px', borderTop:'1px solid #1e2438', flexShrink:0 }}>
                <button style={{ width:'100%', background:'#1a2f5e', border:'1px solid #2563eb', borderRadius:8, padding:'8px', fontSize:11, color:'#93c5fd', fontWeight:500, cursor:'pointer' }}>
                  + Adicionar neste departamento
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal add dept */}
      {showAddDept && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowAddDept(false)}>
          <div style={{ background:'#1e2540', border:'1px solid #2a3158', borderRadius:12, padding:20, width:300 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:13, fontWeight:500, color:'#e2e8f0', marginBottom:12 }}>Novo departamento</div>
            <input value={novoDept} onChange={e => setNovoDept(e.target.value)}
              onKeyDown={e => e.key==='Enter' && handleAddDept()}
              autoFocus
              placeholder="Ex: Pessoal, Fiscal Estadual..."
              style={{ width:'100%', background:'#151929', border:'1px solid #232840', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#e2e8f0', marginBottom:12, outline:'none' }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setShowAddDept(false)}
                style={{ flex:1, background:'#1a2035', border:'1px solid #232840', borderRadius:8, padding:'8px', fontSize:12, color:'#7b8abf', cursor:'pointer' }}>
                Cancelar
              </button>
              <button onClick={handleAddDept}
                style={{ flex:1, background:'#2563eb', border:'none', borderRadius:8, padding:'8px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer' }}>
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
