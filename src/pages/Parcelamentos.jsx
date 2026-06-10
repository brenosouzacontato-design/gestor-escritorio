import { useState, useMemo, useEffect } from 'react'
import { PlusIcon, XIcon, CheckIcon, AlertCircleIcon, ClockIcon, CheckCircleIcon, PencilIcon, ChevronDownIcon, ChevronUpIcon, TrashIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useStore } from '../store'
import { Avatar, useToast } from '../components/shared'

const STATUS_PARC = {
  ativo:        { label: 'Ativo',        color: 'var(--info)',   bg: 'var(--info-dim)' },
  quitado:      { label: 'Quitado',      color: 'var(--ok)',     bg: 'var(--ok-dim)' },
  cancelado:    { label: 'Cancelado',    color: 'var(--text3)',  bg: 'var(--surface2)' },
  inadimplente: { label: 'Inadimplente', color: 'var(--danger)', bg: 'var(--danger-dim)' },
}

const STATUS_PARCELA = {
  pendente:  { label: 'Pendente', color: 'var(--warn)',   Icon: ClockIcon },
  pago:      { label: 'Pago',     color: 'var(--ok)',     Icon: CheckCircleIcon },
  atrasado:  { label: 'Atrasado', color: 'var(--danger)', Icon: AlertCircleIcon },
  cancelado: { label: 'Cancelado',color: 'var(--text3)',  Icon: XIcon },
}

const TIPOS_PARC = ['PGDAS', 'DARF', 'Simples Nacional', 'FGTS', 'INSS', 'ISS', 'Outro']

function fmtMoeda(v) {
  if (!v) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function Parcelamentos() {
  const clientes = useStore(s => s.clientes)
  const { show } = useToast()

  const [parcelamentos, setParcelamentos] = useState([])
  const [parcelas, setParcelas]           = useState({}) // { parcelamento_id: [] }
  const [loading, setLoading]             = useState(true)
  const [filtroStatus, setFiltroStatus]   = useState('todos')
  const [filtroCliente, setFiltroCliente] = useState('todos')
  const [expandido, setExpandido]         = useState(null)
  const [showForm, setShowForm]           = useState(false)
  const [editando, setEditando]           = useState(null)

  const fetchParcelamentos = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('parcelamentos')
      .select('*, clientes(nome)')
      .order('created_at', { ascending: false })
    if (!error) setParcelamentos(data || [])
    setLoading(false)
  }

  const fetchParcelas = async (parcelamentoId) => {
    const { data } = await supabase
      .from('parcelamento_parcelas')
      .select('*')
      .eq('parcelamento_id', parcelamentoId)
      .order('numero')
    if (data) setParcelas(p => ({ ...p, [parcelamentoId]: data }))
  }

  useEffect(() => { fetchParcelamentos() }, [])

  const toggleExpandir = async (id) => {
    if (expandido === id) { setExpandido(null); return }
    setExpandido(id)
    if (!parcelas[id]) await fetchParcelas(id)
  }

  const handlePagarParcela = async (parcelamentoId, parcelaId, novoStatus) => {
    await supabase.from('parcelamento_parcelas')
      .update({ status: novoStatus, data_pagamento: novoStatus === 'pago' ? new Date().toISOString().split('T')[0] : null, updated_at: new Date().toISOString() })
      .eq('id', parcelaId)
    await fetchParcelas(parcelamentoId)

    // Verificar se todas pagas → quitado
    const { data: todas } = await supabase.from('parcelamento_parcelas').select('status').eq('parcelamento_id', parcelamentoId)
    if (todas?.every(p => p.status === 'pago')) {
      await supabase.from('parcelamentos').update({ status: 'quitado', updated_at: new Date().toISOString() }).eq('id', parcelamentoId)
      fetchParcelamentos()
      show('Parcelamento quitado!')
    }
  }

  const handleExcluir = async (id) => {
    if (!confirm('Excluir este parcelamento?')) return
    await supabase.from('parcelamentos').delete().eq('id', id)
    fetchParcelamentos()
    show('Excluído')
  }

  const filtrados = useMemo(() => parcelamentos.filter(p => {
    if (filtroStatus !== 'todos' && p.status !== filtroStatus) return false
    if (filtroCliente !== 'todos' && p.cliente_id !== filtroCliente) return false
    return true
  }), [parcelamentos, filtroStatus, filtroCliente])

  const stats = useMemo(() => ({
    ativos:   parcelamentos.filter(p => p.status === 'ativo').length,
    inadimpl: parcelamentos.filter(p => p.status === 'inadimplente').length,
    quitados: parcelamentos.filter(p => p.status === 'quitado').length,
  }), [parcelamentos])

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:'var(--text1)', letterSpacing:'-0.5px' }}>Parcelamentos</h2>
          <p style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>Controle de débitos parcelados</p>
        </div>
        <button className="btn btn-accent btn-sm" onClick={() => setShowForm(true)}>
          <PlusIcon size={13} /> Novo
        </button>
      </div>

      {/* Stats */}
      <div className="metrics-grid" style={{ gridTemplateColumns:'repeat(3,1fr)', marginBottom:16 }}>
        <div className="metric">
          <div className="metric-label">Ativos</div>
          <div className="metric-value" style={{ color:'var(--info)' }}>{stats.ativos}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Inadimpl.</div>
          <div className={`metric-value ${stats.inadimpl > 0 ? 'danger' : ''}`}>{stats.inadimpl}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Quitados</div>
          <div className="metric-value ok">{stats.quitados}</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
        <div className="tabs" style={{ marginBottom:0 }}>
          {['todos','ativo','inadimplente','quitado','cancelado'].map(s => (
            <button key={s} className={`tab-btn ${filtroStatus===s?'active':''}`} onClick={() => setFiltroStatus(s)}>
              {s === 'todos' ? 'Todos' : STATUS_PARC[s]?.label || s}
            </button>
          ))}
        </div>
        <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
          style={{ padding:'6px 10px', borderRadius:'var(--r-sm)', border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text1)', fontSize:12 }}>
          <option value="todos">— Todas as empresas —</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {/* Lista */}
      {loading && <div className="center"><div className="spinner" /></div>}

      {!loading && filtrados.length === 0 && (
        <div className="empty">
          <p>📋</p>
          <p>Nenhum parcelamento cadastrado</p>
          <button className="btn btn-accent" style={{ marginTop:12 }} onClick={() => setShowForm(true)}>
            Cadastrar parcelamento
          </button>
        </div>
      )}

      {filtrados.map((p, i) => {
        const cfg = STATUS_PARC[p.status] || STATUS_PARC.ativo
        const parcsDoP = parcelas[p.id] || []
        const pagas = parcsDoP.filter(x => x.status === 'pago').length
        const atrasadas = parcsDoP.filter(x => x.status === 'atrasado').length
        const progresso = p.total_parcelas > 0 ? Math.round((p.parcela_atual - 1) / p.total_parcelas * 100) : 0

        return (
          <div key={p.id} className="card" style={{ marginBottom:8 }}>
            {/* Cabeçalho */}
            <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
              <Avatar name={p.clientes?.nome || '?'} size={36} idx={i} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:'var(--text1)' }}>{p.clientes?.nome}</span>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:99, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  <span style={{ fontSize:11, padding:'2px 8px', borderRadius:99, background:'var(--surface2)', color:'var(--text2)' }}>{p.tipo}</span>
                </div>
                {p.numero_processo && (
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Proc: {p.numero_processo}</div>
                )}
                {p.descricao && (
                  <div style={{ fontSize:12, color:'var(--text2)', marginTop:3 }}>{p.descricao}</div>
                )}

                {/* Progresso */}
                <div style={{ marginTop:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontSize:10, color:'var(--text3)' }}>
                      Parcela {p.parcela_atual}/{p.total_parcelas}
                      {p.valor_parcela && ` · ${fmtMoeda(p.valor_parcela)}/mês`}
                    </span>
                    {atrasadas > 0 && (
                      <span style={{ fontSize:10, fontWeight:700, color:'var(--danger)' }}>⚠ {atrasadas} atrasada{atrasadas !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div style={{ height:4, background:'var(--surface2)', borderRadius:99 }}>
                    <div style={{ height:'100%', width:`${progresso}%`, background: atrasadas > 0 ? 'var(--danger)' : 'var(--ok)', borderRadius:99, transition:'width .4s' }} />
                  </div>
                </div>
              </div>

              <div style={{ display:'flex', gap:4 }}>
                <button className="btn btn-icon btn-ghost" onClick={() => setEditando(p)} title="Editar">
                  <PencilIcon size={13} />
                </button>
                <button className="btn btn-icon btn-ghost" style={{ color:'var(--danger)' }} onClick={() => handleExcluir(p.id)} title="Excluir">
                  <TrashIcon size={13} />
                </button>
                <button className="btn btn-icon btn-ghost" onClick={() => toggleExpandir(p.id)}>
                  {expandido === p.id ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
                </button>
              </div>
            </div>

            {/* Parcelas expandidas */}
            {expandido === p.id && (
              <div style={{ marginTop:12, borderTop:'1px solid var(--border)', paddingTop:12 }}>
                {parcsDoP.length === 0 && (
                  <div style={{ textAlign:'center', color:'var(--text3)', fontSize:12, padding:'12px 0' }}>
                    Carregando parcelas...
                  </div>
                )}
                <div style={{ display:'grid', gap:6 }}>
                  {parcsDoP.map(parcela => {
                    const scfg = STATUS_PARCELA[parcela.status] || STATUS_PARCELA.pendente
                    const vencida = parcela.status === 'pendente' && parcela.vencimento < new Date().toISOString().split('T')[0]
                    return (
                      <div key={parcela.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', background: vencida ? 'var(--danger-dim)' : 'var(--surface2)', borderRadius:'var(--r-sm)', border:`1px solid ${vencida ? 'rgba(248,113,113,.2)' : 'var(--border)'}` }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', width:20, textAlign:'center' }}>{parcela.numero}</span>
                        <span style={{ fontSize:11, color:'var(--text2)', flex:1 }}>
                          Venc. {fmtData(parcela.vencimento)}
                          {parcela.valor && ` · ${fmtMoeda(parcela.valor)}`}
                          {parcela.data_pagamento && ` · Pago em ${fmtData(parcela.data_pagamento)}`}
                        </span>
                        <span style={{ fontSize:10, fontWeight:700, color: scfg.color, display:'flex', alignItems:'center', gap:3 }}>
                          <scfg.Icon size={10} /> {scfg.label}
                        </span>
                        {parcela.status === 'pendente' && (
                          <button className="btn btn-sm btn-ok" style={{ padding:'3px 8px', fontSize:10 }}
                            onClick={() => handlePagarParcela(p.id, parcela.id, 'pago')}>
                            ✓ Pagar
                          </button>
                        )}
                        {parcela.status === 'pago' && (
                          <button className="btn btn-sm btn-ghost" style={{ padding:'3px 8px', fontSize:10, color:'var(--text3)' }}
                            onClick={() => handlePagarParcela(p.id, parcela.id, 'pendente')}>
                            ↩ Desfazer
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Modals */}
      {showForm && (
        <FormParcelamento
          clientes={clientes}
          onClose={() => setShowForm(false)}
          onSaved={() => { fetchParcelamentos(); setShowForm(false); show('Parcelamento criado!') }}
        />
      )}

      {editando && (
        <FormParcelamento
          clientes={clientes}
          parcelamento={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { fetchParcelamentos(); setEditando(null); show('Atualizado!') }}
        />
      )}
    </div>
  )
}

// ── Formulário de Parcelamento ──────────────────────────────────────────────
function FormParcelamento({ clientes, parcelamento, onClose, onSaved }) {
  const { show } = useToast()
  const [clienteId, setClienteId]       = useState(parcelamento?.cliente_id || '')
  const [tipo, setTipo]                 = useState(parcelamento?.tipo || 'PGDAS')
  const [tipoCustom, setTipoCustom]     = useState('')
  const [descricao, setDescricao]       = useState(parcelamento?.descricao || '')
  const [processo, setProcesso]         = useState(parcelamento?.numero_processo || '')
  const [totalParcelas, setTotalParcelas] = useState(parcelamento?.total_parcelas || 12)
  const [parcelaAtual, setParcelaAtual] = useState(parcelamento?.parcela_atual || 1)
  const [valorParcela, setValorParcela] = useState(parcelamento?.valor_parcela || '')
  const [vencDia, setVencDia]           = useState(parcelamento?.vencimento_dia || 20)
  const [dataInicio, setDataInicio]     = useState(parcelamento?.data_inicio || new Date().toISOString().split('T')[0])
  const [status, setStatus]             = useState(parcelamento?.status || 'ativo')
  const [obs, setObs]                   = useState(parcelamento?.observacao || '')
  const [saving, setSaving]             = useState(false)

  const tipoFinal = tipo === 'Outro' ? tipoCustom : tipo

  const handleSalvar = async () => {
    if (!clienteId) { show('Selecione a empresa'); return }
    if (!tipoFinal) { show('Informe o tipo'); return }
    setSaving(true)
    try {
      const payload = {
        cliente_id: clienteId,
        tipo: tipoFinal,
        descricao: descricao || null,
        numero_processo: processo || null,
        total_parcelas: parseInt(totalParcelas),
        parcela_atual: parseInt(parcelaAtual),
        valor_parcela: valorParcela ? parseFloat(String(valorParcela).replace(',','.')) : null,
        vencimento_dia: parseInt(vencDia),
        data_inicio: dataInicio || null,
        status,
        observacao: obs || null,
        updated_at: new Date().toISOString(),
      }

      if (parcelamento?.id) {
        await supabase.from('parcelamentos').update(payload).eq('id', parcelamento.id)
      } else {
        const { data: novoParc, error } = await supabase.from('parcelamentos').insert(payload).select().single()
        if (error) throw error

        // Gerar parcelas automaticamente
        const parcelas = []
        const [anoI, mesI] = dataInicio.split('-')
        for (let i = parseInt(parcelaAtual) - 1; i < parseInt(totalParcelas); i++) {
          const d = new Date(parseInt(anoI), parseInt(mesI) - 1 + (i - parseInt(parcelaAtual) + 1), parseInt(vencDia))
          parcelas.push({
            parcelamento_id: novoParc.id,
            numero: i + 1,
            vencimento: d.toISOString().split('T')[0],
            valor: valorParcela ? parseFloat(String(valorParcela).replace(',','.')) : null,
            status: i < parseInt(parcelaAtual) - 1 ? 'pago' : 'pendente',
          })
        }
        if (parcelas.length > 0) {
          await supabase.from('parcelamento_parcelas').insert(parcelas)
        }
      }
      onSaved()
    } catch(e) { show('Erro: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', backdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl) var(--r-xl) 0 0', width:'100%', maxWidth:600, padding:20, maxHeight:'90vh', overflowY:'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <span style={{ fontWeight:700, fontSize:15, color:'var(--text1)' }}>
            {parcelamento ? 'Editar parcelamento' : 'Novo parcelamento'}
          </span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={16} /></button>
        </div>

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
              <label className="form-label">Tipo de débito</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)}>
                {TIPOS_PARC.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {tipo === 'Outro' && (
              <div>
                <label className="form-label">Especifique</label>
                <input value={tipoCustom} onChange={e => setTipoCustom(e.target.value)} placeholder="Ex: ISS Municipal" />
              </div>
            )}
            <div>
              <label className="form-label">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                {Object.entries(STATUS_PARC).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Nº do processo / parcelamento</label>
            <input value={processo} onChange={e => setProcesso(e.target.value)} placeholder="Ex: 10600-721.969/2026-50" />
          </div>

          <div>
            <label className="form-label">Descrição (opcional)</label>
            <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Parcelamento PGDAS 2023-2024" />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            <div>
              <label className="form-label">Total parcelas</label>
              <input type="number" value={totalParcelas} onChange={e => setTotalParcelas(e.target.value)} min={1} />
            </div>
            <div>
              <label className="form-label">Parcela atual</label>
              <input type="number" value={parcelaAtual} onChange={e => setParcelaAtual(e.target.value)} min={1} />
            </div>
            <div>
              <label className="form-label">Dia vencimento</label>
              <input type="number" value={vencDia} onChange={e => setVencDia(e.target.value)} min={1} max={28} />
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="form-label">Valor da parcela (R$)</label>
              <input value={valorParcela} onChange={e => setValorParcela(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="form-label">Data início</label>
              <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="form-label">Observações</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Anotações adicionais..." />
          </div>
        </div>

        <button className="btn btn-accent" onClick={handleSalvar} disabled={saving}
          style={{ width:'100%', marginTop:16, padding:'11px', fontWeight:700 }}>
          {saving ? 'Salvando...' : parcelamento ? 'Salvar alterações' : 'Criar parcelamento'}
        </button>
      </div>
    </div>
  )
}
