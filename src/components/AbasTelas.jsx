import { XIcon } from 'lucide-react'
import { NAV } from './MenuTopo'

// Multi-telas: cada tela aberta vira uma aba logo abaixo do topo. Trocar de
// aba não perde o que estava na tela (filtros, rolagem, formulário pela
// metade): as telas abertas continuam montadas, só ficam escondidas.
// Clique do meio na aba também fecha.
export const MAX_ABAS = 10
const CHAVE = 'gestor-abas'

export function abasSalvas(telaInicial) {
  let lista = []
  try { lista = JSON.parse(localStorage.getItem(CHAVE) || '[]') } catch { /* lista vazia */ }
  lista = (Array.isArray(lista) ? lista : []).filter((id) => NAV.some((i) => i.id === id))
  if (!lista.includes(telaInicial)) lista.push(telaInicial)
  return lista.slice(-MAX_ABAS)
}

export function salvarAbas(lista) {
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)) } catch { /* sem localStorage */ }
}

export function AbasTelas({ abas, ativa, rotulos = {}, onEscolher, onFechar }) {
  if (abas.length < 2) return null
  return (
    <div className="abas-telas" role="tablist" aria-label="Telas abertas">
      {abas.map((id) => {
        const item = NAV.find((i) => i.id === id)
        if (!item) return null
        const { Icon } = item
        const nome = rotulos[id] || item.label
        return (
          <div key={id} role="tab" aria-selected={id === ativa} tabIndex={0} title={nome}
            className={`aba-tela ${id === ativa ? 'ativa' : ''}`}
            onClick={() => onEscolher(id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEscolher(id) } }}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onFechar(id) } }}>
            <Icon size={14} />
            <span className="aba-tela-nome">{nome}</span>
            <button type="button" className="aba-tela-fechar" aria-label={`Fechar ${nome}`} title="Fechar aba"
              onClick={(e) => { e.stopPropagation(); onFechar(id) }}>
              <XIcon size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
