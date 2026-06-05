import { useState } from 'react'
import { Modal, DeptChip } from './shared'
import { useStore } from '../store'
import { useToast } from './shared'

const DEPTS = ['fiscal','pessoal','societario','contabil','comunicacao']
const DEPT_LABELS = { fiscal:'Fiscal', pessoal:'Pessoal', societario:'Societário', contabil:'Contábil', comunicacao:'Comunicação' }

export default function NovaTarefaModal({ onClose, clienteIdInicial = '' }) {
  const clientes = useStore(s => s.clientes)
  const addTarefa = useStore(s => s.addTarefa)
  const { show } = useToast()

  const [form, setForm] = useState({
    cliente_id: clienteIdInicial,
    titulo: '',
    descricao: '',
    departamento: 'fiscal',
    prioridade: 'media',
    vencimento: '',
    origem: 'manual',
  })
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.titulo.trim()) { show('Informe o título da tarefa'); return }
    if (!form.cliente_id) { show('Selecione um cliente'); return }
    setLoading(true)
    const { error } = await addTarefa({ ...form, vencimento: form.vencimento || null })
    setLoading(false)
    if (error) { show('Erro ao salvar tarefa'); return }
    show('Tarefa criada')
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Nova tarefa</p>

      <div className="form-field">
        <label className="form-label">Cliente</label>
        <select value={form.cliente_id} onChange={e => set('cliente_id', e.target.value)}>
          <option value="">Selecione...</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      <div className="form-field">
        <label className="form-label">Departamento</label>
        <select value={form.departamento} onChange={e => set('departamento', e.target.value)}>
          {DEPTS.map(d => <option key={d} value={d}>{DEPT_LABELS[d]}</option>)}
        </select>
      </div>

      <div className="form-field">
        <label className="form-label">Título</label>
        <input
          type="text"
          placeholder="Ex: Fechar folha maio/2026"
          value={form.titulo}
          onChange={e => set('titulo', e.target.value)}
          autoFocus
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">Prioridade</label>
          <select value={form.prioridade} onChange={e => set('prioridade', e.target.value)}>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">Vencimento</label>
          <input type="date" value={form.vencimento} onChange={e => set('vencimento', e.target.value)} />
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">Observação (opcional)</label>
        <textarea
          placeholder="Detalhes adicionais..."
          value={form.descricao}
          onChange={e => set('descricao', e.target.value)}
        />
      </div>

      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-accent" onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : 'Salvar tarefa'}
        </button>
      </div>
    </Modal>
  )
}
