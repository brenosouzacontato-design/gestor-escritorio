import { useMemo, useState } from 'react'
import { Building2Icon, CopyIcon, Share2Icon, SearchIcon, XIcon } from 'lucide-react'
import { Modal, useToast } from '../../components/shared'

// Grupos já montados ficam lembrados neste navegador (por empresa) — ao
// abrir o modal a partir de qualquer empresa do grupo, ele já vem marcado.
// Não precisa de tabela no banco: o grupo vai inteiro no próprio link.
const CHAVE_GRUPOS = 'paineis-grupos'

function lerGrupos() {
  try { return JSON.parse(localStorage.getItem(CHAVE_GRUPOS)) || {} } catch { return {} }
}
function lembrarGrupo(ids) {
  try {
    const grupos = lerGrupos()
    ids.forEach((id) => { grupos[id] = ids })
    localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(grupos))
  } catch { /* sem localStorage — só não lembra */ }
}

function normalizar(texto) {
  return (texto || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function linkPainelGrupo(ids, competencia, versao) {
  return `${window.location.origin}${window.location.pathname}?painel=${ids.join(',')}&competencia=${encodeURIComponent(competencia)}${versao === 'completa' ? '&versao=1' : ''}`
}

// Monta um link de painel com várias empresas (grupo econômico do mesmo
// dono) — o cliente escolhe qual empresa ver numa barra no topo do painel
// (ver PainelGrupoPage.jsx).
export default function CompartilharGrupoModal({ clientes, clienteInicialId, competencia, versao, onClose }) {
  const { show } = useToast()
  const [selecionados, setSelecionados] = useState(() => {
    const lembrado = lerGrupos()[clienteInicialId]
    const validos = (lembrado || []).filter((id) => clientes.some((c) => c.id === id))
    return validos.length > 0 ? validos : clienteInicialId ? [clienteInicialId] : []
  })
  const [busca, setBusca] = useState('')

  const porId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])
  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim())
    const lista = termo ? clientes.filter((c) => normalizar(`${c.nome} ${c.cnpj || ''}`).includes(termo)) : clientes
    return lista.slice(0, 60)
  }, [clientes, busca])

  const alternar = (id) => setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const pronto = selecionados.length >= 2
  const link = pronto ? linkPainelGrupo(selecionados, competencia, versao) : ''
  const nomes = selecionados.map((id) => porId.get(id)?.nome).filter(Boolean)

  const copiar = async () => {
    lembrarGrupo(selecionados)
    try {
      await navigator.clipboard.writeText(link)
      show('Link do grupo copiado')
    } catch {
      window.prompt('Copie o link do grupo:', link)
    }
  }
  const whatsapp = () => {
    lembrarGrupo(selecionados)
    const mensagem = `Olá! Segue o painel das suas empresas — competência ${competencia}. No topo dá pra escolher qual empresa ver:\n${nomes.map((n) => `• ${n}`).join('\n')}\n\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank')
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Building2Icon size={18} /> Painel de grupo de empresas
      </p>
      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 12px' }}>
        Marque as empresas do mesmo cliente. Ele recebe <b>um link só</b> e escolhe no topo do painel qual empresa quer ver.
      </p>

      {/* empresas já escolhidas, na ordem em que aparecem pro cliente */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, minHeight: 28 }}>
        {selecionados.map((id, i) => (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
            background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 99, padding: '4px 6px 4px 10px', maxWidth: 260 }}>
            <span style={{ fontWeight: 800 }}>{i + 1}.</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{porId.get(id)?.nome || id}</span>
            <button type="button" onClick={() => alternar(id)} title="Tirar do grupo"
              style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <XIcon size={13} />
            </button>
          </span>
        ))}
        {selecionados.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhuma empresa marcada.</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
        <SearchIcon size={13} color="var(--text3)" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa por nome ou CNPJ..." autoFocus
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 12.5, color: 'var(--text1)' }} />
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {filtrados.map((c) => {
          const marcado = selecionados.includes(c.id)
          return (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', cursor: 'pointer',
              borderBottom: '1px solid var(--border)', background: marcado ? 'var(--accent-dim)' : 'transparent' }}>
              <input type="checkbox" checked={marcado} onChange={() => alternar(c.id)} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text1)', fontWeight: marcado ? 700 : 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
              {c.cnpj && <span style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>{c.cnpj}</span>}
            </label>
          )
        })}
        {filtrados.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>Nenhuma empresa encontrada.</div>}
      </div>

      {!pronto && (
        <p style={{ fontSize: 11.5, color: 'var(--warn)', margin: '10px 0 0' }}>Marque pelo menos 2 empresas pra montar o grupo.</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn" style={{ flex: 1 }} onClick={copiar} disabled={!pronto}>
          <CopyIcon size={14} /> Copiar link
        </button>
        <button className="btn btn-accent" style={{ flex: 1 }} onClick={whatsapp} disabled={!pronto}>
          <Share2Icon size={14} /> Enviar no WhatsApp
        </button>
      </div>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Fechar</button>
    </Modal>
  )
}
