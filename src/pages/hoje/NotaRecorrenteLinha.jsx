// Uma semana de nota recorrente a emitir, na tela "Hoje": digita o valor e emite na hora.
// Mesma ação da tela de emissão (recorrente_emitir em netlify/functions/nfse.js).
import { useState } from 'react'
import { SendIcon } from 'lucide-react'
import { chamarNfse } from '../nfse/nfseApi'

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

export default function NotaRecorrenteLinha({ s, onEmitida }) {
  const [valor, setValor] = useState(s.nota?.valor ? valorBR(s.nota.valor) : valorBR(s.modelo.valor))
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState(null)
  const teste = s.ambiente !== 'producao'
  const problema = s.nota && (s.nota.estado === 'rejeitada' ? s.nota.mensagem : (s.nota.erros || []).join('; '))

  async function emitir() {
    if (!valor.trim()) return
    const ok = window.confirm(`Emitir NFS-e ${teste ? 'em homologação (teste)' : 'em PRODUÇÃO (nota fiscal real)'}?\n\n`
      + `${s.empresa}\npara ${s.modelo.nome}\nSemana ${dataBR(s.inicio)} a ${dataBR(s.fim)}\nValor: ${valor}\n\n${s.descricao}`)
    if (!ok) return
    setEnviando(true)
    setMsg(null)
    try {
      const r = await chamarNfse('recorrente_emitir', { cliente_id: s.cliente_id, id: s.modelo.id, semana: s.inicio, valor, ambiente: s.ambiente })
      if (r.resultado?.estado === 'autorizada') onEmitida(`NFS-e nº ${r.nota?.numero_nfse || ''} emitida · ${s.empresa} · ${brl(r.nota?.valor)}`)
      else setMsg(r.resultado?.mensagem || `Situação: ${r.resultado?.estado}. Confira na tela Emitir NFS-e.`)
    } catch (e) {
      setMsg(e.message)
    } finally { setEnviando(false) }
  }

  return (
    <div className="hoje-linha estatica" style={{ flexWrap: 'wrap', rowGap: 6 }}>
      <span className="hoje-linha-textos" style={{ minWidth: 200 }}>
        <span className="hoje-linha-nome">{s.empresa} · {s.modelo.nome}</span>
        <span className="hoje-linha-desc">
          Semana {dataBR(s.inicio).slice(0, 5)} a {dataBR(s.fim)}
          {teste && <span className="badge badge-warn" style={{ fontSize: 10, marginLeft: 6 }}>homologação</span>}
        </span>
        {(msg || problema) && <span className="hoje-linha-desc" style={{ color: 'var(--danger)' }}>{msg || `Tentativa anterior: ${problema}`}</span>}
      </span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor" inputMode="decimal" aria-label={`Valor da semana de ${s.empresa}`}
          onKeyDown={(e) => { if (e.key === 'Enter') emitir() }}
          style={{ width: 110, textAlign: 'right', padding: '6px 8px' }} />
        <button type="button" className="btn btn-accent" disabled={enviando || !valor.trim()} onClick={emitir}>
          <SendIcon size={14} /> {enviando ? 'Emitindo…' : 'Emitir'}
        </button>
      </span>
    </div>
  )
}
