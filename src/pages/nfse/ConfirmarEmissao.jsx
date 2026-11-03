// Confirmação da emissão dentro da própria tela (no lugar do window.confirm, que alguns navegadores e
// o app instalado no tablet bloqueiam sem mostrar nada). Usada nas notas recorrentes (tela Hoje e
// Emitir NFS-e).
import { AlertTriangleIcon, SendIcon } from 'lucide-react'

const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function ConfirmarEmissao({ empresa, tomador, documento, inicio, fim, data, valor, descricao, ambiente, enviando, onConfirmar, onCancelar }) {
  const real = ambiente === 'producao'
  return (
    <div role="alertdialog" aria-label="Confirmar emissão da NFS-e"
      style={{ width: '100%', border: `2px solid ${real ? 'var(--danger)' : 'var(--warn)'}`, borderRadius: 10, padding: '10px 12px',
        background: real ? 'var(--danger-dim, var(--surface2))' : 'var(--warn-dim)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, color: real ? 'var(--danger)' : 'var(--warn)' }}>
        <AlertTriangleIcon size={15} /> {real ? 'Emitir em PRODUÇÃO — nota fiscal real' : 'Emitir em homologação (teste)'}
      </div>
      <div style={{ marginTop: 6, lineHeight: 1.5, color: 'var(--text1)' }}>
        {empresa && <div><b>{empresa}</b></div>}
        <div>para <b>{tomador}</b>{documento ? ` · ${documento}` : ''}</div>
        <div>Semana {dataBR(inicio)} a {dataBR(fim)}{data ? ` · data do serviço ${dataBR(data)}` : ''} · <b style={{ fontSize: 15 }}>R$ {valor}</b></div>
        {descricao && <div style={{ color: 'var(--text2)', fontSize: 12 }}>{descricao}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-accent" disabled={enviando} onClick={onConfirmar} autoFocus>
          <SendIcon size={14} /> {enviando ? 'Emitindo…' : 'Confirmar emissão'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={enviando} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}
