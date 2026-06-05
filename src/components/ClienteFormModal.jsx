import { useState } from 'react'
import { Modal, useToast } from './shared'
import { useStore } from '../store'

const REGIMES = ['Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real', 'Imune/Isento']

export default function ClienteFormModal({ onClose, cliente = null }) {
  const addCliente = useStore(s => s.addCliente)
  const updateCliente = useStore(s => s.updateCliente)
  const { show } = useToast()
  const isEdit = !!cliente

  const [form, setForm] = useState({
    nome: cliente?.nome || '',
    cnpj: cliente?.cnpj || '',
    regime: cliente?.regime || 'Simples Nacional',
    email: cliente?.email || '',
    telefone: cliente?.telefone || '',
    responsavel: cliente?.responsavel || '',
  })
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const fmtCNPJ = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 14)
    return d
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }

  const fmtTel = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11)
    if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
    return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
  }

  const submit = async () => {
    if (!form.nome.trim()) { show('Informe o nome do cliente'); return }
    setLoading(true)
    const { error } = isEdit
      ? await updateCliente(cliente.id, form)
      : await addCliente(form)
    setLoading(false)
    if (error) { show('Erro ao salvar cliente'); return }
    show(isEdit ? 'Cliente atualizado' : 'Cliente cadastrado')
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">{isEdit ? 'Editar cliente' : 'Novo cliente'}</p>

      <div className="form-field">
        <label className="form-label">Razão social / Nome *</label>
        <input
          type="text"
          placeholder="Ex: Simple Care Odontologia Ltda"
          value={form.nome}
          onChange={e => set('nome', e.target.value)}
          autoFocus
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">CNPJ / CPF</label>
          <input
            type="text"
            placeholder="00.000.000/0001-00"
            value={form.cnpj}
            onChange={e => set('cnpj', fmtCNPJ(e.target.value))}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Regime tributário</label>
          <select value={form.regime} onChange={e => set('regime', e.target.value)}>
            {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">Responsável / Contato</label>
        <input
          type="text"
          placeholder="Nome do sócio ou responsável"
          value={form.responsavel}
          onChange={e => set('responsavel', e.target.value)}
        />
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">E-mail</label>
          <input
            type="email"
            placeholder="email@empresa.com"
            value={form.email}
            onChange={e => set('email', e.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="form-label">Telefone</label>
          <input
            type="text"
            placeholder="(31) 99999-0000"
            value={form.telefone}
            onChange={e => set('telefone', fmtTel(e.target.value))}
          />
        </div>
      </div>

      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-accent" onClick={submit} disabled={loading}>
          {loading ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Cadastrar cliente'}
        </button>
      </div>
    </Modal>
  )
}
