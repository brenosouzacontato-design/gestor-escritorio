import { useState, useEffect, useMemo } from 'react'
import { PlusIcon, SettingsIcon, TruckIcon, XIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { useStore } from '../../store'
import {
  listarDepartamentos, listarTiposObrigacao, listarTodosTiposObrigacaoComEtapas,
  criarObrigacaoComEtapas, criarTipoObrigacaoComEtapas, adicionarEtapaTemplate,
  excluirEtapaTemplate, arquivarTipoObrigacao,
  listarObrigacoesComEtapas, marcarEntregaObrigacao, statusVisualEtapa, etapaAtrasada,
} from './andamentoApi'
import DepartamentoTimeline from './DepartamentoTimeline'
import HistoricoObrigacaoModal from './HistoricoObrigacaoModal'

const AVATAR_COLORS = [
  ['#1a2e22','#34d399'],['#2a1f10','#fbbf24'],['#18203a','var(--accent)'],
  ['#2a1820','#f9a8d4'],['#1e1a30','#c4b5fd'],['#182828','#5eead4'],
]

// Tela dedicada de "Andamento das Atividades": cada obrigação com etapas
// (processo — rescisão, EFD-Contribuições etc) vira um card com a timeline
// completa (execução → entrega), com opção de personalizar os tipos/etapas
// e marcar cada uma como entregue ou a entregar.
export default function AndamentoPage({ onOpenTarefa }) {
  const clientes = useStore(s => s.clientes)

  const [departamentos, setDepartamentos] = useState([])
  const [obrigacoes,    setObrigacoes]    = useState([])
  const [carregando,    setCarregando]    = useState(true)
  const [busca,         setBusca]         = useState('')
  const [filtroDept,    setFiltroDept]    = useState('todos')
  const [filtroStatus,  setFiltroStatus]  = useState('ativas') // ativas | atrasadas | entregues | todas

  const [historicoModal, setHistoricoModal] = useState(null)
  const [showNova,       setShowNova]       = useState(false)
  const [showGerenciar,  setShowGerenciar]  = useState(false)

  const carregarObrigacoes = async () => {
    if (clientes.length === 0) return
    setCarregando(true)
    try { setObrigacoes(await listarObrigacoesComEtapas(clientes.map(c => c.id))) }
    finally { setCarregando(false) }
  }

  useEffect(() => { listarDepartamentos().then(setDepartamentos).catch(() => {}) }, [])
  useEffect(() => { carregarObrigacoes() }, [clientes.length])

  const clientePorId = useMemo(() => Object.fromEntries(clientes.map(c => [c.id, c])), [clientes])
  const deptPorId    = useMemo(() => Object.fromEntries(departamentos.map(d => [d.id, d])), [departamentos])

  const lista = useMemo(() => {
    const termo = busca.toLowerCase()
    return obrigacoes
      .filter(o => {
        if (filtroDept !== 'todos' && o.departamento_id !== filtroDept) return false
        const atrasada = (o.etapas_obrigacao || []).some(etapaAtrasada)
        if (filtroStatus === 'ativas'    && o.status === 'concluido') return false
        if (filtroStatus === 'entregues' && !o.entregue) return false
        if (filtroStatus === 'atrasadas' && !atrasada) return false
        if (termo) {
          const cli = clientePorId[o.cliente_id]
          const alvo = `${cli?.nome || ''} ${o.titulo || ''}`.toLowerCase()
          if (!alvo.includes(termo)) return false
        }
        return true
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [obrigacoes, filtroDept, filtroStatus, busca, clientePorId])

  const handleToggleEntrega = async (o) => {
    await marcarEntregaObrigacao(o.id, !o.entregue)
    await carregarObrigacoes()
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', overflow:'hidden' }}>

      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0, flexWrap:'wrap', rowGap:6 }}>
        <div>
          <h2 style={{ fontSize:14, fontWeight:500, color:'var(--text1)', margin:0 }}>Andamento das Atividades</h2>
          <p style={{ fontSize:10, color:'var(--text3)', margin:0 }}>Da execução à entrega · {lista.length} atividades</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:8, padding:'5px 9px', marginLeft:12 }}>
          <span style={{ fontSize:12, color:'var(--text3)' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa ou atividade..."
            style={{ background:'none', border:'none', outline:'none', fontSize:11, color:'var(--text2)', width:180 }} />
        </div>
        <select value={filtroDept} onChange={e => setFiltroDept(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:8, padding:'5px 8px', fontSize:11, color:'var(--text2)' }}>
          <option value="todos">Todos os departamentos</option>
          {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
        </select>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          <button onClick={() => setShowGerenciar(true)}
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:8, padding:'6px 10px', fontSize:11, color:'var(--text2)', cursor:'pointer', fontWeight:500 }}>
            <SettingsIcon size={12} /> Personalizar etapas
          </button>
          <button onClick={() => setShowNova(true)}
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--navy)', border:'none', borderRadius:8, padding:'6px 12px', fontSize:11, color:'#fff', cursor:'pointer', fontWeight:600 }}>
            <PlusIcon size={12} /> Nova atividade
          </button>
        </div>
      </div>

      {/* Filtros de status */}
      <div style={{ display:'flex', gap:5, padding:'7px 16px', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface2)' }}>
        {[['ativas','Ativas'],['atrasadas','Atrasadas'],['entregues','Entregues'],['todas','Todas']].map(([id,lbl]) => (
          <button key={id} onClick={() => setFiltroStatus(id)}
            style={{ background:filtroStatus===id?'var(--accent-dim)':'var(--surface2)', border:`1px solid ${filtroStatus===id?'var(--accent)':'var(--border)'}`,
              borderRadius:99, padding:'3px 9px', fontSize:10, color:filtroStatus===id?'var(--accent)':'var(--text3)', cursor:'pointer', fontWeight:500 }}>
            {lbl}
          </button>
        ))}
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

      {/* Lista de atividades */}
      <div style={{ flex:1, overflow:'auto', padding:'4px 16px 16px' }}>
        {!carregando && lista.length === 0 && (
          <div style={{ padding:40, textAlign:'center', color:'var(--text3)', fontSize:13 }}>
            Nenhuma atividade encontrada. Clique em "Nova atividade" pra começar.
          </div>
        )}
        {lista.map((o, i) => {
          const cli = clientePorId[o.cliente_id]
          const dept = deptPorId[o.departamento_id]
          const [bg, tc] = AVATAR_COLORS[i % AVATAR_COLORS.length]
          const initials = (cli?.nome || '??').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()
          const trilha = {
            kind: 'processo',
            titulo: o.titulo,
            stages: (o.etapas_obrigacao || []).map(e => ({
              key: e.id, nome: e.nome, statusVisual: statusVisualEtapa(e), kind: 'processo', raw: e, obrigacaoRef: o,
            })),
          }
          return (
            <div key={o.id} style={{ background:'var(--surface)', borderRadius:12, padding:'16px 20px', marginBottom:14, boxShadow:'var(--shadow-sm)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:38, height:38, borderRadius:9, background:bg, color:tc, flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color:'var(--text1)' }}>{o.titulo}</div>
                    <div style={{ fontSize:11.5, color:'var(--text3)', marginTop:1, display:'flex', gap:6, alignItems:'center' }}>
                      {cli?.nome || '—'}
                      {dept && <span style={{ background:'var(--accent-dim)', color:'var(--accent)', borderRadius:99, padding:'0 6px', fontSize:10, fontWeight:600 }}>{dept.icone} {dept.nome}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => handleToggleEntrega(o)}
                  title={o.entregue ? 'Clique pra marcar como a entregar' : 'Clique pra marcar como entregue'}
                  style={{ display:'flex', alignItems:'center', gap:5, background: o.entregue?'var(--ok-dim)':'var(--warn-dim)', color: o.entregue?'var(--ok)':'var(--warn)',
                    border:'none', borderRadius:99, padding:'5px 11px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                  <TruckIcon size={12} /> {o.entregue ? 'Entregue' : 'A entregar'}
                </button>
              </div>
              <DepartamentoTimeline trilha={trilha}
                onStageClick={(stage) => setHistoricoModal({ cliente: cli, dept: dept?.nome || '', trilha, stage })} />
            </div>
          )
        })}
      </div>

      {historicoModal && (
        <HistoricoObrigacaoModal
          stage={historicoModal.stage}
          titulo={historicoModal.trilha.titulo}
          clienteNome={historicoModal.cliente?.nome || ''}
          departamentoNome={historicoModal.dept}
          onClose={() => setHistoricoModal(null)}
          onAtualizado={async () => { setHistoricoModal(null); await carregarObrigacoes() }}
          onAbrirTarefa={(taskId) => { setHistoricoModal(null); onOpenTarefa?.(taskId) }}
        />
      )}

      {showNova && (
        <NovaAtividadeModal
          clientes={clientes}
          departamentos={departamentos}
          onClose={() => setShowNova(false)}
          onSaved={async () => { setShowNova(false); await carregarObrigacoes() }}
        />
      )}

      {showGerenciar && (
        <GerenciarTiposModal
          departamentos={departamentos}
          onClose={() => setShowGerenciar(false)}
        />
      )}
    </div>
  )
}

// ── Modal Nova Atividade ─────────────────────────────────────────────────────
function NovaAtividadeModal({ clientes, departamentos, onClose, onSaved }) {
  const [clienteId,     setClienteId]     = useState('')
  const [departamentoId,setDepartamentoId]= useState('')
  const [tipos,         setTipos]         = useState([])
  const [tipoId,        setTipoId]        = useState('')
  const [titulo,        setTitulo]        = useState('')
  const [responsavel,   setResponsavel]   = useState('')
  const [saving,        setSaving]        = useState(false)
  const [erro,          setErro]          = useState(null)

  useEffect(() => {
    if (!departamentoId) { setTipos([]); setTipoId(''); return }
    listarTiposObrigacao(departamentoId).then(setTipos).catch(() => {})
  }, [departamentoId])

  const handleSave = async () => {
    if (!clienteId || !tipoId) return
    setSaving(true)
    setErro(null)
    try {
      const tipoObj = tipos.find(t => t.id === tipoId)
      await criarObrigacaoComEtapas({
        clienteId, tipoObrigacaoId: tipoId, departamentoId,
        titulo: titulo.trim() || tipoObj?.nome || 'Atividade', responsavel: responsavel.trim() || null,
      })
      onSaved()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalBase onClose={onClose} titulo="Nova atividade">
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Empresa</label>
          <select value={clienteId} onChange={e => setClienteId(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
            <option value="">Selecione...</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Departamento</label>
          <select value={departamentoId} onChange={e => setDepartamentoId(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
            <option value="">Selecione...</option>
            {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de atividade</label>
          <select value={tipoId} onChange={e => setTipoId(e.target.value)} disabled={!departamentoId}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', opacity: departamentoId?1:.6 }}>
            <option value="">{departamentoId ? 'Selecione...' : 'Escolha o departamento primeiro'}</option>
            {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          {departamentoId && tipos.length === 0 && (
            <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>Esse departamento ainda não tem tipos cadastrados — use "Personalizar etapas".</div>
          )}
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Título (opcional)</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Rescisão — João da Silva"
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Responsável (opcional)</label>
          <input value={responsavel} onChange={e => setResponsavel(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving || !clienteId || !tipoId}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!clienteId||!tipoId)?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving ? 'Salvando...' : 'Criar atividade'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Personalizar Etapas (tipos_obrigacao + etapas_template) ───────────
function GerenciarTiposModal({ departamentos, onClose }) {
  const [tipos,       setTipos]       = useState([])
  const [carregando,  setCarregando]  = useState(true)
  const [expandido,   setExpandido]   = useState(null)
  const [criandoNovo, setCriandoNovo] = useState(false)

  const carregar = async () => {
    setCarregando(true)
    try { setTipos(await listarTodosTiposObrigacaoComEtapas()) }
    finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [])

  const handleArquivar = async (id) => {
    if (!window.confirm('Arquivar esse tipo de atividade? Atividades já criadas com ele continuam existindo.')) return
    await arquivarTipoObrigacao(id)
    await carregar()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(27,43,75,.45)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', width:'100%', maxWidth:560, maxHeight:'88vh', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', background:'#1B2B4B', borderBottom:'1px solid #243660' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'#fff' }}>Personalizar tipos de atividade e etapas</span>
          <button onClick={onClose}
            style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', borderRadius:6, width:22, height:22, color:'#8fadd4', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <XIcon size={13} />
          </button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:16, background:'var(--bg)' }}>
          {!criandoNovo && (
            <button onClick={() => setCriandoNovo(true)}
              style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:6, background:'var(--navy)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:600, cursor:'pointer', marginBottom:14 }}>
              <PlusIcon size={13} /> Novo tipo de atividade
            </button>
          )}

          {criandoNovo && (
            <NovoTipoForm departamentos={departamentos}
              onCancel={() => setCriandoNovo(false)}
              onSaved={async () => { setCriandoNovo(false); await carregar() }} />
          )}

          {carregando && <p style={{ fontSize:12, color:'var(--text3)' }}>Carregando...</p>}

          {!carregando && tipos.map(t => (
            <div key={t.id} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer' }}
                onClick={() => setExpandido(expandido === t.id ? null : t.id)}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text1)' }}>{t.nome}</div>
                  <div style={{ fontSize:10.5, color:'var(--text3)', marginTop:2 }}>
                    {t.departamentos?.icone} {t.departamentos?.nome} · {t.etapas_template.length} etapas{t.recorrente ? ' · recorrente' : ''}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); handleArquivar(t.id) }}
                  style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)', padding:4 }} title="Arquivar tipo">
                  <Trash2Icon size={13} />
                </button>
              </div>

              {expandido === t.id && (
                <EtapasDoTipo tipo={t} onChanged={carregar} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function NovoTipoForm({ departamentos, onCancel, onSaved }) {
  const [nome,          setNome]          = useState('')
  const [departamentoId,setDepartamentoId]= useState(departamentos[0]?.id || '')
  const [recorrente,    setRecorrente]    = useState(false)
  const [etapas,        setEtapas]        = useState([{ nome: '', prazoDias: 0 }])
  const [saving,        setSaving]        = useState(false)

  const atualizarEtapa = (i, campo, valor) => setEtapas(prev => prev.map((e, idx) => idx === i ? { ...e, [campo]: valor } : e))
  const addEtapa = () => setEtapas(prev => [...prev, { nome: '', prazoDias: (prev.at(-1)?.prazoDias ?? 0) + 2 }])
  const removerEtapa = (i) => setEtapas(prev => prev.filter((_, idx) => idx !== i))

  const podeSalvar = nome.trim() && departamentoId && etapas.every(e => e.nome.trim())

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    try {
      await criarTipoObrigacaoComEtapas({
        departamentoId, nome: nome.trim(), recorrente,
        etapas: etapas.map(e => ({ nome: e.nome.trim(), prazoDias: Number(e.prazoDias) || 0 })),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--accent)', borderRadius:8, padding:12, marginBottom:14 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do tipo (ex: Rescisão Trabalhista)"
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <select value={departamentoId} onChange={e => setDepartamentoId(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }}>
          {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
        </select>
      </div>
      <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text2)', marginBottom:10 }}>
        <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} /> Recorrente (mensal)
      </label>

      <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', marginBottom:6, textTransform:'uppercase', letterSpacing:.4 }}>Etapas (execução → entrega)</div>
      {etapas.map((et, i) => (
        <div key={i} style={{ display:'flex', gap:6, marginBottom:6, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--text3)', width:16 }}>{i+1}.</span>
          <input value={et.nome} onChange={e => atualizarEtapa(i, 'nome', e.target.value)} placeholder="Nome da etapa"
            style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
          <input type="number" value={et.prazoDias} onChange={e => atualizarEtapa(i, 'prazoDias', e.target.value)} title="Dias a partir do início"
            style={{ width:60, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
          <span style={{ fontSize:10, color:'var(--text3)' }}>dias</span>
          {etapas.length > 1 && (
            <button onClick={() => removerEtapa(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)' }}>
              <XIcon size={13} />
            </button>
          )}
        </div>
      ))}
      <button onClick={addEtapa} style={{ background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--text3)', cursor:'pointer', marginTop:2 }}>
        <PlusIcon size={11} style={{ verticalAlign:-1, marginRight:4 }} /> Adicionar etapa
      </button>

      <div style={{ display:'flex', gap:8, marginTop:14 }}>
        <button onClick={onCancel} style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border2)', borderRadius:8, padding:'8px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving || !podeSalvar}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'8px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!podeSalvar)?.6:1 }}>
          {saving ? 'Salvando...' : 'Salvar tipo'}
        </button>
      </div>
    </div>
  )
}

function EtapasDoTipo({ tipo, onChanged }) {
  const [novaEtapa, setNovaEtapa] = useState('')
  const [novoPrazo, setNovoPrazo] = useState(0)
  const [saving,    setSaving]    = useState(false)

  const handleAdd = async () => {
    if (!novaEtapa.trim()) return
    setSaving(true)
    try {
      await adicionarEtapaTemplate(tipo.id, novaEtapa.trim(), Number(novoPrazo) || 0)
      setNovaEtapa(''); setNovoPrazo(0)
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  const handleRemover = async (id) => {
    await excluirEtapaTemplate(id)
    await onChanged()
  }

  return (
    <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
      {tipo.etapas_template.map((et, i) => (
        <div key={et.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', fontSize:12 }}>
          <span style={{ color:'var(--text1)' }}>{i+1}. {et.nome} <span style={{ color:'var(--text3)', fontSize:10.5 }}>({et.prazo_dias_relativo}d)</span></span>
          <button onClick={() => handleRemover(et.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text3)' }}>
            <XIcon size={12} />
          </button>
        </div>
      ))}
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        <input value={novaEtapa} onChange={e => setNovaEtapa(e.target.value)} placeholder="Nova etapa..."
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <input type="number" value={novoPrazo} onChange={e => setNovoPrazo(e.target.value)}
          style={{ width:56, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <button onClick={handleAdd} disabled={saving || !novaEtapa.trim()}
          style={{ background:'var(--navy)', border:'none', borderRadius:8, padding:'6px 10px', fontSize:11, color:'#fff', cursor:'pointer', opacity:(saving||!novaEtapa.trim())?.6:1 }}>
          <PlusIcon size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Modal Base ───────────────────────────────────────────────────────────────
function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(27,43,75,.45)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', width:'100%', maxWidth:400, maxHeight:'90vh', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', background:'#1B2B4B', borderBottom:'1px solid #243660' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'#fff' }}>{titulo}</span>
          <button onClick={onClose}
            style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)', borderRadius:6, width:22, height:22, color:'#8fadd4', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>✕</button>
        </div>
        <div style={{ padding:20, overflowY:'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
