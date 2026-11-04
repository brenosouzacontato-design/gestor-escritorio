import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { useToast } from './shared'
import { ModalBase } from '../pages/andamento/modaisObrigacao'
import { criarLembrete, excluirLembrete } from '../pages/andamento/lembretesApi'

// valor no formato do <input type="datetime-local"> (hora local)
const paraInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Atalhos de horário (só os que ainda não passaram)
function atalhos(agora = new Date()) {
  const lista = []
  const emUmaHora = new Date(agora.getTime() + 60 * 60000)
  emUmaHora.setMinutes(Math.ceil(emUmaHora.getMinutes() / 5) * 5, 0, 0)
  lista.push({ rotulo: 'Daqui 1h', data: emUmaHora })
  const hoje17 = new Date(agora); hoje17.setHours(17, 0, 0, 0)
  if (hoje17 > emUmaHora) lista.push({ rotulo: 'Hoje 17h', data: hoje17 })
  const amanha9 = new Date(agora); amanha9.setDate(amanha9.getDate() + 1); amanha9.setHours(9, 0, 0, 0)
  lista.push({ rotulo: 'Amanhã 9h', data: amanha9 })
  const amanha14 = new Date(amanha9); amanha14.setHours(14)
  lista.push({ rotulo: 'Amanhã 14h', data: amanha14 })
  return lista
}

// ── Modal marcar lembrete ────────────────────────────────────────────────────
// Data/hora própria (independente do vencimento) numa obrigação ou tarefa —
// disparado por WhatsApp pra o grupo do escritório e como notificação nos
// aparelhos que ativaram os avisos (lembretes-cron.js, roda a cada 5 min).
export default function ModalLembrete({ alvo, onClose, onSaved }) {
  const [dataHora, setDataHora] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [saving, setSaving] = useState(false)
  const { show } = useToast()

  const noPassado = dataHora && new Date(dataHora) < new Date(Date.now() - 60000)

  const handleSalvar = async () => {
    if (!dataHora || noPassado) return
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
          <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:6 }}>
            {atalhos().map(a => {
              const v = paraInput(a.data)
              return (
                <button key={a.rotulo} type="button" onClick={() => setDataHora(v)}
                  style={{ background: dataHora === v ? 'var(--accent-dim)' : 'var(--surface2)', border:`1px solid ${dataHora === v ? 'var(--accent)' : 'var(--border)'}`, borderRadius:99, padding:'4px 10px', fontSize:11.5, color: dataHora === v ? 'var(--accent)' : 'var(--text2)', cursor:'pointer' }}>
                  {a.rotulo}
                </button>
              )
            })}
          </div>
          <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)} min={paraInput(new Date())}
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none' }} />
          {noPassado && <div style={{ fontSize:11, color:'var(--danger)', marginTop:4 }}>Esse horário já passou.</div>}
        </div>
        <div>
          <label style={{ fontSize:11, color:'var(--text2)', display:'block', marginBottom:4 }}>Nota (opcional)</label>
          <textarea value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
            placeholder="Vai junto no aviso..."
            style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text1)', outline:'none', resize:'vertical', fontFamily:'inherit' }} />
        </div>
        <p style={{ fontSize:11, color:'var(--text3)' }}>Na hora marcada (com até 5 min de folga) chega no WhatsApp do grupo e como notificação nos aparelhos com os avisos ativos (botão em Tarefas).</p>
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
        <button onClick={handleSalvar} disabled={saving||!dataHora||noPassado}
          style={{ flex:1, background:'var(--accent)', border:'none', borderRadius:8, padding:'9px', fontSize:12, color:'#fff', fontWeight:500, cursor:'pointer', opacity:(saving||!dataHora||noPassado)?.6:1 }}>
          {saving?'Salvando...':'Marcar lembrete'}
        </button>
      </div>
    </ModalBase>
  )
}
