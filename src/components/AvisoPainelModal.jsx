// AvisoPainelModal.jsx — aviso no WhatsApp do cliente com o link do painel
//
// O aviso não sai mais sozinho: o escritório escolhe enviar.
//   - No painel (PainelCompartilhadoPage, dentro do app): botão "Notificar
//     cliente" e a pergunta ao clicar "Concluir edição".
//   - Ao anexar uma guia nova (Empresas, Tarefas, Documentos, Parcelamentos):
//     perguntarAvisoPainel(clienteId) (lib/avisoPainelFila.js) abre a pergunta. Várias guias anexadas
//     em sequência viram uma pergunta por empresa, com todas as guias juntas.
// A janela mostra a prévia (guias, número, mensagem) pedida a
// painel-aviso-enviar.js com simular: true, e envia de verdade no botão.
import { useEffect, useState } from 'react'
import { BellIcon, SendIcon, XIcon, AlertTriangleIcon, MoonIcon } from 'lucide-react'
import { useStore } from '../store'
import { cabecalhosFunctions } from '../lib/supabase'
import { ouvirPedidosDeAviso } from '../lib/avisoPainelFila'
export { perguntarAvisoPainel } from '../lib/avisoPainelFila'

export async function chamarAvisoPainel(clienteId, { simular = false, forcar = false } = {}) {
  const resp = await fetch('/.netlify/functions/painel-aviso-enviar', {
    method: 'POST', headers: await cabecalhosFunctions(), body: JSON.stringify({ clienteId, simular, forcar }),
  })
  const r = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const e = new Error(r.error || `Falha no aviso (${resp.status}).`)
    e.silencio = !!r.silencio
    throw e
  }
  return r
}

// ── Pergunta ao anexar guia (pedidos de lib/avisoPainelFila.js) ──────────────
export function AvisoPainelHost() {
  const [fila, setFila] = useState([])
  useEffect(() => {
    // espera uns segundos: anexos em sequência da mesma empresa juntam numa pergunta só
    let timer = null
    const acumulados = new Set()
    const sair = ouvirPedidosDeAviso((id) => {
      acumulados.add(id)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const novos = [...acumulados]
        acumulados.clear()
        setFila((f) => [...f, ...novos.filter((x) => !f.includes(x))])
      }, 3000)
    })
    return () => { sair(); clearTimeout(timer) }
  }, [])
  if (!fila.length) return null
  return (
    <AvisoPainelModal key={fila[0]} clienteId={fila[0]} motivo="anexo" restantes={fila.length - 1}
      onClose={() => setFila((f) => f.slice(1))} />
  )
}

// ── A janela ──────────────────────────────────────────────────────────────────
const fmtMoeda = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : null)

const TITULO = {
  anexo: 'Guia anexada — avisar o cliente?',
  edicao: 'Edição concluída — avisar o cliente?',
  painel: 'Notificar o cliente',
}

// motivo: 'anexo' | 'edicao' | 'painel'. onEnviado(resultado) depois do envio.
export default function AvisoPainelModal({ clienteId, motivo = 'painel', restantes = 0, onClose, onEnviado }) {
  const nomeLoja = useStore((s) => s.clientes?.find((c) => c.id === clienteId)?.nome)
  const [previa, setPrevia] = useState(null)
  const [erro, setErro] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [feito, setFeito] = useState(null)

  useEffect(() => {
    let ativo = true
    chamarAvisoPainel(clienteId, { simular: true })
      .then((r) => {
        if (!ativo) return
        // pergunta ao anexar sem guia nova de imposto: não há o que avisar
        if (motivo === 'anexo' && !r.guias.length) { onClose(); return }
        setPrevia(r)
      })
      .catch((e) => {
        if (!ativo) return
        if (motivo === 'anexo') { onClose(); return } // não atrapalha o anexo
        setErro(e.message)
      })
    return () => { ativo = false }
  }, [clienteId])

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !enviando) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [enviando])

  const enviar = async (forcar = false) => {
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamarAvisoPainel(clienteId, { forcar })
      setFeito(r)
      onEnviado?.(r)
    } catch (e) {
      setErro(e.message)
    }
    setEnviando(false)
  }

  const nome = (nomeLoja || '').replace(/^[\d./-]+\s+/, '')
  const semDestino = previa && !previa.destino

  return (
    <div className="modal-backdrop" style={{ zIndex: 3000 }} onClick={() => !enviando && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
          <BellIcon size={18} style={{ color: 'var(--accent)', marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p className="modal-title" style={{ margin: 0 }}>{TITULO[motivo] || TITULO.painel}</p>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              {nome}{restantes > 0 ? ` · mais ${restantes} empresa(s) na fila` : ''}
            </div>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} disabled={enviando} title="Fechar"><XIcon size={15} /></button>
        </div>

        {feito ? (
          <div style={{ fontSize: 13, color: 'var(--ok)', background: 'var(--ok-dim)', borderRadius: 8, padding: '10px 12px' }}>
            Aviso enviado para {feito.destino}.{feito.guias.length ? ` ${feito.guias.length} guia(s) ficaram como entregues na Central de Entregas.` : ''}
          </div>
        ) : !previa && !erro ? (
          <div className="center" style={{ padding: 24 }}><div className="spinner" /></div>
        ) : previa && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
              {previa.guias.length ? `Guias novas no aviso (${previa.guias.length})` : 'Sem guia nova — o aviso diz que o painel foi atualizado'}
            </div>
            {previa.guias.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                {previa.guias.map((g) => (
                  <div key={g.id} style={{ fontSize: 12.5, color: 'var(--text1)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <b>{g.titulo}</b>
                    <span style={{ color: 'var(--text3)' }}>{[g.vencimento && `vence ${fmtData(g.vencimento)}`, fmtMoeda(g.valor)].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
              {semDestino ? '' : <>Vai para o WhatsApp <b style={{ color: 'var(--text1)' }}>{previa.destino}</b>:</>}
            </div>
            {!semDestino && (
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', margin: '0 0 10px', maxHeight: 180, overflowY: 'auto' }}>
                {previa.mensagem}
              </pre>
            )}
            {semDestino && (
              <div style={{ fontSize: 12.5, color: 'var(--warn)', background: 'var(--warn-dim)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, display: 'flex', gap: 6 }}>
                <AlertTriangleIcon size={14} /> Empresa sem WhatsApp de entrega. Cadastre o número na Central de Entregas → Empresas.
              </div>
            )}
            {previa.silencio && !semDestino && (
              <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, display: 'flex', gap: 6 }}>
                <MoonIcon size={14} /> Agora é horário de silêncio (19h às 7h). Se preferir, deixe para amanhã pelo botão "Notificar cliente" do painel.
              </div>
            )}
          </>
        )}
        {erro && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 10 }}>{erro}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          {feito ? (
            <button className="btn btn-accent btn-sm" onClick={onClose}>Fechar</button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={enviando}>{motivo === 'painel' ? 'Cancelar' : 'Agora não'}</button>
              <button className="btn btn-accent btn-sm" onClick={() => enviar(!!previa?.silencio)} disabled={enviando || !previa || semDestino}>
                <SendIcon size={13} /> {enviando ? 'Enviando…' : previa?.silencio ? 'Enviar mesmo assim' : 'Enviar notificação'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
