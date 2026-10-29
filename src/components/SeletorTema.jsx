import { useState, useEffect, useRef } from 'react'
import { PaletteIcon, CheckIcon } from 'lucide-react'
import { TEMAS } from '../lib/tema'

// Botão do topo que abre a lista dos temas; a escolha vale na hora e fica salva.
export default function SeletorTema({ tema, onEscolher }) {
  const [aberto, setAberto] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false) }
    const esc = (e) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  const atual = TEMAS.find(t => t.id === tema)
  return (
    <div className="tema-seletor" ref={ref}>
      <button type="button" className="btn btn-icon btn-ghost" onClick={() => setAberto(a => !a)}
        aria-haspopup="menu" aria-expanded={aberto} title={`Tema: ${atual?.nome || ''} (clique para escolher)`}>
        <PaletteIcon size={18} />
      </button>
      {aberto && (
        <div className="tema-caixa" role="menu" aria-label="Tema">
          <span className="tema-titulo">Tema</span>
          {TEMAS.map(t => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === tema}
              className={`tema-opcao ${t.id === tema ? 'active' : ''}`}
              onClick={() => { onEscolher(t.id); setAberto(false) }}>
              <span className="tema-amostra" aria-hidden="true">
                <span style={{ background: t.amostra[1] }} /><span style={{ background: t.amostra[0] }} />
              </span>
              <span className="tema-textos">
                <span className="tema-nome">{t.nome}</span>
                <span className="tema-desc">{t.desc}</span>
              </span>
              {t.id === tema && <CheckIcon size={16} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
