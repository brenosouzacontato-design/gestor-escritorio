import { useState, useMemo } from 'react'
import { SearchIcon, EyeIcon, Share2Icon, MonitorIcon } from 'lucide-react'
import { useStore } from '../../store'
import PainelViewerModal from './PainelViewerModal'

// Módulo dedicado a navegar pelos painéis dos clientes e compartilhá-los —
// antes só dava pra abrir o painel de dentro do modal de uma empresa em
// Empresas.jsx; aqui é o ponto de entrada direto, sem precisar abrir a
// empresa primeiro. Reaproveita o mesmo PainelViewerModal (carrossel com
// setas/swipe) já usado lá.
export default function PaineisPage() {
  const clientes = useStore(s => s.clientes)
  const compSel = useStore(s => s.competenciaSelecionada)
  const [busca, setBusca] = useState('')
  const [carteira, setCarteira] = useState('todas')
  const [viewer, setViewer] = useState(null) // { indiceInicial }

  const carteiras = useMemo(() => {
    const s = new Set(clientes.map(c => c.carteira).filter(Boolean))
    return ['todas', ...Array.from(s).sort()]
  }, [clientes])

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return clientes
      .filter(c => {
        if (termo && !c.nome.toLowerCase().includes(termo) && !c.cnpj?.includes(termo)) return false
        if (carteira !== 'todas' && c.carteira !== carteira) return false
        return true
      })
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [clientes, busca, carteira])

  const linkPainel = (cliente) => `${window.location.origin}${window.location.pathname}?painel=${cliente.id}&competencia=${encodeURIComponent(compSel)}`

  const compartilhar = (cliente) => {
    const mensagem = `Olá! Segue o painel de ${cliente.nome} — competência ${compSel} — com obrigações, financeiro e demais informações:\n${linkPainel(cliente)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MonitorIcon size={18} /> Painéis
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Veja e compartilhe o painel de qualquer cliente — competência {compSel}.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <SearchIcon size={14} color="var(--text3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou CNPJ..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12.5 }} />
        </div>
        {carteiras.length > 2 && (
          <select value={carteira} onChange={(e) => setCarteira(e.target.value)} style={{ fontSize: 12.5, padding: '7px 10px' }}>
            {carteiras.map(c => <option key={c} value={c}>{c === 'todas' ? 'Todas as carteiras' : c}</option>)}
          </select>
        )}
      </div>

      {lista.length === 0 && (
        <div className="empty">
          <p>🖥️</p>
          Nenhuma empresa encontrada.
        </div>
      )}

      {lista.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                  {c.cnpj}{c.carteira ? ` · ${c.carteira}` : ''}
                </div>
              </div>
              <button onClick={() => compartilhar(c)} title="Compartilhar painel via WhatsApp" className="btn btn-ghost"
                style={{ padding: '6px 10px' }}>
                <Share2Icon size={13} />
              </button>
              <button onClick={() => setViewer({ indiceInicial: i })} className="btn btn-accent" style={{ padding: '6px 12px' }}>
                <EyeIcon size={13} /> Ver painel
              </button>
            </div>
          ))}
        </div>
      )}

      {viewer && (
        <PainelViewerModal clientes={lista} indiceInicial={viewer.indiceInicial} competencia={compSel} onClose={() => setViewer(null)} />
      )}
    </div>
  )
}
