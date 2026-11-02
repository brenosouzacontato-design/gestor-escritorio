import { useState } from 'react'
import { Modal, DeptChip } from './shared'
import { useStore } from '../store'
import { useToast } from './shared'

const DEPTS = ['fiscal','pessoal','societario','contabil','comunicacao']
const DEPT_LABELS = { fiscal:'Fiscal', pessoal:'Pessoal', societario:'Societário', contabil:'Contábil', comunicacao:'Comunicação' }

// inicial: valores pré-preenchidos (ex.: aba "A revisar" de Documentos passa
// título/observação sugeridos pela IA). onCriada(tarefa): chamado depois de
// salvar, antes de fechar — se lançar erro, o modal mostra e não fecha.
export default function NovaTarefaModal({ onClose, clienteIdInicial = '', inicial = {}, onCriada, titulo = 'Nova tarefa' }) {
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
    ...inicial,
  })
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.titulo.trim()) { show('Informe o título da tarefa'); return }
    setLoading(true)
    // tarefa avulsa (sem cliente) é válida -- cliente_id vazio vira null
    // em vez de mandar '' pra uma coluna uuid (que dá erro no Postgres)
    const { data, error } = await addTarefa({ ...form, cliente_id: form.cliente_id || null, vencimento: form.vencimento || null })
    if (error) { setLoading(false); show('Erro ao salvar tarefa'); return }
    if (onCriada) {
      try {
        await onCriada(data)
      } catch (e) {
        setLoading(false)
        show('Tarefa criada, mas houve erro depois: ' + e.message)
        return
      }
    } else {
      show('Tarefa criada')
    }
    setLoading(false)
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">{titulo}</p>

      <div className="form-field">
        <label className="form-label">Cliente</label>
        <select value={form.cliente_id} onChange={e => set('cliente_id', e.target.value)}>
          <option value="">— Sem cliente (tarefa avulsa) —</option>
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
