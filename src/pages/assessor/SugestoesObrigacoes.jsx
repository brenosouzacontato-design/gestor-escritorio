import { useEffect, useState } from 'react'
import { SparklesIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon, CheckIcon, PlusIcon, XIcon } from 'lucide-react'
import { perguntarAssessor } from './assessorApi'

const NOME_REGIME = { SN: 'Simples', MEI: 'MEI', LP: 'Presumido', LR: 'Real' }

export function regimeSigla(regime) {
  const r = String(regime || '').toLowerCase()
  if (r.includes('mei')) return 'MEI'
  if (r.includes('presumido')) return 'LP'
  if (r.includes('real')) return 'LR'
  return 'SN'
}

function fmt(d) {
  if (!d) return 'sem data'
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

// Sugestões do Assessor ao gerar a competência: obrigações do calendário
// oficial (Agenda Tributária da Receita, eSocial, SPED...) para os regimes
// das empresas do escritório. O resultado fica guardado no navegador por
// competência, pra não pagar outra busca toda vez que abre.
export default function SugestoesObrigacoes({ competencia, clientes, nomesExistentes, onProgramar, onClose }) {
  const chave = `assessor-sugestoes-${competencia}`
  const [res, setRes] = useState(() => { try { return JSON.parse(localStorage.getItem(chave) || 'null') } catch { return null } })
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState('')
  const [segundos, setSegundos] = useState(0)

  const regimes = {}
  for (const c of clientes) { const r = regimeSigla(c.regime); regimes[r] = (regimes[r] || 0) + 1 }

  const buscar = async () => {
    setBuscando(true); setErro(''); setSegundos(0)
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    try {
      const r = await perguntarAssessor({ modo: 'obrigacoes', competencia, regimes, existentes: nomesExistentes })
      const salvo = { obrigacoes: r.obrigacoes || [], aviso: r.aviso || '', em: new Date().toISOString() }
      setRes(salvo)
      try { localStorage.setItem(chave, JSON.stringify(salvo)) } catch { /* sem storage */ }
    } catch (e) {
      setErro(e.message)
    } finally {
      clearInterval(t); setBuscando(false)
    }
  }

  useEffect(() => { if (!res) buscar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lista = res?.obrigacoes || []
  const novas = lista.filter((o) => !o.ja_cadastrada)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', width: '100%', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <SparklesIcon size={17} color="var(--accent)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>Sugestões do Assessor — {competencia}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
              Obrigações do calendário oficial para {Object.entries(regimes).map(([r, n]) => `${n} ${NOME_REGIME[r]}`).join(', ') || 'suas empresas'}. Confira a fonte antes de programar.
            </div>
          </div>
          {res && !buscando && (
            <button className="btn btn-sm btn-ghost" onClick={buscar} title="Buscar de novo nas fontes oficiais"><RefreshCwIcon size={13} /> Atualizar</button>
          )}
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Fechar"><XIcon size={16} /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {buscando && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 13, padding: '24px 0', justifyContent: 'center' }}>
              <Loader2Icon size={16} style={{ animation: 'spin 1s linear infinite' }} /> Consultando a Agenda Tributária e outras fontes oficiais… {segundos}s
            </div>
          )}
          {erro && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</div>}
          {!buscando && res && lista.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Nenhuma obrigação encontrada para esta competência.</div>}
          {!buscando && res?.aviso && <div style={{ fontSize: 12, color: 'var(--warn)', background: 'var(--warn-dim)', borderRadius: 8, padding: '7px 10px' }}>{res.aviso}</div>}
          {!buscando && lista.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              {novas.length} nova{novas.length !== 1 ? 's' : ''} · {lista.length - novas.length} já cadastrada{lista.length - novas.length !== 1 ? 's' : ''} no Gestor
            </div>
          )}
          {!buscando && lista.map((o, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border: '1px solid var(--border)', borderLeft: `4px solid ${o.ja_cadastrada ? 'var(--ok)' : 'var(--accent)'}`, borderRadius: 10, padding: '9px 12px', background: 'var(--surface)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{o.nome}</span>
                  {o.regimes.map((r) => <span key={r} className="tarefa-selo" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>{NOME_REGIME[r]}</span>)}
                  <span className="tarefa-selo" style={{ background: 'var(--surface2)', color: 'var(--text3)' }}>{o.periodicidade}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                  Vence em <b>{fmt(o.vencimento)}</b>{o.observacao ? ` · ${o.observacao}` : ''}
                </div>
                {o.fonte && (
                  <a href={o.fonte} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                    <ExternalLinkIcon size={11} /> Fonte oficial
                  </a>
                )}
              </div>
              {o.ja_cadastrada ? (
                <span className="tarefa-selo" style={{ background: 'var(--ok-dim)', color: 'var(--ok)', fontWeight: 700 }}><CheckIcon size={11} /> Já no Gestor</span>
              ) : (
                <button className="btn btn-sm btn-accent" onClick={() => onProgramar(o)} title="Abre 'Obrigações em lote' já preenchido para as empresas desse regime">
                  <PlusIcon size={12} /> Programar
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
