import { useState, useMemo } from 'react'
import { CheckIcon, ClipboardListIcon, AlertCircleIcon, TrendingUpIcon, UsersIcon, CheckSquareIcon, ZapIcon, ChevronRightIcon, CalendarIcon, CheckCircleIcon, ClockIcon, MinusCircleIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, StatusDots, DeptChip, PriDot, fmtDate, isOverdue, clientTaskStatus } from '../components/shared'

const TIPOS_OBS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e', 'Folha', 'Extrato Bancário', 'Documentos', 'Parcelamento']

const STATUS_DOT = {
  concluido:  { color: 'var(--ok)',     symbol: '✓' },
  pendente:   { color: 'var(--warn)',   symbol: '○' },
  vencido:    { color: 'var(--danger)', symbol: '!' },
  nao_aplica: { color: 'var(--text3)', symbol: '—' },
}

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

export default function Overview({ onAddTarefa, onOpenCliente, onOpenObrigacoes, onOpenTarefas }) {
  const clientes   = useStore(s => s.clientes)
  const tarefas    = useStore(s => s.tarefas)
  const fechamentos = useStore(s => s.fechamentos)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const [compSel, setCompSel] = useState(compMesAtras(1))
  const [busca, setBusca]     = useState('')

  const stats = useMemo(() => {
    const pending = tarefas.filter(t => !t.concluida)
    const obs = obrigacoes.filter(o => o.competencia === compSel)
    return {
      clientes:        clientes.length,
      tarefasPendentes: pending.length,
      alta:            pending.filter(t => t.prioridade === 'alta').length,
      obsPendentes:    obs.filter(o => o.status === 'pendente').length,
      obsEmDia:        obs.filter(o => o.status === 'concluido').length,
      obsVencidas:     obs.filter(o => o.status === 'vencido').length,
      obsTotal:        obs.length,
    }
  }, [tarefas, obrigacoes, compSel, clientes])

  const progresso = stats.obsTotal > 0 ? Math.round((stats.obsEmDia / stats.obsTotal) * 100) : 0

  const urgentes = useMemo(() =>
    tarefas.filter(t => !t.concluida && (t.prioridade === 'alta' || isOverdue(t.vencimento))).slice(0, 5),
    [tarefas]
  )

  // Acompanhamento por empresa
  const empresasAcomp = useMemo(() => {
    const termo = busca.toLowerCase()
    return clientes
      .filter(c => !termo || c.nome.toLowerCase().includes(termo))
      .map((c, i) => {
        const f = fechamentos.filter(x => x.cliente_id === c.id)
        const folhaERP = f.find(x => x.tipo === 'folha')?.status
        const fiscalERP = f.find(x => x.tipo === 'fiscal')?.status
        const tPend = tarefas.filter(t => t.cliente_id === c.id && !t.concluida).length
        const obsEmp = obrigacoes.filter(o => o.cliente_id === c.id && o.competencia === compSel)
        const obsByTipo = {}
        TIPOS_OBS.forEach(t => { obsByTipo[t] = obsEmp.find(o => o.tipo === t)?.status || null })
        const pend = obsEmp.filter(o => o.status === 'pendente').length
        const venc = obsEmp.filter(o => o.status === 'vencido').length
        const ok   = obsEmp.filter(o => o.status === 'concluido').length
        return { cliente: c, idx: i, folhaERP, fiscalERP, tPend, obsByTipo, pend, venc, ok, total: obsEmp.length }
      })
  }, [clientes, fechamentos, tarefas, obrigacoes, compSel, busca])

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Painel</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Visão geral do escritório</p>
        </div>
        <select value={compSel} onChange={e => setCompSel(e.target.value)}
          style={{ fontSize:12, padding:'6px 10px', borderRadius:'var(--r-sm)', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text1)' }}>
          {[0,1,2,3].map(i => {
            const c = compMesAtras(i)
            return <option key={c} value={c}>{i === 0 ? `Atual (${c})` : i === 1 ? `Anterior (${c})` : c}</option>
          })}
        </select>
      </div>

      {/* Métricas */}
      <div className="metrics-grid">
        <div className="metric" style={{ cursor:'pointer' }} onClick={() => onOpenCliente?.(null)}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><UsersIcon size={10} /> Clientes</div>
          <div className="metric-value accent">{stats.clientes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenTarefas}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><CheckSquareIcon size={10} /> Tarefas pend.</div>
          <div className={`metric-value ${stats.tarefasPendentes > 0 ? 'warn' : ''}`}>{stats.tarefasPendentes}</div>
        </div>
        <div className="metric" style={{ cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><ClipboardListIcon size={10} /> Obrig. pend.</div>
          <div className={`metric-value ${stats.obsPendentes > 0 ? 'warn' : ''}`}>{stats.obsPendentes}</div>
        </div>
        <div className="metric">
          <div className="metric-label" style={{ display:'flex', alignItems:'center', gap:4 }}><TrendingUpIcon size={10} /> Concluídas</div>
          <div className="metric-value ok">{stats.obsEmDia}</div>
        </div>
      </div>

      {/* Barra progresso obrigações */}
      {stats.obsTotal > 0 && (
        <div className="card" style={{ marginBottom:14, cursor:'pointer' }} onClick={onOpenObrigacoes}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
              <ClipboardListIcon size={14} color="var(--accent)" /> Obrigações — {compSel}
            </span>
            <span style={{ fontSize:11, color:'var(--accent)', display:'flex', alignItems:'center', gap:3 }}>
              ver todas <ChevronRightIcon size={12} />
            </span>
          </div>
          <div style={{ height:5, background:'var(--surface2)', borderRadius:99, marginBottom:8 }}>
            <div style={{ height:'100%', width:`${progresso}%`, background:'var(--ok)', borderRadius:99, transition:'width .4s' }} />
          </div>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center' }}>
            {stats.obsVencidas > 0 && (
              <span style={{ fontSize:12, fontWeight:700, color:'var(--danger)', display:'flex', alignItems:'center', gap:4 }}>
                <AlertCircleIcon size={11} /> {stats.obsVencidas} vencidas
              </span>
            )}
            <span style={{ fontSize:12, color:'var(--warn)' }}>⏳ {stats.obsPendentes} pendentes</span>
            <span style={{ fontSize:12, color:'var(--ok)' }}>✓ {stats.obsEmDia} concluídas</span>
            <span style={{ marginLeft:'auto', fontSize:12, fontWeight:700, color: progresso === 100 ? 'var(--ok)' : 'var(--text2)' }}>
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
              <ZapIcon size={10} /> Urgentes
            </span>
            <button className="btn btn-sm btn-accent" onClick={onAddTarefa}>+ Nova</button>
          </div>
          <div className="card" style={{ marginBottom:14 }}>
            {urgentes.map(t => <TaskRow key={t.id} tarefa={t} onToggle={() => toggleTarefa(t.id)} />)}
          </div>
        </>
      )}

      {/* Acompanhamento por empresa */}
      <div className="section-hdr">
        <span className="section-label">Acompanhamento por empresa</span>
        <span style={{ fontSize:10, color:'var(--text3)' }}>{compSel}</span>
      </div>

      {/* Busca */}
      <input placeholder="Buscar empresa..." value={busca} onChange={e => setBusca(e.target.value)}
        style={{ marginBottom:10 }} />

      {/* Tabela de acompanhamento */}
      <div className="card" style={{ padding:0, overflow:'auto', marginBottom:20 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
          <thead>
            <tr style={{ background:'var(--surface2)', borderBottom:'1px solid var(--border)' }}>
              <th style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:'var(--text3)', fontSize:9, textTransform:'uppercase', letterSpacing:'.8px', minWidth:140 }}>Empresa</th>
              <th style={{ padding:'8px 8px', textAlign:'center', fontWeight:700, color:'var(--info)', fontSize:9, textTransform:'uppercase' }}>ERP</th>
              <th style={{ padding:'8px 8px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:9, textTransform:'uppercase' }}>Tasks</th>
              {TIPOS_OBS.map(t => (
                <th key={t} style={{ padding:'8px 6px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:9, textTransform:'uppercase', whiteSpace:'nowrap' }}>
                  {t.length > 8 ? t.substring(0,8) + '.' : t}
                </th>
              ))}
              <th style={{ padding:'8px 8px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:9 }}>%</th>
            </tr>
          </thead>
          <tbody>
            {empresasAcomp.map(({ cliente, idx, folhaERP, fiscalERP, tPend, obsByTipo, pend, venc, ok, total }, i) => {
              const progEmp = total > 0 ? Math.round((ok / total) * 100) : 0
              return (
                <tr key={cliente.id}
                  style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'transparent' : 'var(--surface2)', cursor:'pointer' }}
                  onClick={() => onOpenCliente(cliente.id)}>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <Avatar name={cliente.nome} size={24} idx={idx} />
                      <div>
                        <div style={{ fontWeight:600, fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:120 }}>
                          {cliente.nome.split(' ').slice(0,2).join(' ')}
                        </div>
                        {(pend > 0 || venc > 0) && (
                          <div style={{ fontSize:9, color: venc > 0 ? 'var(--danger)' : 'var(--warn)', fontWeight:700 }}>
                            {venc > 0 ? `${venc} venc.` : `${pend} pend.`}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'6px 8px', textAlign:'center' }}>
                    <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
                      <span title="Folha" style={{ width:6, height:6, borderRadius:'50%', background: folhaERP === 'fechado' ? 'var(--ok)' : folhaERP === 'aberto' ? 'var(--warn)' : 'var(--text3)', display:'inline-block' }} />
                      <span title="Fiscal" style={{ width:6, height:6, borderRadius:'50%', background: fiscalERP === 'fechado' ? 'var(--ok)' : fiscalERP === 'aberto' ? 'var(--warn)' : 'var(--text3)', display:'inline-block' }} />
                    </div>
                  </td>
                  <td style={{ padding:'6px 8px', textAlign:'center' }}>
                    {tPend > 0
                      ? <span style={{ fontSize:10, fontWeight:700, color:'var(--warn)' }}>{tPend}</span>
                      : <span style={{ fontSize:10, color:'var(--ok)' }}>✓</span>
                    }
                  </td>
                  {TIPOS_OBS.map(tipo => {
                    const status = obsByTipo[tipo]
                    const cfg = STATUS_DOT[status] || { color:'var(--text3)', symbol:'·' }
                    return (
                      <td key={tipo} style={{ padding:'6px 6px', textAlign:'center' }}>
                        <span title={`${tipo}: ${status || 'sem registro'}`}
                          style={{ fontSize:11, fontWeight:700, color: cfg.color }}>
                          {cfg.symbol}
                        </span>
                      </td>
                    )
                  })}
                  <td style={{ padding:'6px 8px', textAlign:'center' }}>
                    {total > 0 ? (
                      <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'center' }}>
                        <div style={{ width:28, height:3, background:'var(--surface3)', borderRadius:99 }}>
                          <div style={{ height:'100%', width:`${progEmp}%`, background: venc > 0 ? 'var(--danger)' : progEmp === 100 ? 'var(--ok)' : 'var(--accent)', borderRadius:99 }} />
                        </div>
                        <span style={{ fontSize:9, color:'var(--text3)', width:22 }}>{progEmp}%</span>
                      </div>
                    ) : <span style={{ fontSize:10, color:'var(--text3)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
            <span style={{ color: overdue ? 'var(--danger)' : 'var(--text2)', display:'flex', alignItems:'center', gap:3 }}>
              <CalendarIcon size={9} />{overdue ? '⚠ ' : ''}{fmtDate(tarefa.vencimento)}
            </span>
          )}
          {tarefa.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize:9 }}>WA</span>}
        </div>
      </div>
    </div>
  )
}
