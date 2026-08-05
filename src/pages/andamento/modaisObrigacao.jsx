import { useState, useEffect } from 'react'
import { PlusIcon, SaveIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  listarTiposObrigacao, criarTipoObrigacaoComEtapas, criarObrigacaoComEtapas,
  calcularVencimento, criarTarefasLote, criarObrigacoesLote,
} from './andamentoApi'

// Modais de programação de obrigações/tarefas do modelo novo (departamentos
// + tipos_obrigacao) — extraídos de Empresas.jsx pra serem reaproveitados
// também em Clientes.jsx (ver ClienteDetalhe), sem duplicar a lógica de
// criação de tipo/etapas/vencimento em dois lugares.

// ── Modal Nova Obrigação (uma empresa) ───────────────────────────────────────
export function NovaObrigacaoModal({ cliente, dept, departamentos, competencia, onClose, onSaved }) {
  const [departamentoId, setDepartamentoId] = useState(dept?.id || departamentos[0]?.id || '')
  const [tipos,          setTipos]          = useState([])
  const [tipoId,         setTipoId]         = useState('')
  const [criandoNovo,    setCriandoNovo]    = useState(false)
  const [novoNome,       setNovoNome]       = useState('')
  const [novaPeriodicidade, setNovaPeriodicidade] = useState('mensal')
  const [recorrente,     setRecorrente]     = useState(true)
  const [mesVencimento,  setMesVencimento]  = useState('mesmo')
  const [diaVencimento,  setDiaVencimento]  = useState('')
  const [diasLembrete,   setDiasLembrete]   = useState(3)
  const [prazoDias,      setPrazoDias]      = useState(15) // usado só quando não é recorrente (vencimento fixo dia/mês não se aplica)
  const [saving,         setSaving]         = useState(false)
  const [erro,           setErro]           = useState(null)

  useEffect(() => {
    if (!departamentoId) { setTipos([]); setTipoId(''); return }
    listarTiposObrigacao(departamentoId).then(setTipos).catch(() => {})
  }, [departamentoId])

  const podeSalvar = departamentoId && (criandoNovo ? novoNome.trim() : tipoId)

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    setErro(null)
    try {
      let tipoObrigacaoId = tipoId
      let nomeTipo = tipos.find(t => t.id === tipoId)?.nome
      let vencimentoUnico = null
      if (criandoNovo) {
        const novoTipo = await criarTipoObrigacaoComEtapas({
          departamentoId, nome: novoNome.trim(), recorrente,
          periodicidade: recorrente ? novaPeriodicidade : null,
          mesVencimento: recorrente ? mesVencimento : null,
          diaVencimento: recorrente ? diaVencimento : null,
          diasLembrete: recorrente ? diasLembrete : null,
          etapas: [{ nome: 'Concluir', prazoDias: recorrente ? 0 : (Number(prazoDias) || 0) }],
        })
        tipoObrigacaoId = novoTipo.id
        nomeTipo = novoTipo.nome
        if (recorrente && diaVencimento) vencimentoUnico = calcularVencimento(competencia, mesVencimento, Number(diaVencimento))
      } else {
        const tipoEscolhido = tipos.find(t => t.id === tipoId)
        if (tipoEscolhido?.dia_vencimento) {
          vencimentoUnico = calcularVencimento(competencia, tipoEscolhido.mes_vencimento || 'mesmo', tipoEscolhido.dia_vencimento)
        }
      }
      await criarObrigacaoComEtapas({
        clienteId: cliente.id, tipoObrigacaoId, departamentoId,
        titulo: nomeTipo || 'Obrigação', competencia, vencimentoUnico,
      })
      onSaved()
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Nova obrigação — ${cliente.nome.split(' ')[0]}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Módulo</label>
          <select value={departamentoId} onChange={e => setDepartamentoId(e.target.value)}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
            {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
          </select>
        </div>

        {!criandoNovo && (
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de obrigação</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)} disabled={!departamentoId}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="">{tipos.length ? 'Selecione...' : 'Nenhum tipo cadastrado ainda'}</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}{t.periodicidade ? ` (${t.periodicidade})` : ''}</option>)}
            </select>
            <button onClick={() => setCriandoNovo(true)}
              style={{ marginTop:8, background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>
              <PlusIcon size={11} style={{ verticalAlign:-1, marginRight:4 }} /> Criar tipo novo
            </button>
          </div>
        )}

        {criandoNovo && (
          <div style={{ background:'var(--surface2)', border:'1px dashed var(--border2)', borderRadius:8, padding:10 }}>
            <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do tipo (ex: PGDAS)"
              style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none', marginBottom:8 }} />
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text2)', marginBottom:8 }}>
              <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} /> Recorrente
            </label>
            {recorrente && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Periodicidade</label>
                    <select value={novaPeriodicidade} onChange={e => setNovaPeriodicidade(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Lembrete (dias antes)</label>
                    <input type="number" value={diasLembrete} onChange={e => setDiasLembrete(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                  </div>
                </div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:4 }}>
                  <select value={mesVencimento} onChange={e => setMesVencimento(e.target.value)}
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                    <option value="mesmo">Mês da competência</option>
                    <option value="seguinte">Mês seguinte</option>
                  </select>
                  <input type="number" min={1} max={31} value={diaVencimento} onChange={e => setDiaVencimento(e.target.value)} placeholder="Dia"
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                </div>
              </>
            )}
            {!recorrente && (
              <div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento (dias após início)</label>
                <input type="number" value={prazoDias} onChange={e => setPrazoDias(e.target.value)}
                  style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
              </div>
            )}
            <button onClick={() => setCriandoNovo(false)}
              style={{ marginTop:6, background:'none', border:'none', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>← usar tipo existente</button>
          </div>
        )}

        <div style={{ fontSize:10, color:'var(--text3)' }}>Competência: <strong style={{ color:'var(--text2)' }}>{competencia}</strong></div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!podeSalvar}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!podeSalvar)?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving?'Salvando...':'Salvar'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Nova Tarefa (por módulo, uma empresa) ─────────────────────────────
export function NovaTarefaModuloModal({ cliente, dept, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState('')
  const [departamento, setDepartamento] = useState(dept?.nome?.toLowerCase() || 'geral')
  const [prioridade,   setPrioridade]   = useState('normal')
  const [vencimento,   setVencimento]   = useState('')
  const [observacao,   setObservacao]   = useState('')
  const [saving,       setSaving]       = useState(false)

  const handleSave = async () => {
    if (!titulo.trim()) return
    setSaving(true)
    await supabase.from('tarefas').insert({
      titulo: titulo.trim(), departamento, departamento_id: dept?.id || null, prioridade,
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
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!titulo.trim()}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!titulo.trim())?.6:1 }}>
          <SaveIcon size={13} style={{ marginRight:5, verticalAlign:-2 }} />
          {saving?'Salvando...':'Criar tarefa'}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Tarefas em Lote (por módulo, várias empresas) ─────────────────────
export function ModalTarefasLote({ dept, clientes, onClose, onSaved }) {
  const [titulo,       setTitulo]       = useState('')
  const [prioridade,   setPrioridade]   = useState('normal')
  const [vencimento,   setVencimento]   = useState('')
  const [busca,        setBusca]        = useState('')
  const [clientesSel,  setClientesSel]  = useState([])
  const [saving,       setSaving]       = useState(false)
  const [erro,         setErro]         = useState(null)

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const handleSave = async () => {
    if (!titulo.trim() || clientesSel.length === 0) return
    setSaving(true)
    setErro(null)
    try {
      await criarTarefasLote({
        clienteIds: clientesSel, departamentoId: dept.id,
        titulo: titulo.trim(), prioridade, vencimento: vencimento || null,
      })
      onSaved()
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`Tarefas em lote — ${dept.icone||''} ${dept.nome}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Título *</label>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus
            placeholder="Ex: Solicitar documentos do mês"
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Prioridade</label>
            <select value={prioridade} onChange={e => setPrioridade(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Vencimento</label>
            <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
            Empresas ({clientesSel.length}/{clientes.length})
          </span>
          <button onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}
            style={{ background:'none', border:'none', fontSize:11, color:'var(--accent)', cursor:'pointer' }}>
            {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
          </button>
        </div>
        <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
          {clientesFiltrados.map(c => (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <span style={{ fontSize:12, flex:1, color:'var(--text1)' }}>{c.nome}</span>
            </label>
          ))}
        </div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!titulo.trim()||clientesSel.length===0}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!titulo.trim()||clientesSel.length===0)?.6:1 }}>
          {saving?'Criando...':`Criar para ${clientesSel.length} empresa${clientesSel.length!==1?'s':''}`}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Obrigações em Lote (escolha manual de empresas + tipo) ────────────
export function ModalObrigacoesLote({ departamentos, clientes, competenciaInicial, onClose, onSaved }) {
  const [departamentoId, setDepartamentoId] = useState(departamentos[0]?.id || '')
  const [tipos,          setTipos]          = useState([])
  const [tipoId,         setTipoId]         = useState('')
  const [criandoNovo,    setCriandoNovo]    = useState(false)
  const [novoNome,       setNovoNome]       = useState('')
  const [novaPeriodicidade, setNovaPeriodicidade] = useState('mensal')
  const [recorrente,     setRecorrente]     = useState(true)
  const [mesVencimento,  setMesVencimento]  = useState('mesmo')
  const [diaVencimento,  setDiaVencimento]  = useState('')
  const [diasLembrete,   setDiasLembrete]   = useState(3)
  const [prazoDias,      setPrazoDias]      = useState(15) // usado só quando não é recorrente
  const [competencia,    setCompetencia]    = useState(competenciaInicial)
  const [busca,          setBusca]          = useState('')
  const [clientesSel,    setClientesSel]    = useState([])
  const [saving,         setSaving]         = useState(false)
  const [erro,           setErro]           = useState(null)

  useEffect(() => {
    if (!departamentoId) { setTipos([]); setTipoId(''); return }
    listarTiposObrigacao(departamentoId).then(setTipos).catch(() => {})
  }, [departamentoId])

  const clientesFiltrados = clientes.filter(c => c.nome.toLowerCase().includes(busca.toLowerCase()))
  const toggleCliente = id => setClientesSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const podeSalvar = departamentoId && clientesSel.length > 0 && (criandoNovo ? novoNome.trim() : tipoId)

  const handleSave = async () => {
    if (!podeSalvar) return
    setSaving(true)
    setErro(null)
    try {
      let tipoObrigacaoId = tipoId
      let nomeTipo = tipos.find(t => t.id === tipoId)?.nome
      let mesVencimentoFinal = null, diaVencimentoFinal = null
      if (criandoNovo) {
        const novoTipo = await criarTipoObrigacaoComEtapas({
          departamentoId, nome: novoNome.trim(), recorrente,
          periodicidade: recorrente ? novaPeriodicidade : null,
          mesVencimento: recorrente ? mesVencimento : null,
          diaVencimento: recorrente ? diaVencimento : null,
          diasLembrete: recorrente ? diasLembrete : null,
          etapas: [{ nome: 'Concluir', prazoDias: recorrente ? 0 : (Number(prazoDias) || 0) }],
        })
        tipoObrigacaoId = novoTipo.id
        nomeTipo = novoTipo.nome
        if (recorrente && diaVencimento) { mesVencimentoFinal = mesVencimento; diaVencimentoFinal = Number(diaVencimento) }
      } else {
        const tipoEscolhido = tipos.find(t => t.id === tipoId)
        if (tipoEscolhido?.dia_vencimento) { mesVencimentoFinal = tipoEscolhido.mes_vencimento || 'mesmo'; diaVencimentoFinal = tipoEscolhido.dia_vencimento }
      }
      const resultado = await criarObrigacoesLote({
        clienteIds: clientesSel, tipoObrigacaoId, departamentoId,
        titulo: nomeTipo || 'Obrigação', competencia,
        mesVencimento: mesVencimentoFinal, diaVencimento: diaVencimentoFinal,
      })
      onSaved(resultado)
    } catch (e) { setErro(e.message) }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo="Obrigações em lote">
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Módulo</label>
            <select value={departamentoId} onChange={e => { setDepartamentoId(e.target.value); setTipoId('') }}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              {departamentos.map(d => <option key={d.id} value={d.id}>{d.icone} {d.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Competência</label>
            <input value={competencia} onChange={e => setCompetencia(e.target.value)} placeholder="MM/AAAA"
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          </div>
        </div>

        {!criandoNovo && (
          <div>
            <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Tipo de obrigação</label>
            <select value={tipoId} onChange={e => setTipoId(e.target.value)} disabled={!departamentoId}
              style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }}>
              <option value="">{tipos.length ? 'Selecione...' : 'Nenhum tipo cadastrado ainda'}</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}{t.periodicidade ? ` (${t.periodicidade})` : ''}</option>)}
            </select>
            <button onClick={() => setCriandoNovo(true)}
              style={{ marginTop:8, background:'none', border:'1px dashed var(--border2)', borderRadius:6, padding:'5px 10px', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>
              <PlusIcon size={11} style={{ verticalAlign:-1, marginRight:4 }} /> Criar tipo novo
            </button>
          </div>
        )}

        {criandoNovo && (
          <div style={{ background:'var(--surface2)', border:'1px dashed var(--border2)', borderRadius:8, padding:10 }}>
            <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome do tipo (ex: PGDAS)"
              style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none', marginBottom:8 }} />
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text2)', marginBottom:8 }}>
              <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} /> Recorrente
            </label>
            {recorrente && (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8 }}>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Periodicidade</label>
                    <select value={novaPeriodicidade} onChange={e => setNovaPeriodicidade(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Lembrete (dias antes)</label>
                    <input type="number" value={diasLembrete} onChange={e => setDiasLembrete(e.target.value)}
                      style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                  </div>
                </div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:4 }}>
                  <select value={mesVencimento} onChange={e => setMesVencimento(e.target.value)}
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }}>
                    <option value="mesmo">Mês da competência</option>
                    <option value="seguinte">Mês seguinte</option>
                  </select>
                  <input type="number" min={1} max={31} value={diaVencimento} onChange={e => setDiaVencimento(e.target.value)} placeholder="Dia"
                    style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
                </div>
              </>
            )}
            {!recorrente && (
              <div>
                <label style={{ fontSize:10, color:'var(--text3)', display:'block', marginBottom:3 }}>Vencimento (dias após início)</label>
                <input type="number" value={prazoDias} onChange={e => setPrazoDias(e.target.value)}
                  style={{ width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 8px', fontSize:12, color:'var(--text1)', outline:'none' }} />
              </div>
            )}
            <button onClick={() => setCriandoNovo(false)}
              style={{ marginTop:6, background:'none', border:'none', fontSize:11, color:'var(--text3)', cursor:'pointer' }}>← usar tipo existente</button>
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>
            Empresas ({clientesSel.length}/{clientes.length})
          </span>
          <button onClick={() => setClientesSel(clientesSel.length === clientes.length ? [] : clientes.map(c => c.id))}
            style={{ background:'none', border:'none', fontSize:11, color:'var(--accent)', cursor:'pointer' }}>
            {clientesSel.length === clientes.length ? 'Desmarcar' : 'Todos'}
          </button>
        </div>
        <input placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'7px 9px', fontSize:12, color:'var(--text1)', outline:'none' }} />
        <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
          {clientesFiltrados.map(c => (
            <label key={c.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', background: clientesSel.includes(c.id) ? 'var(--accent-dim)' : 'transparent' }}>
              <input type="checkbox" checked={clientesSel.includes(c.id)} onChange={() => toggleCliente(c.id)} />
              <span style={{ fontSize:12, flex:1, color:'var(--text1)' }}>{c.nome}</span>
            </label>
          ))}
        </div>
        {erro && <p style={{ color:'var(--danger)', fontSize:12, margin:0 }}>{erro}</p>}
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!podeSalvar}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!podeSalvar)?.6:1 }}>
          {saving?'Criando...':`Criar para ${clientesSel.length} empresa${clientesSel.length!==1?'s':''}`}
        </button>
      </div>
    </ModalBase>
  )
}

// ── Modal Base ───────────────────────────────────────────────────────────────
export function ModalBase({ onClose, titulo, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'var(--overlay)', zIndex:2000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
        overflow:'hidden', width:'100%', maxWidth:400, maxHeight:'90vh', display:'flex', flexDirection:'column' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'12px 16px', background:'var(--navy)', borderBottom:'1px solid var(--navy2)' }}>
          <span style={{ fontSize:13, fontWeight:500, color:'#fff' }}>{titulo}</span>
          <button onClick={onClose}
            style={{ background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.15)',
              borderRadius:6, width:22, height:22, color:'var(--navy-text)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>✕</button>
        </div>
        <div style={{ padding:20, overflowY:'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
