import { useState, useMemo, useEffect } from 'react'
import { RefreshCwIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon, MinusCircleIcon, PencilIcon, ZapIcon, CheckSquareIcon, DownloadIcon, PlusIcon, XIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, useToast } from '../components/shared'
import { supabase } from '../lib/supabase'

const TIPOS = ['PGDAS', 'DCTFWeb', 'eSocial', 'NFS-e']
const VENC  = { PGDAS: 20, DCTFWeb: 15, eSocial: 7, 'NFS-e': 10 }

const STATUS_CFG = {
  pendente:   { label: 'Pendente', color: 'var(--warn)',   Icon: ClockIcon },
  em_dia:     { label: 'Em dia',   color: 'var(--ok)',     Icon: CheckCircleIcon },
  vencido:    { label: 'Vencido',  color: 'var(--danger)', Icon: AlertCircleIcon },
  nao_aplica: { label: 'N/A',      color: 'var(--text3)',  Icon: MinusCircleIcon },
}

function compMesAtras(n) {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
}

function vencPara(tipo, comp) {
  const [mes, ano] = comp.split('/')
  return new Date(parseInt(ano), parseInt(mes), VENC[tipo] || 20).toISOString().split('T')[0]
}

export default function Obrigacoes() {
  const clientes   = useStore(s => s.clientes)
  const obrigacoes = useStore(s => s.obrigacoes || [])
  const fetchObrigacoes   = useStore(s => s.fetchObrigacoes)
  const upsertObrigacao   = useStore(s => s.upsertObrigacao)
  const gerarObrigacoesMes = useStore(s => s.gerarObrigacoesMes)
  const fetchTarefas = useStore(s => s.fetchTarefas)
  const { show } = useToast()

  const [comp, setComp]             = useState(compMesAtras(1))
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [editando, setEditando]     = useState(null)
  const [showLote, setShowLote]     = useState(false)
  const [showBaixa, setShowBaixa]   = useState(false)
  const [gerando, setGerando]       = useState(false)

  useEffect(() => { fetchObrigacoes?.() }, [])

  const obsFiltradas = useMemo(() => obrigacoes.filter(o => {
    if (o.competencia !== comp) return false
    if (filtroTipo !== 'todos' && o.tipo !== filtroTipo) return false
    if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
    return true
  }), [obrigacoes, comp, filtroTipo, filtroStatus])

  const porCliente = useMemo(() => {
    const map = {}
    clientes.forEach(c => { map[c.id] = { cliente: c, obs: {} } })
    obsFiltradas.forEach(o => { if (map[o.cliente_id]) map[o.cliente_id].obs[o.tipo] = o })
    return Object.values(map).filter(({ obs }) => filtroTipo === 'todos' ? Object.keys(obs).length > 0 : obs[filtroTipo])
  }, [clientes, obsFiltradas, filtroTipo])

  const stats = useMemo(() => {
    const s = obrigacoes.filter(o => o.competencia === comp)
    return {
      pendente: s.filter(o => o.status === 'pendente').length,
      em_dia:   s.filter(o => o.status === 'em_dia').length,
      vencido:  s.filter(o => o.status === 'vencido').length,
      total:    s.length,
    }
  }, [obrigacoes, comp])

  const handleGerar = async () => {
    setGerando(true)
    try { await gerarObrigacoesMes(comp); show(`Obrigações geradas para ${comp}`) }
    catch (e) { show('Erro: ' + e.message) }
    setGerando(false)
  }

  const handleStatus = async (clienteId, tipo, novoStatus) => {
    const obs = obrigacoes.find(o => o.cliente_id === clienteId && o.tipo === tipo && o.competencia === comp)
    await upsertObrigacao({ ...(obs||{}), cliente_id: clienteId, tipo, competencia: comp, status: novoStatus, vencimento: vencPara(tipo, comp) })
    setEditando(null)
  }

  const tiposExib = filtroTipo === 'todos' ? TIPOS : [filtroTipo]
  const progresso = stats.total > 0 ? Math.round((stats.em_dia / stats.total) * 100) : 0

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Obrigações</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Controle fiscal por competência</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-sm" onClick={() => setShowLote(true)}>
            <ZapIcon size={12} /> Criar lote
          </button>
          <button className="btn btn-sm btn-ok" onClick={() => setShowBaixa(true)}>
            <CheckSquareIcon size={12} /> Baixa lote
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="metrics-grid" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:12 }}>
        <div className="metric">
          <div className="metric-label">Pendentes</div>
          <div className={`metric-value ${stats.pendente > 0 ? 'warn' : ''}`}>{stats.pendente}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Em dia</div>
          <div className="metric-value ok">{stats.em_dia}</div>
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
          {[0,1,2,3].map(i => {
            const c = compMesAtras(i)
            return <option key={c} value={c}>{c}</option>
          })}
        </select>

        <div className="tabs" style={{ marginBottom:0 }}>
          {['todos',...TIPOS].map(t => (
            <button key={t} className={`tab-btn ${filtroTipo===t?'active':''}`} onClick={() => setFiltroTipo(t)}>
              {t === 'todos' ? 'Todos' : t}
            </button>
          ))}
        </div>

        <div className="tabs" style={{ marginBottom:0, marginLeft:'auto' }}>
          {['todos','pendente','em_dia','vencido'].map(s => (
            <button key={s} className={`tab-btn ${filtroStatus===s?'active':''}`} onClick={() => setFiltroStatus(s)}>
              {s === 'todos' ? 'Todos' : STATUS_CFG[s]?.label || s}
            </button>
          ))}
        </div>

        <button className="btn btn-sm btn-accent" onClick={handleGerar} disabled={gerando}>
          <RefreshCwIcon size={12} />
          {gerando ? 'Gerando...' : `Gerar ${comp}`}
        </button>
      </div>

      {/* Tabela */}
      <div className="card" style={{ padding:0, overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
              <th style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'var(--text3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.6px' }}>Cliente</th>
              {tiposExib.map(t => (
                <th key={t} style={{ padding:'10px 14px', textAlign:'center', fontWeight:700, color:'var(--text3)', fontSize:10, textTransform:'uppercase', letterSpacing:'.6px' }}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porCliente.length === 0 && (
              <tr><td colSpan={tiposExib.length+1} style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>
                Nenhuma obrigação. Clique em "Gerar" para criar automaticamente.
              </td></tr>
            )}
            {porCliente.map(({ cliente, obs }, i) => (
              <tr key={cliente.id} style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'transparent' : 'var(--surface2)' }}>
                <td style={{ padding:'10px 14px' }}>
                  <div style={{ fontWeight:600, fontSize:12 }}>{cliente.nome.split(' ').slice(0,3).join(' ')}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{cliente.regime}</div>
                </td>
                {tiposExib.map(tipo => {
                  const o = obs[tipo]
                  const isEdit = editando?.clienteId === cliente.id && editando?.tipo === tipo
                  return (
                    <td key={tipo} style={{ padding:'8px 14px', textAlign:'center' }}>
                      {isEdit ? (
                        <EditCell status={o?.status||'pendente'} obs={o?.observacao||''}
                          onSave={(s, ob) => { handleStatus(cliente.id, tipo, s); setEditando(null) }}
                          onCancel={() => setEditando(null)} />
                      ) : (
                        <StatusCell status={o?.status} obs={o?.observacao}
                          onClick={() => setEditando({ clienteId: cliente.id, tipo })} />
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
      {showLote && (
        <ModalCriarLote
          clientes={clientes}
          competenciaInicial={comp}
          obrigacoes={obrigacoes}
          gerarObrigacoesMes={gerarObrigacoesMes}
          fetchTarefas={fetchTarefas}
          onClose={() => setShowLote(false)}
          onSaved={() => { fetchObrigacoes(); fetchTarefas(); setShowLote(false); show('Criado com sucesso!') }}
        />
      )}

      {showBaixa && (
        <ModalBaixaLote
          clientes={clientes}
          obrigacoes={obrigacoes}
          competenciaInicial={comp}
          onClose={() => setShowBaixa(false)}
          onSaved={() => { fetchObrigacoes(); fetchTarefas(); setShowBaixa(false); show('Baixa realizada!') }}
        />
      )}
    </div>
  )
}

// ── Modal Criar Lote Global ──────────────────────────────────────────────────
function ModalCriarLote({ clientes, competenciaInicial, obrigacoes, gerarObrigacoesMes, fetchTarefas, onClose, onSaved }) {
  const { show } = useToast()
  const [comp, setComp] = useState(competenciaInicial)
  const [clientesSel, setClientesSel] = useState(clientes.map(c => c.id))
  const [tiposSel, setTiposSel] = useState([...TIPOS])
  const [criarTarefas, setCriarTarefas] = useState(false)
  const [tarefasTpl, setTarefasTpl] = useState([
    { titulo: 'Fechar folha', dept: 'folha', checked: false },
    { titulo: 'Enviar PGDAS', dept: 'fiscal', checked: false },
    { titulo: 'Verificar DCTFWeb', dept: 'fiscal', checked: false },
  ])
  const [saving, setSaving] = useState(false)
  const [busca, setBusca] = useState('')

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleTipo = t => setTiposSel(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])
  const toggleTarefa = i => setTarefasTpl(t => t.map((x, idx) => idx === i ? { ...x, checked: !x.checked } : x))
  const selecionarTodos = () => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))

  const handleSalvar = async () => {
    if (clientesSel.length === 0) { show('Selecione ao menos uma empresa'); return }
    if (tiposSel.length === 0) { show('Selecione ao menos uma obrigação'); return }
    setSaving(true)
    try {
      // Gerar obrigações
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

      // Criar tarefas
      const tSel = tarefasTpl.filter(t => t.checked)
      if (tSel.length > 0) {
        const tarefasRegistros = []
        clientesSel.forEach(cid => {
          tSel.forEach(t => {
            tarefasRegistros.push({
              titulo: `${t.titulo} ${comp}`,
              cliente_id: cid,
              departamento: t.dept,
              prioridade: 'normal',
              concluida: false,
              origem: 'manual',
            })
          })
        })
        await supabase.from('tarefas').insert(tarefasRegistros)
      }

      onSaved()
    } catch(e) { show('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Criar em lote">
      {/* Competência */}
      <div className="form-field">
        <label className="form-label">Competência</label>
        <select value={comp} onChange={e => setComp(e.target.value)}>
          {[0,1,2,3].map(i => { const c = compMesAtras(i); return <option key={c} value={c}>{c}</option> })}
        </select>
      </div>

      {/* Obrigações */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>Obrigações a criar</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {TIPOS.map(t => (
            <button key={t} onClick={() => toggleTipo(t)}
              className={`btn btn-sm ${tiposSel.includes(t) ? 'btn-accent' : ''}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Tarefas opcionais */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>Tarefas (opcional)</div>
        {tarefasTpl.map((t, i) => (
          <label key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', cursor:'pointer' }}>
            <input type="checkbox" checked={t.checked} onChange={() => toggleTarefa(i)} />
            <span style={{ fontSize:12 }}>{t.titulo} {comp}</span>
          </label>
        ))}
      </div>

      <div className="divider" />

      {/* Empresas */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Empresas ({clientesSel.length}/{clientes.length})
        </div>
        <button className="btn btn-sm btn-ghost" onClick={selecionarTodos}>
          {clientesSel.length === clientes.length ? 'Desmarcar todos' : 'Selecionar todos'}
        </button>
      </div>

      <input placeholder="Buscar empresa..." value={busca} onChange={e => setBusca(e.target.value)}
        style={{ marginBottom:8 }} />

      <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--r-sm)' }}>
        {clientesFiltrados.map((c, i) => (
          <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
            <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
            <Avatar name={c.nome} size={24} idx={i} />
            <span style={{ fontSize:12, flex:1 }}>{c.nome}</span>
          </label>
        ))}
      </div>

      <button className="btn btn-accent" onClick={handleSalvar} disabled={saving}
        style={{ width:'100%', marginTop:16, padding:'11px' }}>
        {saving ? 'Criando...' : `Criar para ${clientesSel.length} empresa${clientesSel.length !== 1 ? 's' : ''}`}
      </button>
    </ModalBase>
  )
}

// ── Modal Baixa Lote Global ──────────────────────────────────────────────────
function ModalBaixaLote({ clientes, obrigacoes, competenciaInicial, onClose, onSaved }) {
  const tarefas = useStore(s => s.tarefas)
  const { show } = useToast()
  const [comp, setComp] = useState(competenciaInicial)
  const [clientesSel, setClientesSel] = useState([])
  const [tiposSel, setTiposSel] = useState([...TIPOS])
  const [baixarTarefas, setBaixarTarefas] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busca, setBusca] = useState('')

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const toggleTipo = t => setTiposSel(s => s.includes(t) ? s.filter(x => x !== t) : [...s, t])
  const selecionarTodos = () => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))

  const previewCount = useMemo(() => {
    const obs = obrigacoes.filter(o =>
      o.competencia === comp &&
      clientesSel.includes(o.cliente_id) &&
      tiposSel.includes(o.tipo) &&
      o.status === 'pendente'
    ).length
    const tar = baixarTarefas ? tarefas.filter(t =>
      !t.concluida && clientesSel.includes(t.cliente_id)
    ).length : 0
    return { obs, tar }
  }, [obrigacoes, tarefas, comp, clientesSel, tiposSel, baixarTarefas])

  const handleBaixa = async () => {
    if (clientesSel.length === 0) { show('Selecione ao menos uma empresa'); return }
    setSaving(true)
    try {
      // Atualizar obrigações
      const obsIds = obrigacoes.filter(o =>
        o.competencia === comp &&
        clientesSel.includes(o.cliente_id) &&
        tiposSel.includes(o.tipo) &&
        o.status === 'pendente'
      ).map(o => o.id)

      if (obsIds.length > 0) {
        await supabase.from('obrigacoes').update({ status: 'em_dia', updated_at: new Date().toISOString() }).in('id', obsIds)
      }

      // Baixar tarefas
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
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:8 }}>Obrigações a baixar</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {TIPOS.map(t => (
            <button key={t} onClick={() => toggleTipo(t)} className={`btn btn-sm ${tiposSel.includes(t) ? 'btn-ok' : ''}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <label style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', cursor:'pointer', marginBottom:12 }}>
        <input type="checkbox" checked={baixarTarefas} onChange={e => setBaixarTarefas(e.target.checked)} />
        <span style={{ fontSize:12 }}>Também concluir tarefas pendentes das empresas selecionadas</span>
      </label>

      <div className="divider" />

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
          Empresas ({clientesSel.length}/{clientes.length})
        </div>
        <button className="btn btn-sm btn-ghost" onClick={selecionarTodos}>
          {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
        </button>
      </div>

      <input placeholder="Buscar empresa..." value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom:8 }} />

      <div style={{ maxHeight:200, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--r-sm)' }}>
        {clientesFiltrados.map((c, i) => {
          const obsEmp = obrigacoes.filter(o => o.cliente_id === c.id && o.competencia === comp && o.status === 'pendente').length
          return (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--ok-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <Avatar name={c.nome} size={24} idx={i} />
              <span style={{ fontSize:12, flex:1 }}>{c.nome}</span>
              {obsEmp > 0 && <span style={{ fontSize:10, color:'var(--warn)', fontWeight:700 }}>{obsEmp} pend.</span>}
            </label>
          )
        })}
      </div>

      {clientesSel.length > 0 && (
        <div style={{ marginTop:12, padding:'8px 12px', background:'var(--ok-dim)', borderRadius:'var(--r-sm)', fontSize:12, color:'var(--ok)' }}>
          ✓ Vai baixar <strong>{previewCount.obs}</strong> obrigação{previewCount.obs !== 1 ? 'ões' : ''}
          {baixarTarefas && <> + <strong>{previewCount.tar}</strong> tarefa{previewCount.tar !== 1 ? 's' : ''}</>}
        </div>
      )}

      <button className="btn btn-ok" onClick={handleBaixa} disabled={saving || clientesSel.length === 0}
        style={{ width:'100%', marginTop:16, padding:'11px', fontWeight:700 }}>
        {saving ? 'Salvando...' : `Confirmar baixa — ${clientesSel.length} empresa${clientesSel.length !== 1 ? 's' : ''}`}
      </button>
    </ModalBase>
  )
}

function StatusCell({ status, obs, onClick }) {
  if (!status) return (
    <button onClick={onClick} style={{ background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'3px 10px', cursor:'pointer', color:'var(--text3)', fontSize:11 }}>
      + add
    </button>
  )
  const cfg = STATUS_CFG[status]
  return (
    <div style={{ display:'inline-flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      <button onClick={onClick}
        style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, border:'none', cursor:'pointer', fontSize:11, fontWeight:700, background: cfg.color + '20', color: cfg.color }}>
        <cfg.Icon size={10} />
        {cfg.label}
        <PencilIcon size={9} style={{ opacity:.6 }} />
      </button>
      {obs && <div style={{ fontSize:10, color:'var(--text3)', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{obs}</div>}
    </div>
  )
}

function EditCell({ status, obs, onSave, onCancel }) {
  const [s, setS] = useState(status)
  const [o, setO] = useState(obs)
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, minWidth:130 }}>
      <select value={s} onChange={e => setS(e.target.value)}
        style={{ fontSize:11, padding:'4px 6px' }}>
        {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <input value={o} onChange={e => setO(e.target.value)} placeholder="Obs..."
        style={{ fontSize:11, padding:'3px 6px' }} />
      <div style={{ display:'flex', gap:4 }}>
        <button onClick={() => onSave(s, o)} style={{ flex:1, fontSize:11, padding:'3px', borderRadius:4, background:'var(--accent)', color:'white', border:'none', cursor:'pointer' }}>✓</button>
        <button onClick={onCancel} style={{ flex:1, fontSize:11, padding:'3px', borderRadius:4, background:'var(--surface2)', color:'var(--text2)', border:'1px solid var(--border)', cursor:'pointer' }}>✕</button>
      </div>
    </div>
  )
}

function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl) var(--r-xl) 0 0', width:'100%', maxWidth:620, padding:20, maxHeight:'88vh', overflowY:'auto' }}
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
