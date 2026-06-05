import { useMemo, useState } from 'react'
import { BellIcon, XIcon, AlertTriangleIcon, ClockIcon, CheckCircleIcon } from 'lucide-react'
import { useStore } from '../store'
import { DeptChip, fmtDate } from './shared'

// Retorna diferença em dias (negativo = vencida)
function diasPara(due) {
  if (!due) return null
  const hoje = new Date(new Date().toDateString())
  const venc = new Date(due)
  return Math.round((venc - hoje) / 86400000)
}

export function useNotificacoes() {
  const tarefas = useStore(s => s.tarefas)
  const clientes = useStore(s => s.clientes)
  const fechamentos = useStore(s => s.fechamentos)

  return useMemo(() => {
    const notifs = []

    // 1. Tarefas vencidas
    tarefas
      .filter(t => !t.concluida && t.vencimento && diasPara(t.vencimento) < 0)
      .forEach(t => {
        const dias = Math.abs(diasPara(t.vencimento))
        notifs.push({
          id: `venc-${t.id}`,
          tipo: 'vencida',
          prioridade: 1,
          titulo: t.titulo,
          sub: `${t.clientes?.nome || ''} · venceu há ${dias} dia${dias !== 1 ? 's' : ''}`,
          dept: t.departamento,
          tarefaId: t.id,
        })
      })

    // 2. Tarefas vencem hoje
    tarefas
      .filter(t => !t.concluida && diasPara(t.vencimento) === 0)
      .forEach(t => {
        notifs.push({
          id: `hoje-${t.id}`,
          tipo: 'hoje',
          prioridade: 2,
          titulo: t.titulo,
          sub: `${t.clientes?.nome || ''} · vence hoje`,
          dept: t.departamento,
          tarefaId: t.id,
        })
      })

    // 3. Tarefas vencem em 1-3 dias
    tarefas
      .filter(t => !t.concluida && diasPara(t.vencimento) >= 1 && diasPara(t.vencimento) <= 3)
      .forEach(t => {
        const d = diasPara(t.vencimento)
        notifs.push({
          id: `breve-${t.id}`,
          tipo: 'breve',
          prioridade: 3,
          titulo: t.titulo,
          sub: `${t.clientes?.nome || ''} · vence em ${d} dia${d !== 1 ? 's' : ''}`,
          dept: t.departamento,
          tarefaId: t.id,
        })
      })

    // 4. Fechamentos ERP abertos sem tarefa criada
    const today = new Date()
    const mesAtual = `${String(today.getMonth() + 1).padStart(2,'0')}/${today.getFullYear()}`
    fechamentos
      .filter(f => f.status === 'aberto')
      .forEach(f => {
        const cliente = clientes.find(c => c.id === f.cliente_id)
        const jaTemTarefa = tarefas.some(
          t => t.cliente_id === f.cliente_id &&
               t.departamento === (f.tipo === 'folha' ? 'pessoal' : 'fiscal') &&
               !t.concluida &&
               t.origem === 'erp'
        )
        if (!jaTemTarefa) {
          notifs.push({
            id: `erp-${f.id}`,
            tipo: 'erp',
            prioridade: 2,
            titulo: `Fechamento de ${f.tipo === 'folha' ? 'Folha' : 'Fiscal'} em aberto`,
            sub: `${cliente?.nome || ''} · comp. ${f.competencia}`,
            dept: f.tipo === 'folha' ? 'pessoal' : 'fiscal',
          })
        }
      })

    // 5. Alta prioridade sem vencimento definido
    tarefas
      .filter(t => !t.concluida && t.prioridade === 'alta' && !t.vencimento)
      .forEach(t => {
        notifs.push({
          id: `alt-${t.id}`,
          tipo: 'alta',
          prioridade: 4,
          titulo: t.titulo,
          sub: `${t.clientes?.nome || ''} · alta prioridade sem vencimento`,
          dept: t.departamento,
          tarefaId: t.id,
        })
      })

    return notifs.sort((a, b) => a.prioridade - b.prioridade)
  }, [tarefas, fechamentos, clientes])
}

// ── Painel de notificações ────────────────────────────────────────────────────
export function NotificacoesPanel({ onClose }) {
  const notifs = useNotificacoes()
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const grupos = {
    vencida: notifs.filter(n => n.tipo === 'vencida'),
    hoje:    notifs.filter(n => n.tipo === 'hoje'),
    breve:   notifs.filter(n => n.tipo === 'breve'),
    erp:     notifs.filter(n => n.tipo === 'erp'),
    alta:    notifs.filter(n => n.tipo === 'alta'),
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:200,
      display:'flex', flexDirection:'column',
      background:'var(--bg)',
    }}>
      {/* Header */}
      <div style={{
        background:'var(--surface)', borderBottom:'1px solid var(--border)',
        padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between',
        flexShrink:0,
      }}>
        <span style={{ fontSize:16, fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
          <BellIcon size={18} /> Notificações
          {notifs.length > 0 && (
            <span className="badge badge-err">{notifs.length}</span>
          )}
        </span>
        <button className="btn btn-icon btn-ghost" onClick={onClose}><XIcon size={18} /></button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:16 }}>
        {notifs.length === 0 && (
          <div className="empty" style={{ paddingTop:48 }}>
            <CheckCircleIcon size={40} color="var(--accent)" style={{ margin:'0 auto 12px' }} />
            <p style={{ fontSize:15, fontWeight:500, color:'var(--text)' }}>Tudo em dia!</p>
            <p style={{ marginTop:4 }}>Nenhuma pendência ou alerta no momento.</p>
          </div>
        )}

        {grupos.vencida.length > 0 && (
          <GrupoNotif
            label="Vencidas"
            icon={<AlertTriangleIcon size={14} />}
            cor="var(--danger)"
            bgCor="var(--danger-bg)"
            items={grupos.vencida}
            onConcluir={(id) => id && toggleTarefa(id)}
          />
        )}

        {grupos.hoje.length > 0 && (
          <GrupoNotif
            label="Vencem hoje"
            icon={<ClockIcon size={14} />}
            cor="#92400E"
            bgCor="#FEF3C7"
            items={grupos.hoje}
            onConcluir={(id) => id && toggleTarefa(id)}
          />
        )}

        {grupos.erp.length > 0 && (
          <GrupoNotif
            label="Fechamentos ERP em aberto"
            icon={<AlertTriangleIcon size={14} />}
            cor="var(--info)"
            bgCor="var(--info-bg)"
            items={grupos.erp}
          />
        )}

        {grupos.breve.length > 0 && (
          <GrupoNotif
            label="Vencem em breve (1–3 dias)"
            icon={<ClockIcon size={14} />}
            cor="#1C5F3A"
            bgCor="#EBF5EE"
            items={grupos.breve}
            onConcluir={(id) => id && toggleTarefa(id)}
          />
        )}

        {grupos.alta.length > 0 && (
          <GrupoNotif
            label="Alta prioridade sem vencimento"
            icon={<AlertTriangleIcon size={14} />}
            cor="var(--text2)"
            bgCor="var(--surface2)"
            items={grupos.alta}
            onConcluir={(id) => id && toggleTarefa(id)}
          />
        )}
      </div>
    </div>
  )
}

function GrupoNotif({ label, icon, cor, bgCor, items, onConcluir }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{
        display:'flex', alignItems:'center', gap:6,
        fontSize:11, fontWeight:600, color:cor,
        textTransform:'uppercase', letterSpacing:'.4px',
        marginBottom:8,
      }}>
        {icon} {label} ({items.length})
      </div>
      {items.map(n => (
        <div key={n.id} style={{
          background:'var(--surface)',
          border:`1px solid var(--border)`,
          borderLeft:`3px solid ${cor}`,
          borderRadius:'var(--r-md)',
          padding:'10px 12px',
          marginBottom:6,
          display:'flex',
          alignItems:'flex-start',
          gap:10,
        }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>{n.titulo}</div>
            <div style={{ fontSize:11, color:'var(--text2)', marginTop:3, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
              <span>{n.sub}</span>
              <DeptChip dept={n.dept} />
            </div>
          </div>
          {onConcluir && n.tarefaId && (
            <button
              className="btn btn-sm"
              style={{ flexShrink:0, fontSize:11 }}
              onClick={() => onConcluir(n.tarefaId)}
            >
              Concluir
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Botão de sino com badge ───────────────────────────────────────────────────
export function NotificacoesBell({ onClick }) {
  const notifs = useNotificacoes()
  const urgentes = notifs.filter(n => n.tipo === 'vencida' || n.tipo === 'hoje').length

  return (
    <button
      className="btn btn-icon btn-ghost"
      onClick={onClick}
      style={{ position:'relative' }}
      title="Notificações"
    >
      <BellIcon size={18} />
      {notifs.length > 0 && (
        <span style={{
          position:'absolute', top:0, right:0,
          width:16, height:16,
          borderRadius:'50%',
          background: urgentes > 0 ? 'var(--danger)' : '#D97706',
          color:'white',
          fontSize:9, fontWeight:700,
          display:'flex', alignItems:'center', justifyContent:'center',
          border:'2px solid var(--bg)',
        }}>
          {notifs.length > 9 ? '9+' : notifs.length}
        </span>
      )}
    </button>
  )
}
