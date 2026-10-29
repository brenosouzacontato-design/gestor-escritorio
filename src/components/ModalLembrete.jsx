import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { useToast } from './shared'
import { ModalBase } from '../pages/andamento/modaisObrigacao'
import { criarLembrete, excluirLembrete } from '../pages/andamento/lembretesApi'

// ── Modal marcar lembrete ────────────────────────────────────────────────────
// Data/hora própria (independente do vencimento) numa obrigação ou tarefa —
// disparado por WhatsApp pra o grupo do escritório (lembretes-cron.js).
export default function ModalLembrete({ alvo, onClose, onSaved }) {
  const [dataHora, setDataHora] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const handleSalvar = async () => {
    if (!dataHora) return
    setSaving(true)
    try {
      await criarLembrete({
        obrigacaoId: alvo.obrigacaoId || null,
        tarefaId: alvo.tarefaId || null,
        dataHora: new Date(dataHora).toISOString(),
        mensagem: mensagem.trim(),
      })
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar lembrete: ' + e.message)
    }
    setSaving(false)
  }

  const handleExcluir = async () => {
    setSaving(true)
    try {
      await excluirLembrete(alvo.lembrete.id)
      onSaved()
    } catch (e) {
      show?.('Erro ao excluir lembrete: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <ModalBase onClose={onClose} titulo={`🔔 Lembrete — ${alvo.titulo}`}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {alvo.lembrete && (
          <div style={{ fontSize:12, color:'var(--text2)', background:'var(--surface2)', borderRadius:8, padding:'8px 10px' }}>
            Já tem um lembrete marcado pra {new Date(alvo.lembrete.data_hora).toLocaleString('pt-BR')}.
          </div>
        )}
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Data e hora *</label>
          <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)} autoFocus
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Nota (opcional)</label>
          <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
            placeholder="Vai junto na mensagem do WhatsApp..."
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        </div>
        <p style={{ fontSize:11, color:'var(--text3)' }}>Manda um WhatsApp pro grupo do escritório na hora marcada.</p>
      </div>
      <div style={{ display:'flex', gap:8, marginTop:16 }}>
        {alvo.lembrete && (
          <button onClick={handleExcluir} disabled={saving}
            style={{ background:'var(--danger-dim)', border:'1px solid var(--danger)', borderRadius:8, padding:'9px 14px', fontSize:12, color:'var(--danger)', cursor:'pointer', opacity:saving?.6:1 }}>
            <Trash2Icon size={13} style={{ verticalAlign:-2 }} />
          </button>
        )}
        <button onClick={onClose}
          style={{ flex:1, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'9px', fontSize:12, color:'var(--text2)', cursor:'pointer' }}>Cancelar</button>
        <button onClick={handleSalvar} disabled={saving||!dataHora}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!dataHora)?.6:1 }}>
          {saving?'Salvando...':'Marcar lembrete'}
        </button>
      </div>
    </ModalBase>
  )
}
