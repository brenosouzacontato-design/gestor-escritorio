import { CheckIcon } from 'lucide-react'
import { useState, useEffect } from 'react'

// ── Badge de status ERP ──────────────────────────────────────────────────────
export function ErpBadge({ status }) {
  if (status === 'fechado') return <span className="badge badge-ok">Fechado</span>
  if (status === 'aberto')  return <span className="badge badge-warn">Aberto</span>
  if (status === 'nao_aplica') return <span className="badge badge-gray">N/A</span>
  return <span className="badge badge-gray">—</span>
}

// ── Chip de departamento ─────────────────────────────────────────────────────
export function DeptChip({ dept }) {
  const map = {
    fiscal: 'Fiscal',
    pessoal: 'Pessoal',
    societario: 'Societário',
    contabil: 'Contábil',
    comunicacao: 'Comunicação',
  }
  return <span className={`chip chip-${dept}`}>{map[dept] || dept}</span>
}

// ── Priority dot ─────────────────────────────────────────────────────────────
export function PriDot({ pri }) {
  return <span className={`pri pri-${pri}`} title={pri} />
}

// ── Avatar ───────────────────────────────────────────────────────────────────
const COLORS = [
  ['#EBF5EE','#1C5F3A'], ['#DBEAFE','#1E40AF'], ['#EDE9FE','#5B21B6'],
  ['#FEF3C7','#92400E'], ['#FFE4E6','#9F1239'], ['#D1FAE5','#065F46'],
]

export function Avatar({ name = '', size = 38, idx = 0 }) {
  const [bg, fg] = COLORS[idx % COLORS.length]
  const initials = name.split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase()
  return (
    <div className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.33 }}>
      {initials}
    </div>
  )
}

// ── Checkbox de tarefa ───────────────────────────────────────────────────────
export function TaskCheck({ done, onToggle }) {
  return (
    <div className={`task-check ${done ? 'done' : ''}`} onClick={onToggle}>
      {done && <CheckIcon size={11} color="white" strokeWidth={3} />}
    </div>
  )
}

// ── Status dots (folha / fiscal / tarefas) ───────────────────────────────────
export function StatusDots({ folha, fiscal, tarefas }) {
  const folhaCls = folha === 'fechado' ? 'sdot-ok' : folha === 'aberto' ? 'sdot-warn' : 'sdot-gray'
  const fiscalCls = fiscal === 'fechado' ? 'sdot-ok' : fiscal === 'aberto' ? 'sdot-warn' : 'sdot-gray'
  const tarefasCls = tarefas === 'alta' ? 'sdot-err' : tarefas === 'media' ? 'sdot-warn' : tarefas === 'ok' ? 'sdot-ok' : 'sdot-gray'
  return (
    <div className="status-dots">
      <div className={`sdot ${folhaCls}`} title="Folha" />
      <div className={`sdot ${fiscalCls}`} title="Fiscal" />
      <div className={`sdot ${tarefasCls}`} title="Tarefas" />
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────
let _addToast = null
export function useToast() {
  const show = (msg) => _addToast?.(msg)
  return { show }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    _addToast = (msg) => {
      const id = Date.now()
      setToasts(t => [...t, { id, msg }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
    }
    return () => { _addToast = null }
  }, [])
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
export function Modal({ onClose, children }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// ── Formatadores ─────────────────────────────────────────────────────────────
export function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export function isOverdue(due) {
  if (!due) return false
  return new Date(due) < new Date(new Date().toDateString())
}

export function clientTaskStatus(tasks = []) {
  const pending = tasks.filter(t => !t.concluida)
  if (pending.some(t => t.prioridade === 'alta')) return 'alta'
  if (pending.length > 0) return 'media'
  if (tasks.length > 0) return 'ok'
  return 'none'
}
