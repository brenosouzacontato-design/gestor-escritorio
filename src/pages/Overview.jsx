import { useState, useMemo } from 'react'
import { CheckIcon, ClipboardListIcon, AlertCircleIcon, TrendingUpIcon, UsersIcon,
  CheckSquareIcon, ZapIcon, ChevronRightIcon, CalendarIcon, CheckCircleIcon,
  ClockIcon, MinusCircleIcon, BarChart2Icon, LayersIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, PriDot, fmtDate, isOverdue } from '../components/shared'

const TIPOS_OBS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e', 'Folha', 'Extrato Bancário', 'Documentos', 'Parcelamento']

const TIPO_META = {
  'PGDAS':           { icon:'🧾', dept:'Fiscal',     cor:'#1E5FA0' },
  'DCTFWeb':         { icon:'📄', dept:'Fiscal',     cor:'#1E5FA0' },
  'NFS-e':           { icon:'🧮', dept:'Fiscal',     cor:'#1E5FA0' },
  'eSocial':         { icon:'👥', dept:'Folha',      cor:'#2A7A5A' },
  'Folha':           { icon:'💰', dept:'Folha',      cor:'#2A7A5A' },
  'Extrato Bancário':{ icon:'🏦', dept:'Contábil',   cor:'#6B3FA0' },
  'Documentos':      { icon:'📁', dept:'Societário', cor:'#9A6B1A' },
  'Parcelamento':    { icon:'📅', dept:'Escritório', cor:'#A83030' },
}

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

export default function Overview({ onAddTarefa, onOpenCliente, onOpenObrigacoes, onOpenTarefas }) {
  const clientes     = useStore(s => s.clientes)
  const tarefas      = useStore(s => s.tarefas)
  const obrigacoes   = useStore(s => s.obrigacoes || [])
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const [compSel, setCompSel] = useState(compMesAtras(1))

  const stats = useMemo(() => {
    const pending = tarefas.filter(t => !t.concluida)
    const obs = obrigacoes.filter(o => o.competencia === compSel)
    return {
      clientes:         clientes.length,
      tarefasPendentes: pending.length,
      alta:             pending.filter(t => t.prioridade === 'alta').length,
      obsPendentes:     obs.filter(o => o.status === 'pendente').length,
      obsEmDia:         obs.filter(o => o.status === 'concluido' || o.status === 'nao_aplica').length,
      obsVencidas:      obs.filter(o => o.status === 'vencido').length,
      obsTotal:         obs.length,
    }
  }, [tarefas, obrigacoes, compSel, clientes])

  const progresso = stats.obsTotal > 0 ? Math.round((stats.obsEmDia / stats.obsTotal) * 100) : 0

  const urgentes = useMemo(() =>
    tarefas.filter(t => !t.concluida && (t.prioridade === 'alta' || isOverdue(t.vencimento))).slice(0, 5),
    [tarefas]
  )

  // ── Painel por tipo de atividade — dinâmico ──────────────────────────────
  const atividadeStats = useMemo(() => {
    const obs = obrigacoes.filter(o => o.competencia === compSel)
    return TIPOS_OBS.map(tipo => {
      const lista = obs.filter(o => o.tipo === tipo)
      const total  = lista.length
      const ok     = lista.filter(o => o.status==='concluido'||o.status==='nao_aplica').length
      const venc   = lista.filter(o => o.status==='vencido').length
      const pend   = lista.filter(o => o.status==='pendente').length
      const pct    = total > 0 ? Math.round((ok/total)*100) : 0
      const status = venc > 0 ? 'vencido' : pct===100 ? 'ok' : pend > 0 ? 'pendente' : 'vazio'
      // Clientes com pendência neste tipo
      const clientesPend = lista
        .filter(o => o.status==='pendente'||o.status==='vencido')
        .map(o => clientes.find(c => c.id===o.cliente_id)?.nome?.split(' ').slice(0,2).join(' '))
        .filter(Boolean)
        .slice(0, 3)
      return { tipo, total, ok, venc, pend, pct, status, clientesPend, meta: TIPO_META[tipo] || { icon:'📋', dept:'Geral', cor:'#5B6B8A' } }
    }).filter(a => a.total > 0) // só exibe tipos que têm obrigações no período
  }, [obrigacoes, compSel, clientes])

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:700, color:'var(--text1)', letterSpacing:'-0.3px' }}>Painel</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Visão geral do escritório</p>
        </div>
        <select value={compSel} onChange={e => setCompSel(e.target.value)}
          style={{ fontSize:12, padding:'6px 10px', borderRadius:'var(--r-sm)', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text1)' }}>
          {[0,1,2,3].map(i => {
            const c = compMesAtras(i)
            return <option key={c} value={c}>{i===0?`Atual (${c})`:i===1?`Anterior (${c})`:c}</option>
          })}
        </select>
      </div>

      {/* Métricas */}
      <div className="metrics-grid">
        <div className="metric" style={{ cursor:'pointer' }} onClick={() => onOpenCliente?.(null)}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><UsersIcon size={12} /> Clientes</div>
          <div className="metric-value accent">{stats.clientes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenTarefas}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><CheckSquareIcon size={12} /> Tarefas pend.</div>
          <div className={`metric-value ${stats.tarefasPendentes > 0 ? 'warn' : ''}`}>{stats.tarefasPendentes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><ClipboardListIcon size={12} /> Obrig. pend.</div>
          <div className={`metric-value ${stats.obsPendentes > 0 ? 'warn' : ''}`}>{stats.obsPendentes}</div>
        </div>
        <div className="metric">
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><TrendingUpIcon size={12} /> Concluídas</div>
          <div className="metric-value ok">{stats.obsEmDia}</div>
        </div>
      </div>

      {/* Barra progresso */}
      {stats.obsTotal > 0 && (
        <div className="card" style={{ marginBottom:16, cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6, color:'var(--text1)' }}>
              <ClipboardListIcon size={14} color="var(--accent)" /> Obrigações — {compSel}
            </span>
            <span style={{ fontSize:11, color:'var(--accent)', display:'flex', alignItems:'center', gap:3 }}>
              ver todas <ChevronRightIcon size={12} />
            </span>
          </div>
          <div style={{ height:6, background:'var(--surface2)', borderRadius:99, marginBottom:8 }}>
            <div style={{ height:'100%', width:`${progresso}%`, background:'var(--ok)', borderRadius:99, transition:'width .4s' }} />
          </div>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
            {stats.obsVencidas > 0 && (
              <span style={{ fontSize:12, fontWeight:700, color:'var(--danger)', display:'flex', alignItems:'center', gap:4 }}>
                <AlertCircleIcon size={12} /> {stats.obsVencidas} vencidas
              </span>
            )}
            <span style={{ fontSize:12, color:'var(--warn)' }}>⏳ {stats.obsPendentes} pendentes</span>
            <span style={{ fontSize:12, color:'var(--ok)' }}>✓ {stats.obsEmDia} concluídas</span>
            <span style={{ marginLeft:'auto', fontSize:13, fontWeight:700, color: progresso===100?'var(--ok)':'var(--text2)' }}>
              {progresso}%
            </span>
          </div>
        </div>
      )}

      {/* Tarefas urgentes */}
      {urgentes.length > 0 && (
        <>
          <div className="section-hdr">
            <span className="section-label" style={{ display:'flex', alignItems:'center', gap:5 }}>
              <ZapIcon size={12} /> Urgentes
            </span>
            <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>+ Nova</button>
          </div>
          <div className="card" style={{ marginBottom:16 }}>
            {urgentes.map(t => <TaskRow key={t.id} tarefa={t} onToggle={() => toggleTarefa(t.id)} />)}
          </div>
        </>
      )}

      {/* ── Painel por tipo de atividade ── */}
      <div className="section-hdr" style={{ marginBottom:12 }}>
        <span className="section-label" style={{ display:'flex', alignItems:'center', gap:6 }}>
          <LayersIcon size={12} /> Status por tipo de atividade
        </span>
        <span style={{ fontSize:11, color:'var(--text3)' }}>{compSel}</span>
      </div>

      {atividadeStats.length === 0 ? (
        <div className="card" style={{ textAlign:'center', color:'var(--text3)', padding:'32px 0' }}>
          Nenhuma obrigação registrada para {compSel}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:12, marginBottom:20 }}>
          {atividadeStats.map(({ tipo, total, ok, venc, pend, pct, status, clientesPend, meta }) => {
            const corStatus = status==='ok'?'var(--ok)':status==='vencido'?'var(--danger)':status==='pendente'?'var(--warn)':'var(--text3)'
            const bgStatus  = status==='ok'?'var(--ok-dim)':status==='vencido'?'var(--danger-dim)':status==='pendente'?'var(--warn-dim)':'transparent'
            return (
              <div key={tipo}
                onClick={onOpenObrigacoes}
                style={{ background:'var(--surface)', border:`1px solid var(--border)`,
                  borderTop:`3px solid ${corStatus}`,
                  borderRadius:'var(--r-md)', padding:'14px 16px', cursor:'pointer',
                  transition:'box-shadow .15s' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='var(--shadow-md)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>

                {/* Header do card */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:20 }}>{meta.icon}</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--text1)' }}>{tipo}</div>
                      <div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{meta.dept}</div>
                    </div>
                  </div>
                  {/* Badge status */}
                  <span style={{ fontSize:10, fontWeight:600, padding:'3px 8px', borderRadius:99,
                    background:bgStatus, color:corStatus }}>
                    {status==='ok'?'✓ Em dia':status==='vencido'?'⚠ Vencido':status==='pendente'?'○ Pendente':'—'}
                  </span>
                </div>

                {/* Barra de progresso */}
                <div style={{ height:5, background:'var(--surface2)', borderRadius:99, marginBottom:8, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:corStatus, borderRadius:99, transition:'width .4s' }} />
                </div>

                {/* Números */}
                <div style={{ display:'flex', gap:12, fontSize:12, marginBottom: clientesPend.length > 0 ? 10 : 0 }}>
                  <span style={{ color:'var(--ok)', fontWeight:600 }}>✓ {ok}</span>
                  {pend > 0 && <span style={{ color:'var(--warn)', fontWeight:600 }}>○ {pend} pend.</span>}
                  {venc > 0 && <span style={{ color:'var(--danger)', fontWeight:600 }}>⚠ {venc} venc.</span>}
                  <span style={{ marginLeft:'auto', fontWeight:700, color:corStatus }}>{pct}%</span>
                </div>

                {/* Clientes com pendência */}
                {clientesPend.length > 0 && (
                  <div style={{ borderTop:'1px solid var(--border)', paddingTop:8, display:'flex', flexWrap:'wrap', gap:4 }}>
                    {clientesPend.map((n,i) => (
                      <span key={i} style={{ fontSize:9, background:'var(--surface2)', border:'1px solid var(--border)',
                        borderRadius:4, padding:'2px 6px', color:'var(--text2)', fontWeight:500 }}>
                        {n}
                      </span>
                    ))}
                    {(pend + venc) > 3 && (
                      <span style={{ fontSize:9, color:'var(--text3)', padding:'2px 4px' }}>+{pend+venc-3} mais</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TaskRow({ tarefa, onToggle }) {
  const overdue = isOverdue(tarefa.vencimento) && !tarefa.concluida
  return (
    <div className="task-item">
      <div className={`task-check ${tarefa.concluida ? 'done' : ''}`} onClick={onToggle}>
        {tarefa.concluida && <CheckIcon size={11} color="white" strokeWidth={3} />}
      </div>
      <div className="task-body">
        <div className="task-title"><PriDot pri={tarefa.prioridade} />{' '}{tarefa.titulo}</div>
        <div className="task-meta">
          <span style={{ fontWeight:500 }}>{tarefa.clientes?.nome}</span>
          <DeptChip dept={tarefa.departamento} />
          {tarefa.vencimento && (
            <span style={{ color: overdue?'var(--danger)':'var(--text2)', display:'flex', alignItems:'center', gap:3 }}>
              <CalendarIcon size={9} />{overdue?'⚠ ':''}{fmtDate(tarefa.vencimento)}
            </span>
          )}
          {tarefa.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize:9 }}>WA</span>}
        </div>
      </div>
    </div>
  )
}
