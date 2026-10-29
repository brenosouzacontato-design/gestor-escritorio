import { useEffect, useRef, useState } from 'react'
import { SendIcon, SparklesIcon, ExternalLinkIcon, Trash2Icon, Loader2Icon, LandmarkIcon } from 'lucide-react'
import { perguntarAssessor } from './assessorApi'

const SUGESTOES = [
  'Qual o prazo da DCTFWeb deste mês?',
  'Quais obrigações do Simples Nacional vencem no próximo mês?',
  'O que muda na NFS-e com a Reforma Tributária em 2027?',
  'Qual o prazo de entrega da ECF este ano?',
]
const CHAVE = 'assessor-chat-conversa'

function lerConversa() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE) || '[]') } catch { return [] }
}

// **negrito** simples; o resto vai como texto, preservando quebras de linha
function Texto({ texto }) {
  return String(texto || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
}

// Chat com IA que só busca em sites oficiais (gov.br, leg.br, jus.br).
// A conversa fica só nesta aba do navegador (sessionStorage).
export default function ChatAssessor() {
  const [conversa, setConversa] = useState(lerConversa)
  const [texto, setTexto] = useState('')
  const [esperando, setEsperando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [erro, setErro] = useState('')
  const fimRef = useRef(null)

  useEffect(() => {
    try { sessionStorage.setItem(CHAVE, JSON.stringify(conversa.slice(-30))) } catch { /* sem storage */ }
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [conversa, esperando])

  useEffect(() => {
    if (!esperando) return
    setSegundos(0)
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [esperando])

  const enviar = async (pergunta) => {
    const p = (pergunta ?? texto).trim()
    if (!p || esperando) return
    const nova = [...conversa, { role: 'user', content: p }]
    setConversa(nova)
    setTexto('')
    setErro('')
    setEsperando(true)
    try {
      const r = await perguntarAssessor({ modo: 'chat', mensagens: nova.map(({ role, content }) => ({ role, content })) })
      if (!r.texto) throw new Error('O Assessor não devolveu resposta. Tente de novo.')
      setConversa((c) => [...c, { role: 'assistant', content: r.texto, fontes: r.fontes || [] }])
    } catch (e) {
      setErro(e.message)
    } finally {
      setEsperando(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SparklesIcon size={16} color="var(--accent)" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Pergunte ao Assessor</div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <LandmarkIcon size={11} /> Busca só em fontes oficiais (gov.br, leg.br, jus.br). Confira a fonte antes de agir.
          </div>
        </div>
        {conversa.length > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setConversa([]); setErro('') }} disabled={esperando} title="Começar outra conversa">
            <Trash2Icon size={13} /> Limpar
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '55vh', overflowY: 'auto', padding: '2px' }}>
        {conversa.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SUGESTOES.map((s) => (
              <button key={s} className="btn btn-sm" onClick={() => enviar(s)} style={{ fontWeight: 400 }}>{s}</button>
            ))}
          </div>
        )}
        {conversa.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '80%' : '100%',
            background: m.role === 'user' ? 'var(--accent-dim)' : 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '9px 12px', fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            <Texto texto={m.content} />
            {m.fontes?.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3, whiteSpace: 'normal' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Fontes oficiais</span>
                {m.fontes.map((f) => (
                  <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                    <ExternalLinkIcon size={11} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.titulo}</span>
                  </a>
                ))}
              </div>
            )}
            {m.role === 'assistant' && !m.fontes?.length && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, whiteSpace: 'normal' }}>Sem fonte oficial citada nesta resposta — confira antes de usar.</div>
            )}
          </div>
        ))}
        {esperando && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)' }}>
            <Loader2Icon size={14} style={{ animation: 'spin 1s linear infinite' }} />
            Pesquisando em fontes oficiais… {segundos}s
          </div>
        )}
        {erro && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{erro}</div>}
        <div ref={fimRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} disabled={esperando}
          placeholder="Ex.: Qual o vencimento do FGTS Digital da competência 10/2026?"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          style={{ flex: 1, resize: 'vertical', fontFamily: 'inherit' }} />
        <button className="btn btn-accent" onClick={() => enviar()} disabled={esperando || !texto.trim()} title="Enviar (Enter)">
          <SendIcon size={15} />
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>
        Não escreva CPF, CNPJ ou nome de cliente: números com cara de documento são apagados antes do envio.
      </div>
    </div>
  )
}
