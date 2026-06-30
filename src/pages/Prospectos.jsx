import { useState, useMemo } from 'react'
import { PlusIcon, XIcon, SaveIcon, Trash2Icon, PhoneIcon, CalendarIcon, DollarSignIcon, TagIcon, CheckCircleIcon, GripVerticalIcon } from 'lucide-react'
import { useStore } from '../store'

const STATUS_COLS = [
  { id: 'negociacao',      label: 'Negociação',      color: 'var(--text3)',  bg: 'var(--surface2)' },
  { id: 'proposta_enviada',label: 'Proposta Enviada',color: 'var(--info)',   bg: 'var(--info-dim)' },
  { id: 'aguardando',      label: 'Aguardando',      color: 'var(--warn)',   bg: 'var(--warn-dim)' },
  { id: 'fechado',         label: 'Fechado',         color: 'var(--ok)',     bg: 'var(--ok-dim)'   },
]

const ORIGENS = ['Indicação', 'Site', 'Redes Sociais', 'Networking', 'Anúncio', 'Outro']

function fmtMoeda(v) {
  if (!v) return '—'
  return Number(v).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
}

function fmtData(d) {
  if (!d) return null
  const [y,m,day] = d.split('-')
  return `${day}/${m}/${y}`
}

export default function Prospectos() {
  const prospectos          = useStore(s => s.prospectos || [])
  const addProspecto        = useStore(s => s.addProspecto)
  const updateProspecto     = useStore(s => s.updateProspecto)
  const deleteProspecto     = useStore(s => s.deleteProspecto)
  const converterProspectoEmCliente = useStore(s => s.converterProspectoEmCliente)

  const [showNovo, setShowNovo]       = useState(false)
  const [editando, setEditando]       = useState(null)
  const [dragging, setDragging]       = useState(null)
  const [dragOver, setDragOver]       = useState(null)
  const [confirmConverter, setConfirmConverter] = useState(null)
  const [confirmExcluir, setConfirmExcluir]     = useState(null)

  const porColuna = useMemo(() => {
    const map = {}
    STATUS_COLS.forEach(c => { map[c.id] = [] })
    prospectos.forEach(p => {
      const col = p.status || 'negociacao'
      if (map[col]) map[col].push(p)
      else map['negociacao'].push(p)
    })
    return map
  }, [prospectos])

  const valorTotalPipeline = useMemo(() =>
    prospectos.filter(p => p.status !== 'fechado').reduce((sum, p) => sum + (Number(p.valor_proposto) || 0), 0),
    [prospectos]
  )

  const handleDrop = async (e, colId) => {
    e.preventDefault()
    if (!dragging || dragging.fromCol === colId) { setDragging(null); setDragOver(null); return }
    await updateProspecto(dragging.id, { status: colId })
    setDragging(null)
    setDragOver(null)
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Prospectos</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>
            Pipeline em negociação · <strong style={{ color:'var(--accent)' }}>{fmtMoeda(valorTotalPipeline)}</strong> potencial
          </p>
        </div>
        <button className="btn btn-accent btn-sm" onClick={() => setShowNovo(true)}>
          <PlusIcon size={14} /> Novo Prospecto
        </button>
      </div>

      {/* Board Kanban */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 8,
      }}>
        {STATUS_COLS.map(col => {
          const cards = porColuna[col.id] || []
          const isDragTarget = dragOver === col.id
          const valorCol = cards.reduce((sum, p) => sum + (Number(p.valor_proposto) || 0), 0)
          return (
            <div key={col.id}
              onDragOver={e => { e.preventDefault(); setDragOver(col.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => handleDrop(e, col.id)}
              style={{
                background: isDragTarget ? col.bg : 'var(--surface2)',
                border: `2px solid ${isDragTarget ? col.color : 'var(--border)'}`,
                borderRadius: 'var(--r-lg)',
                padding: '10px 8px',
                display: 'flex', flexDirection: 'column', gap: 8,
                transition: 'border-color .15s, background .15s',
                minWidth: 240,
              }}>

              <div style={{ padding:'0 4px 6px', borderBottom:`2px solid ${col.color}` }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:11, fontWeight:800, color: col.color, textTransform:'uppercase', letterSpacing:'.8px' }}>
                    {col.label}
                  </span>
                  <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', background:'var(--surface3)', borderRadius:99, padding:'1px 8px' }}>
                    {cards.length}
                  </span>
                </div>
                {valorCol > 0 && (
                  <div style={{ fontSize:10, color:'var(--text3)', marginTop:3, fontWeight:600 }}>{fmtMoeda(valorCol)}</div>
                )}
              </div>

              {cards.length === 0 && (
                <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'20px 0', opacity:.6 }}>
                  {isDragTarget ? '⬇ Soltar aqui' : 'Vazio'}
                </div>
              )}

              {cards.map(p => (
                <ProspectoCard
                  key={p.id}
                  prospecto={p}
                  colunas={STATUS_COLS}
                  colAtual={col.id}
                  onOpen={() => setEditando(p)}
                  onDelete={() => setConfirmExcluir(p)}
                  onMove={novaCol => updateProspecto(p.id, { status: novaCol })}
                  onConverter={() => setConfirmConverter(p)}
                  onDragStart={e => { setDragging({ id: p.id, fromCol: col.id }); e.dataTransfer.effectAllowed = 'move' }}
                  isDragging={dragging?.id === p.id}
                />
              ))}
            </div>
          )
        })}
      </div>

      {/* Modal novo/editar */}
      {(showNovo || editando) && (
        <ProspectoModal
          prospecto={editando}
          onClose={() => { setShowNovo(false); setEditando(null) }}
          onSave={async (dados) => {
            if (editando) await updateProspecto(editando.id, dados)
            else await addProspecto(dados)
            setShowNovo(false); setEditando(null)
          }}
        />
      )}

      {/* Confirmar conversão em cliente */}
      {confirmConverter && (
        <ConverterModal
          prospecto={confirmConverter}
          onClose={() => setConfirmConverter(null)}
          onConfirm={async (dadosCliente) => {
            await converterProspectoEmCliente(confirmConverter, dadosCliente)
            setConfirmConverter(null)
          }}
        />
      )}

      {/* Confirmar exclusão */}
      {confirmExcluir && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={() => setConfirmExcluir(null)}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:24, maxWidth:360, width:'100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
              <Trash2Icon size={20} color="var(--danger)" />
              <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>Excluir prospecto</span>
            </div>
            <p style={{ fontSize:13, color:'var(--text2)', marginBottom:20 }}>
              Tem certeza que deseja excluir <strong style={{ color:'var(--text1)' }}>{confirmExcluir.nome}</strong>?
            </p>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn" onClick={() => setConfirmExcluir(null)} style={{ flex:1 }}>Cancelar</button>
              <button onClick={async () => { await deleteProspecto(confirmExcluir.id); setConfirmExcluir(null) }}
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

function ProspectoCard({ prospecto, colunas, colAtual, onOpen, onDelete, onMove, onConverter, onDragStart, isDragging }) {
  const [showMove, setShowMove] = useState(false)
  const dataInicio = fmtData(prospecto.data_inicio_prevista)

  return (
    <div draggable onDragStart={onDragStart} onClick={onOpen}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        padding: '10px 12px', cursor: 'pointer', opacity: isDragging ? 0.4 : 1,
        transition: 'box-shadow .15s', position: 'relative',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; setShowMove(false) }}>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
        <GripVerticalIcon size={12} style={{ color:'var(--text3)', cursor:'grab', flexShrink:0 }} />
        <div style={{ display:'flex', gap:4 }} onClick={e => e.stopPropagation()}>
          {colAtual !== 'fechado' && (
            <button title="Converter em cliente" onClick={onConverter}
              style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 4px', borderRadius:4 }}>
              <CheckCircleIcon size={13} color="var(--ok)" />
            </button>
          )}
          <div style={{ position:'relative' }}>
            <button title="Mover" onClick={e => { e.stopPropagation(); setShowMove(v => !v) }}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text3)', padding:'1px 4px', borderRadius:4 }}>
              ⇄
            </button>
            {showMove && (
              <div style={{ position:'absolute', right:0, top:20, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', zIndex:50, minWidth:150, boxShadow:'var(--shadow-md)' }}>
                {colunas.filter(c => c.id !== colAtual).map(c => (
                  <button key={c.id} onClick={e => { e.stopPropagation(); onMove(c.id); setShowMove(false) }}
                    style={{ display:'block', width:'100%', padding:'7px 12px', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontSize:12, color: c.color, fontWeight:600 }}>
                    → {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 4px', borderRadius:4 }}>
            <Trash2Icon size={11} color="var(--danger)" style={{ opacity:.5 }} />
          </button>
        </div>
      </div>

      <div style={{ fontSize:12, fontWeight:700, color:'var(--text1)', marginBottom:6 }}>
        {prospecto.nome}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
        {prospecto.valor_proposto > 0 && (
          <span style={{ fontSize:11, color:'var(--ok)', fontWeight:700, display:'flex', alignItems:'center', gap:4 }}>
            <DollarSignIcon size={10} /> {fmtMoeda(prospecto.valor_proposto)}
          </span>
        )}
        {prospecto.contato && (
          <span style={{ fontSize:10, color:'var(--text2)', display:'flex', alignItems:'center', gap:4 }}>
            <PhoneIcon size={9} /> {prospecto.contato}
          </span>
        )}
        {dataInicio && (
          <span style={{ fontSize:10, color:'var(--text3)', display:'flex', alignItems:'center', gap:4 }}>
            <CalendarIcon size={9} /> Início: {dataInicio}
          </span>
        )}
        {prospecto.origem && (
          <span style={{ fontSize:9, background:'var(--surface3)', color:'var(--text2)', borderRadius:99, padding:'2px 7px', fontWeight:600, width:'fit-content', display:'flex', alignItems:'center', gap:3 }}>
            <TagIcon size={8} /> {prospecto.origem}
          </span>
        )}
      </div>
    </div>
  )
}

function ProspectoModal({ prospecto, onClose, onSave }) {
  const [nome, setNome]               = useState(prospecto?.nome || '')
  const [contato, setContato]         = useState(prospecto?.contato || '')
  const [valor, setValor]             = useState(prospecto?.valor_proposto || '')
  const [dataInicio, setDataInicio]   = useState(prospecto?.data_inicio_prevista || '')
  const [status, setStatus]           = useState(prospecto?.status || 'negociacao')
  const [origem, setOrigem]           = useState(prospecto?.origem || '')
  const [observacoes, setObservacoes] = useState(prospecto?.observacoes || '')
  const [saving, setSaving]           = useState(false)

  const handleSave = async () => {
    if (!nome.trim()) return
    setSaving(true)
    await onSave({
      nome: nome.trim(),
      contato: contato.trim() || null,
      valor_proposto: valor ? Number(valor) : null,
      data_inicio_prevista: dataInicio || null,
      status,
      origem: origem || null,
      observacoes: observacoes.trim() || null,
    })
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', borderRadius:'var(--r-xl)', width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto', padding:20, boxShadow:'var(--shadow-lg)' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>
            {prospecto ? 'Editar Prospecto' : 'Novo Prospecto'}
          </span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Nome / Empresa *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Padaria São José"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
          </div>

          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Contato (telefone/email)</label>
            <input value={contato} onChange={e => setContato(e.target.value)} placeholder="(31) 99999-9999"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Valor proposto (R$)</label>
              <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Início previsto</label>
              <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }} />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
                <option value="negociacao">Negociação</option>
                <option value="proposta_enviada">Proposta Enviada</option>
                <option value="aguardando">Aguardando</option>
                <option value="fechado">Fechado</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Origem</label>
              <select value={origem} onChange={e => setOrigem(e.target.value)}
                style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}>
                <option value="">— Selecione —</option>
                {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ fontSize:12, color:'var(--text2)', marginBottom:4, display:'block' }}>Observações</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)}
              rows={4} placeholder="Detalhes da negociação, reuniões, pendências..."
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)', resize:'vertical', fontFamily:'inherit' }} />
          </div>
        </div>

        <button className="btn btn-accent" onClick={handleSave} disabled={saving || !nome.trim()}
          style={{ width:'100%', marginTop:16, padding:'10px', fontSize:14 }}>
          <SaveIcon size={14} />
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}

function ConverterModal({ prospecto, onClose, onConfirm }) {
  const [nome, setNome]   = useState(prospecto.nome)
  const [cnpj, setCnpj]   = useState('')
  const [regime, setRegime] = useState('Simples Nacional')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    setSaving(true)
    await onConfirm({ nome, cnpj: cnpj.replace(/\D/g,''), regime })
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:24, maxWidth:400, width:'100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <CheckCircleIcon size={20} color="var(--ok)" />
          <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>Converter em Cliente</span>
        </div>
        <p style={{ fontSize:12, color:'var(--text2)', marginBottom:16 }}>
          Confirme os dados para criar o cadastro de cliente a partir deste prospecto.
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', marginBottom:3, display:'block' }}>Nome / Razão Social</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', marginBottom:3, display:'block' }}>CNPJ</label>
            <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0001-00"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }} />
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', marginBottom:3, display:'block' }}>Regime Tributário</label>
            <select value={regime} onChange={e => setRegime(e.target.value)}
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:13, background:'var(--surface)', color:'var(--text1)' }}>
              <option value="Simples Nacional">Simples Nacional</option>
              <option value="Lucro Presumido">Lucro Presumido</option>
              <option value="Lucro Real">Lucro Real</option>
              <option value="MEI">MEI</option>
            </select>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:18 }}>
          <button className="btn" onClick={onClose} style={{ flex:1 }}>Cancelar</button>
          <button onClick={handleConfirm} disabled={saving}
            style={{ flex:1, background:'var(--ok)', color:'white', border:'none', borderRadius:'var(--r-sm)', padding:'10px', fontWeight:700, cursor:'pointer', fontSize:13 }}>
            {saving ? 'Convertendo...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
