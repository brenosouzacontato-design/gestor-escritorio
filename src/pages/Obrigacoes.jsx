import { useState, useMemo, useEffect } from 'react'
import { RefreshCwIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, PencilIcon, ZapIcon, CheckSquareIcon, XIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useStore } from '../store'
import { useToast } from '../components/shared'
import { supabase } from '../lib/supabase'

const TIPOS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e', 'Folha', 'Extrato Bancário', 'Documentos', 'Parcelamento']
const VENC  = { PGDAS: 20, DCTFWeb: 15, eSocial: 7, 'NFS-e': 10, Folha: 7, 'Extrato Bancário': 10, Documentos: 25, Parcelamento: 20 }

const STATUS_CFG = {
  pendente:   { label: 'Pendente',  color: 'var(--warn)',   Icon: ClockIcon },
  concluido:  { label: 'Concluído', color: 'var(--ok)',     Icon: CheckCircleIcon },
  vencido:    { label: 'Vencido',   color: 'var(--danger)', Icon: AlertCircleIcon },
  nao_aplica: { label: 'N/A',       color: 'var(--info)',   Icon: MinusCircleIcon },
}

// Grupos visuais para separar na tabela
const GRUPOS = [
  { label: 'Fiscal',     tipos: ['PGDAS', 'DCTFWeb', 'NFS-e'] },
  { label: 'Trabalhista',tipos: ['eSocial', 'Folha'] },
  { label: 'Escritório', tipos: ['Extrato Bancário', 'Documentos', 'Parcelamento'] },
]

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

function vencPara(tipo, comp) {
  const [mes, ano] = comp.split('/')
  return new Date(parseInt(ano), parseInt(mes), VENC[tipo] || 20).toISOString().split('T')[0]
}

export default function Obrigacoes() {
  const clientes           = useStore(s => s.clientes)
  const obrigacoes         = useStore(s => s.obrigacoes || [])
  const fetchObrigacoes    = useStore(s => s.fetchObrigacoes)
  const gerarObrigacoesMes = useStore(s => s.gerarObrigacoesMes)
  const fetchTarefas       = useStore(s => s.fetchTarefas)
  const { show } = useToast()

  const [comp, setComp]             = useState(compMesAtras(1))
  const [filtroGrupo, setFiltroGrupo] = useState('todos')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [editando, setEditando]     = useState(null)
  const [showLote, setShowLote]     = useState(false)
  const [showBaixa, setShowBaixa]   = useState(false)
  const [showNovaObs, setShowNovaObs] = useState(false)
  const [gerando, setGerando]       = useState(false)
  const [salvando, setSalvando]     = useState(false)
  const [confirmExcluir, setConfirmExcluir] = useState(null) // clienteId a excluir
  const deleteCliente = useStore(s => s.deleteCliente)

  useEffect(() => { fetchObrigacoes?.() }, [])

  const tiposExib = filtroGrupo === 'todos'
    ? TIPOS
    : GRUPOS.find(g => g.label === filtroGrupo)?.tipos || TIPOS

  const obsFiltradas = useMemo(() => obrigacoes.filter(o => {
    if (o.competencia !== comp) return false
    if (!tiposExib.includes(o.tipo)) return false
    if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
    return true
  }), [obrigacoes, comp, tiposExib, filtroStatus])

  const porCliente = useMemo(() => {
    const map = {}
    clientes.forEach(c => { map[c.id] = { cliente: c, obs: {} } })
    obsFiltradas.forEach(o => { if (map[o.cliente_id]) map[o.cliente_id].obs[o.tipo] = o })
    return Object.values(map).filter(({ obs }) => Object.keys(obs).length > 0)
  }, [clientes, obsFiltradas])

  const stats = useMemo(() => {
    const s = obrigacoes.filter(o => o.competencia === comp)
    return {
      pendente:  s.filter(o => o.status === 'pendente').length,
      concluido: s.filter(o => o.status === 'concluido').length,
      vencido:   s.filter(o => o.status === 'vencido').length,
      total:     s.length,
    }
  }, [obrigacoes, comp])

  const progresso = stats.total > 0 ? Math.round((stats.concluido / stats.total) * 100) : 0

  const handleGerar = async () => {
    setGerando(true)
    try { await gerarObrigacoesMes(comp); show(`Obrigações geradas para ${comp}`) }
    catch (e) { show('Erro: ' + e.message) }
    setGerando(false)
  }

  const handleSalvarStatus = async (clienteId, tipo, novoStatus, observacao) => {
    setSalvando(true)
    try {
      const obs = obrigacoes.find(o =>
        o.cliente_id === clienteId && o.tipo === tipo && o.competencia === comp
      )
      if (obs?.id) {
        const { error } = await supabase.from('obrigacoes')
          .update({ status: novoStatus, observacao: observacao || null, updated_at: new Date().toISOString() })
          .eq('id', obs.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('obrigacoes').insert({
          cliente_id: clienteId, tipo, competencia: comp,
          status: novoStatus, observacao: observacao || null,
          vencimento: vencPara(tipo, comp),
          updated_at: new Date().toISOString(),
        })
        if (error) throw error
      }
      await fetchObrigacoes()
      setEditando(null)
      show(`${tipo} → ${STATUS_CFG[novoStatus]?.label}`)
    } catch(e) { show('Erro: ' + e.message) }
    setSalvando(false)
  }

  const handleExcluirCliente = async (clienteId) => {
    try {
      await supabase.from('obrigacoes').delete().eq('cliente_id', clienteId)
      await supabase.from('tarefas').delete().eq('cliente_id', clienteId)
      await supabase.from('clientes').delete().eq('id', clienteId)
      await deleteCliente?.(clienteId)
      await fetchObrigacoes()
      show('Empresa excluída')
    } catch(e) { show('Erro ao excluir: ' + e.message) }
    setConfirmExcluir(null)
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Obrigações</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Controle por competência</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-sm" onClick={() => setShowNovaObs(true)}><PlusIcon size={12} /> Nova</button>
          <button className="btn btn-sm" onClick={() => setShowLote(true)}><ZapIcon size={12} /> Lote</button>
          <button className="btn btn-sm btn-ok" onClick={() => setShowBaixa(true)}><CheckSquareIcon size={12} /> Baixa</button>
        </div>
      </div>

      {/* Stats */}
      <div className="metrics-grid" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:12 }}>
        <div className="metric">
          <div className="metric-label">Pendentes</div>
          <div className={`metric-value ${stats.pendente > 0 ? 'warn' : ''}`}>{stats.pendente}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Concluídas</div>
          <div className="metric-value ok">{stats.concluido}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Vencidas</div>
          <div className={`metric-value ${stats.vencido > 0 ? 'danger' : ''}`}>{stats.vencido}</div>
        </div>
      </div>

      {/* Barra progresso */}
      {stats.total > 0 && (
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span style={{ fontSize:11, color:'var(--text3)' }}>Progresso {comp}</span>
            <span style={{ fontSize:11, fontWeight:700, color: progresso === 100 ? 'var(--ok)' : 'var(--text2)' }}>{progresso}%</span>
          </div>
          <div style={{ height:5, background:'var(--surface2)', borderRadius:99 }}>
            <div style={{ height:'100%', width:`${progresso}%`, background:'var(--ok)', borderRadius:99, transition:'width .4s' }} />
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12, alignItems:'center' }}>
        <select value={comp} onChange={e => setComp(e.target.value)}
          style={{ padding:'7px 10px', borderRadius:'var(--r-sm)', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text1)', fontSize:12 }}>
          {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{c}</option> })}
        </select>

        <div className="tabs" style={{ marginBottom:0 }}>
          {['todos', ...GRUPOS.map(g => g.label)].map(g => (
            <button key={g} className={`tab-btn ${filtroGrupo===g?'active':''}`} onClick={() => setFiltroGrupo(g)}>
              {g}
            </button>
          ))}
        </div>

        <div className="tabs" style={{ marginBottom:0, marginLeft:'auto' }}>
          {['todos','pendente','concluido','vencido'].map(s => (
            <button key={s} className={`tab-btn ${filtroStatus===s?'active':''}`} onClick={() => setFiltroStatus(s)}>
              {s === 'todos' ? 'Todos' : STATUS_CFG[s]?.label}
            </button>
          ))}
        </div>

        <button className="btn btn-sm btn-accent" onClick={handleGerar} disabled={gerando}>
          <RefreshCwIcon size={12} />
          {gerando ? 'Gerando...' : `Gerar ${comp}`}
        </button>
      </div>

      {/* Tabela — dividida por grupos */}
      <div className="card" style={{ padding:0, overflow:'auto', maxHeight:'calc(100vh - 280px)' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, tableLayout:'auto' }}>
          <thead style={{ position:'sticky', top:0, zIndex:10 }}>
            <tr style={{ borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
              <th style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'var(--text3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.6px', whiteSpace:'nowrap' }}>Cliente</th>
              {filtroGrupo === 'todos'
                ? GRUPOS.map(g => g.tipos.map(t => (
                    <th key={t} style={{ padding:'8px 10px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.4px', whiteSpace:'nowrap' }}>
                      {t}
                    </th>
                  )))
                : tiposExib.map(t => (
                    <th key={t} style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.6px', whiteSpace:'nowrap' }}>
                      {t}
                    </th>
                  ))
              }
            </tr>
            {/* Sub-header com grupos quando mostrando todos */}
            {filtroGrupo === 'todos' && (
              <tr style={{ background:'var(--surface3)' }}>
                <td />
                {GRUPOS.map(g => (
                  <td key={g.label} colSpan={g.tipos.length}
                    style={{ padding:'4px 10px', textAlign:'center', fontSize:9, fontWeight:800, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'.8px', borderBottom:'2px solid var(--border)' }}>
                    {g.label}
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {porCliente.length === 0 && (
              <tr><td colSpan={tiposExib.length+1} style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>
                Nenhuma obrigação. Clique em "Gerar" para criar automaticamente.
              </td></tr>
            )}
            {porCliente.map(({ cliente, obs }, i) => (
              <tr key={cliente.id} style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'transparent' : 'var(--surface2)' }}>
                <td style={{ padding:'8px 14px', whiteSpace:'nowrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ fontWeight:600, fontSize:12 }}>
                      {cliente.nome}
                    </div>
                    <button
                      title="Excluir empresa"
                      onClick={() => setConfirmExcluir(cliente)}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', padding:'1px 3px', borderRadius:4, lineHeight:1, opacity:0.5 }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>
                      <Trash2Icon size={11} color="var(--danger)" />
                    </button>
                  </div>
                </td>
                {tiposExib.map(tipo => {
                  const o = obs[tipo]
                  const isEdit = editando?.clienteId === cliente.id && editando?.tipo === tipo
                  return (
                    <td key={tipo} style={{ padding:'6px 10px', textAlign:'center' }}>
                      {isEdit ? (
                        <EditCell
                          status={editando.status}
                          obs={editando.observacao}
                          salvando={salvando}
                          onSave={(s, ob) => handleSalvarStatus(cliente.id, tipo, s, ob)}
                          onCancel={() => setEditando(null)}
                        />
                      ) : (
                        <StatusCell
                          status={o?.status}
                          obs={o?.observacao}
                          onClick={() => setEditando({ clienteId: cliente.id, tipo, status: o?.status || 'pendente', observacao: o?.observacao || '' })}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showNovaObs && (
        <ModalNovaObrigacao clientes={clientes} competenciaInicial={comp}
          onClose={() => setShowNovaObs(false)}
          onSaved={() => { fetchObrigacoes(); setShowNovaObs(false); show('Criada!') }} />
      )}
      {showLote && (
        <ModalCriarLote clientes={clientes} competenciaInicial={comp} obrigacoes={obrigacoes}
          onClose={() => setShowLote(false)}
          onSaved={() => { fetchObrigacoes(); fetchTarefas(); setShowLote(false); show('Criado!') }} />
      )}
      {showBaixa && (
        <ModalBaixaLote clientes={clientes} obrigacoes={obrigacoes} competenciaInicial={comp}
          onClose={() => setShowBaixa(false)}
          onSaved={() => { fetchObrigacoes(); fetchTarefas(); setShowBaixa(false); show('Baixa realizada!') }} />
      )}

      {/* Modal confirmação exclusão */}
      {confirmExcluir && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', backdropFilter:'blur(6px)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={() => setConfirmExcluir(null)}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:24, maxWidth:360, width:'100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
              <Trash2Icon size={20} color="var(--danger)" />
              <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>Excluir empresa</span>
            </div>
            <p style={{ fontSize:13, color:'var(--text2)', marginBottom:6 }}>
              Tem certeza que deseja excluir <strong style={{ color:'var(--text1)' }}>{confirmExcluir.nome}</strong>?
            </p>
            <p style={{ fontSize:11, color:'var(--danger)', marginBottom:20 }}>
              ⚠ Isso apagará permanentemente todos os registros de obrigações e tarefas desta empresa.
            </p>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn" onClick={() => setConfirmExcluir(null)} style={{ flex:1 }}>Cancelar</button>
              <button onClick={() => handleExcluirCliente(confirmExcluir.id)}
                style={{ flex:1, background:'var(--danger)', color:'white', border:'none', borderRadius:'var(--r-sm)', padding:'10px', fontWeight:700, cursor:'pointer', fontSize:13 }}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusCell({ status, obs, onClick }) {
  if (!status) return (
    <button onClick={onClick} style={{ background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'2px 8px', cursor:'pointer', color:'var(--text3)', fontSize:10 }}>+</button>
  )
  const cfg = STATUS_CFG[status] || STATUS_CFG.pendente
  return (
    <button onClick={onClick} title={obs || cfg.label}
      style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 8px', borderRadius:20, border:'none', cursor:'pointer', fontSize:10, fontWeight:700, background: cfg.color + '20', color: cfg.color }}>
      <cfg.Icon size={10} />
      {cfg.label}
    </button>
  )
}

function EditCell({ status, obs, salvando, onSave, onCancel }) {
  const [s, setS] = useState(status)
  const [o, setO] = useState(obs)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3, minWidth:120 }}>
      <select value={s} onChange={e => setS(e.target.value)} style={{ fontSize:11, padding:'3px 5px' }}>
        {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <input value={o} onChange={e => setO(e.target.value)} placeholder="Obs..." style={{ fontSize:10, padding:'2px 5px' }} />
      <div style={{ display:'flex', gap:3 }}>
        <button onClick={() => onSave(s, o)} disabled={salvando}
          style={{ flex:1, fontSize:10, padding:'2px', borderRadius:4, background:'var(--accent)', color:'white', border:'none', cursor:'pointer' }}>
          {salvando ? '...' : '✓'}
        </button>
        <button onClick={onCancel}
          style={{ flex:1, fontSize:10, padding:'2px', borderRadius:4, background:'var(--surface2)', color:'var(--text2)', border:'1px solid var(--border)', cursor:'pointer' }}>✕</button>
      </div>
    </div>
  )
}

function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl) var(--r-xl) 0 0', width:'100%', maxWidth:640, padding:20, maxHeight:'88vh', overflowY:'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>{titulo}</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalNovaObrigacao({ clientes, competenciaInicial, onClose, onSaved }) {
  const { show } = useToast()
  const [clienteId, setClienteId] = useState('')
  const [tipo, setTipo]           = useState('PGDAS')
  const [comp, setComp]           = useState(competenciaInicial)
  const [status, setStatus]       = useState('pendente')
  const [vencimento, setVencimento] = useState(vencPara('PGDAS', competenciaInicial))
  const [observacao, setObservacao] = useState('')
  const [saving, setSaving]       = useState(false)

  const handleSalvar = async () => {
    if (!clienteId) { show('Selecione a empresa'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('obrigacoes').upsert({
        cliente_id: clienteId, tipo, competencia: comp, status,
        vencimento: vencimento || vencPara(tipo, comp),
        observacao: observacao || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'cliente_id,tipo,competencia' })
      if (error) throw error
      onSaved()
    } catch(e) { show('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Nova obrigação">
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label className="form-label">Empresa</label>
          <select value={clienteId} onChange={e => setClienteId(e.target.value)}>
            <option value="">— Selecione —</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label className="form-label">Tipo</label>
            <select value={tipo} onChange={e => { setTipo(e.target.value); setVencimento(vencPara(e.target.value, comp)) }}>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Competência</label>
            <select value={comp} onChange={e => setComp(e.target.value)}>
              {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{c}</option> })}
            </select>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label className="form-label">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Observação</label>
          <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} placeholder="Anotações..." />
        </div>
      </div>
      <button className="btn btn-accent" onClick={handleSalvar} disabled={saving}
        style={{ width:'100%', marginTop:16, padding:'11px', fontWeight:700 }}>
        {saving ? 'Salvando...' : 'Criar obrigação'}
      </button>
    </ModalBase>
  )
}

function ModalCriarLote({ clientes, competenciaInicial, obrigacoes, onClose, onSaved }) {
  const { show } = useToast()
  const [comp, setComp]           = useState(competenciaInicial)
  const [clientesSel, setClientesSel] = useState(clientes.map(c => c.id))
  const [tiposSel, setTiposSel]   = useState([...TIPOS])
  const [saving, setSaving]       = useState(false)
  const [busca, setBusca]         = useState('')

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleTipo    = t  => setTiposSel(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])

  const handleSalvar = async () => {
    if (!clientesSel.length || !tiposSel.length) { show('Selecione empresas e tipos'); return }
    setSaving(true)
    try {
      const [mes, ano] = comp.split('/')
      const registros = []
      clientesSel.forEach(cid => {
        tiposSel.forEach(tipo => {
          registros.push({
            cliente_id: cid, tipo, competencia: comp, status: 'pendente',
            vencimento: new Date(parseInt(ano), parseInt(mes), VENC[tipo]||20).toISOString().split('T')[0],
            updated_at: new Date().toISOString(),
          })
        })
      })
      await supabase.from('obrigacoes').upsert(registros, { onConflict: 'cliente_id,tipo,competencia', ignoreDuplicates: true })
      onSaved()
    } catch(e) { show('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Criar em lote">
      <div className="form-field">
        <label className="form-label">Competência</label>
        <select value={comp} onChange={e => setComp(e.target.value)}>
          {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{c}</option> })}
        </select>
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>Tipos</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {TIPOS.map(t => (
            <button key={t} onClick={() => toggleTipo(t)} className={`btn btn-sm ${tiposSel.includes(t) ? 'btn-accent' : ''}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="divider" />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Empresas ({clientesSel.length}/{clientes.length})
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}>
          {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
        </button>
      </div>
      <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom:8 }} />
      <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--r-sm)' }}>
        {clientesFiltrados.map((c, i) => (
          <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
            <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
            <span style={{ fontSize:12, flex:1 }}>{c.nome}</span>
          </label>
        ))}
      </div>
      <button className="btn btn-accent" onClick={handleSalvar} disabled={saving}
        style={{ width:'100%', marginTop:16, padding:'11px', fontWeight:700 }}>
        {saving ? 'Criando...' : `Criar para ${clientesSel.length} empresa${clientesSel.length !== 1 ? 's' : ''}`}
      </button>
    </ModalBase>
  )
}

function ModalBaixaLote({ clientes, obrigacoes, competenciaInicial, onClose, onSaved }) {
  const tarefas = useStore(s => s.tarefas)
  const { show } = useToast()
  const [comp, setComp]           = useState(competenciaInicial)
  const [clientesSel, setClientesSel] = useState([])
  const [tiposSel, setTiposSel]   = useState([...TIPOS])
  const [baixarTarefas, setBaixarTarefas] = useState(false)
  const [saving, setSaving]       = useState(false)
  const [busca, setBusca]         = useState('')

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleTipo    = t  => setTiposSel(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])

  const previewObs = obrigacoes.filter(o =>
    o.competencia === comp && clientesSel.includes(o.cliente_id) &&
    tiposSel.includes(o.tipo) && o.status === 'pendente'
  ).length
  const previewTar = baixarTarefas ? tarefas.filter(t => !t.concluida && clientesSel.includes(t.cliente_id)).length : 0

  const handleBaixa = async () => {
    if (!clientesSel.length) { show('Selecione empresas'); return }
    setSaving(true)
    try {
      const obsIds = obrigacoes.filter(o =>
        o.competencia === comp && clientesSel.includes(o.cliente_id) &&
        tiposSel.includes(o.tipo) && o.status === 'pendente'
      ).map(o => o.id)
      if (obsIds.length > 0) {
        await supabase.from('obrigacoes').update({ status: 'concluido', updated_at: new Date().toISOString() }).in('id', obsIds)
      }
      if (baixarTarefas) {
        const tarIds = tarefas.filter(t => !t.concluida && clientesSel.includes(t.cliente_id)).map(t => t.id)
        if (tarIds.length > 0) {
          await supabase.from('tarefas').update({ concluida: true, concluida_em: new Date().toISOString(), updated_at: new Date().toISOString() }).in('id', tarIds)
        }
      }
      onSaved()
    } catch(e) { show('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Baixa em lote">
      <div className="form-field">
        <label className="form-label">Competência</label>
        <select value={comp} onChange={e => setComp(e.target.value)}>
          {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{c}</option> })}
        </select>
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>Tipos</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {TIPOS.map(t => (
            <button key={t} onClick={() => toggleTipo(t)} className={`btn btn-sm ${tiposSel.includes(t) ? 'btn-ok' : ''}`}>{t}</button>
          ))}
        </div>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', cursor:'pointer', marginBottom:8 }}>
        <input type="checkbox" checked={baixarTarefas} onChange={e => setBaixarTarefas(e.target.checked)} />
        <span style={{ fontSize:12 }}>Também concluir tarefas pendentes</span>
      </label>
      <div className="divider" />
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Empresas ({clientesSel.length}/{clientes.length})
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}>
          {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
        </button>
      </div>
      <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom:8 }} />
      <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--r-sm)' }}>
        {clientesFiltrados.map((c, i) => {
          const pend = obrigacoes.filter(o => o.cliente_id === c.id && o.competencia === comp && o.status === 'pendente').length
          return (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--ok-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <span style={{ fontSize:12, flex:1 }}>{c.nome}</span>
              {pend > 0 && <span style={{ fontSize:10, color:'var(--warn)', fontWeight:700 }}>{pend} pend.</span>}
            </label>
          )
        })}
      </div>
      {clientesSel.length > 0 && (
        <div style={{ marginTop:10, padding:'8px 12px', background:'var(--ok-dim)', borderRadius:'var(--r-sm)', fontSize:12, color:'var(--ok)' }}>
          ✓ {previewObs} obrigação{previewObs !== 1 ? 'ões' : ''}{baixarTarefas ? ` + ${previewTar} tarefa${previewTar !== 1 ? 's' : ''}` : ''} serão baixadas
        </div>
      )}
      <button className="btn btn-ok" onClick={handleBaixa} disabled={saving || !clientesSel.length}
        style={{ width:'100%', marginTop:16, padding:'11px', fontWeight:700 }}>
        {saving ? 'Salvando...' : `Confirmar baixa — ${clientesSel.length} empresa${clientesSel.length !== 1 ? 's' : ''}`}
      </button>
    </ModalBase>
  )
}
