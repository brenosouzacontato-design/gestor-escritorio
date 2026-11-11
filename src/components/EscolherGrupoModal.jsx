// Escolher um grupo de WhatsApp pelo nome (lista vem de whatsapp-grupos.js).
// Usado na Central de Entregas → Empresas para o "WhatsApp de entrega".
import { useEffect, useMemo, useRef, useState } from 'react'
import { SearchIcon, UsersIcon, XIcon, RefreshCwIcon } from 'lucide-react'
import { cabecalhosFunctions } from '../lib/supabase'

// a lista vale para a sessão toda (abrir de novo não chama o WhatsApp de novo)
let cache = null

export async function listarGruposWhatsapp({ recarregar = false } = {}) {
  if (cache && !recarregar) return cache
  const resp = await fetch('/.netlify/functions/whatsapp-grupos', { headers: await cabecalhosFunctions() })
  const r = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(r.error || `Falha ao listar os grupos (${resp.status}).`)
  cache = Array.isArray(r.grupos) ? r.grupos : []
  return cache
}

export function nomeDoGrupo(id) {
  return cache?.find((g) => g.id === id)?.nome || null
}

const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function EscolherGrupoModal({ empresa, atual, onEscolher, onClose }) {
  const [grupos, setGrupos] = useState(cache)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState(() => String(empresa || '').replace(/^[\d./-]+\s+/, '').split(/\s+/)[0] || '')
  const inputRef = useRef(null)

  const carregar = (recarregar) => {
    setErro(null)
    if (recarregar) setGrupos(null)
    listarGruposWhatsapp({ recarregar }).then(setGrupos).catch((e) => { setErro(e.message); setGrupos([]) })
  }
  useEffect(() => { carregar(false); setTimeout(() => inputRef.current?.select(), 0) }, [])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const lista = useMemo(() => {
    const t = semAcento(busca.trim())
    const palavras = t.split(/\s+/).filter(Boolean)
    return (grupos || []).filter((g) => palavras.every((p) => semAcento(g.nome).includes(p)))
  }, [grupos, busca])

  return (
    <div className="busca-fundo" onMouseDown={onClose}>
      <div className="busca-caixa" role="dialog" aria-label="Escolher grupo do WhatsApp" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 0' }}>
          <UsersIcon size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text1)', flex: 1 }}>
            Grupo de entrega{empresa ? ` · ${String(empresa).replace(/^[\d./-]+\s+/, '')}` : ''}
          </span>
          <button type="button" className="btn btn-icon btn-ghost" title="Buscar os grupos de novo no WhatsApp" onClick={() => carregar(true)}>
            <RefreshCwIcon size={15} />
          </button>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Fechar"><XIcon size={16} /></button>
        </div>
        <label className="busca-campo">
          <SearchIcon size={18} />
          <input ref={inputRef} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do grupo"
            aria-label="Buscar grupo"
            onKeyDown={(e) => { if (e.key === 'Enter' && lista.length === 1) onEscolher(lista[0]) }} />
        </label>
        <div className="busca-lista" role="listbox">
          {grupos === null && <div className="center" style={{ padding: 24 }}><div className="spinner" /></div>}
          {erro && <p className="busca-vazio" style={{ color: 'var(--err)' }}>{erro}</p>}
          {grupos !== null && !erro && lista.length === 0 && (
            <p className="busca-vazio">
              {grupos.length ? 'Nenhum grupo com esse nome.' : 'O número do escritório não está em nenhum grupo.'}
            </p>
          )}
          {lista.map((g) => (
            <button key={g.id} type="button" role="option" aria-selected={g.id === atual}
              className={`menu-item ${g.id === atual ? 'active' : ''}`} onClick={() => onEscolher(g)}>
              <span className="menu-item-icone"><UsersIcon size={18} /></span>
              <span className="menu-item-textos">
                <span className="menu-item-nome">{g.nome}</span>
                <span className="menu-item-desc">{[g.membros != null && `${g.membros} participantes`, g.id === atual && 'grupo atual'].filter(Boolean).join(' · ') || 'Grupo'}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="busca-rodape">
          <span>O número do escritório precisa estar no grupo. As guias e o aviso do painel desta empresa passam a ir para o grupo escolhido.</span>
        </div>
      </div>
    </div>
  )
}
