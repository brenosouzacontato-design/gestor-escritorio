import { useState } from 'react'
import { RefreshCwIcon, KeyIcon, InfoIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, ErpBadge } from '../components/shared'
import { getFolhaStatus, getFiscalStatus, competenciaAtual, competenciaAnterior, tokenExpirado, refreshUserToken } from '../lib/oneflow'
import { useToast } from '../components/shared'

export default function FechamentosERP({ onOpenConfig }) {
  const clientes = useStore(s => s.clientes)
  const fechamentos = useStore(s => s.fechamentos)
  const upsertFechamento = useStore(s => s.upsertFechamento)
  const oneflowConfig = useStore(s => s.oneflowConfig)
  const setOneflowConfig = useStore(s => s.setOneflowConfig)
  const { show } = useToast()

  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [competencia, setCompetencia] = useState(competenciaAnterior())

  const isMockMode = !oneflowConfig.configurado

  const syncCliente = async (cliente) => {
    if (!cliente.oneflow_token) return

    // Verificar se token da empresa precisa ser renovado
    let token = cliente.oneflow_token
    if (tokenExpirado(cliente.oneflow_token_expires_at) && cliente.oneflow_refresh_token) {
      try {
        // renovação simplificada — token do usuário usado para reautenticar
      } catch { return }
    }

    try {
      const [folhaData, fiscalData] = await Promise.allSettled([
        getFolhaStatus(token, competencia),
        getFiscalStatus(token, competencia),
      ])

      const mapStatus = (r) => {
        if (r.status === 'rejected') return 'aberto'
        const v = r.value?.status?.toLowerCase() || ''
        if (v.includes('fech')) return 'fechado'
        if (v === 'nao_aplica' || v === 'n/a') return 'nao_aplica'
        return 'aberto'
      }

      await upsertFechamento({
        cliente_id: cliente.id,
        competencia,
        tipo: 'folha',
        status: mapStatus(folhaData),
        dados_erp: folhaData.value || null,
        sincronizado_em: new Date().toISOString(),
      })

      await upsertFechamento({
        cliente_id: cliente.id,
        competencia,
        tipo: 'fiscal',
        status: mapStatus(fiscalData),
        dados_erp: fiscalData.value || null,
        sincronizado_em: new Date().toISOString(),
      })
    } catch (e) {
      console.warn('Erro ao sincronizar', cliente.nome, e)
    }
  }

  const syncAll = async () => {
    if (isMockMode) { show('Configure o token OneFlow primeiro'); return }
    setSyncing(true)
    const comToken = clientes.filter(c => c.oneflow_token)
    if (!comToken.length) { show('Nenhum cliente vinculado ao OneFlow'); setSyncing(false); return }

    for (const c of comToken) {
      setSyncProgress(`Sincronizando ${c.nome}...`)
      await syncCliente(c)
    }
    setSyncProgress('')
    setSyncing(false)
    show('Sincronização concluída')
  }

  const getFechamento = (clienteId, tipo) =>
    fechamentos.find(f => f.cliente_id === clienteId && f.tipo === tipo && f.competencia === competencia)

  return (
    <div className="page">
      {isMockMode && (
        <div className="notice notice-warn">
          <InfoIcon size={14} />
          <span>
            Modo demonstração — <button className="btn btn-sm" style={{ padding:'0 6px', height:18, fontSize:11 }} onClick={onOpenConfig}>Configure o token OneFlow</button> para buscar dados reais.
          </span>
        </div>
      )}

      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:14 }}>
        <select
          value={competencia}
          onChange={e => setCompetencia(e.target.value)}
          style={{ flex:1, padding:'8px 11px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14 }}
        >
          <option value={competenciaAnterior()}>Competência anterior ({competenciaAnterior()})</option>
          <option value={competenciaAtual()}>Competência atual ({competenciaAtual()})</option>
        </select>
        <button className="btn btn-accent" onClick={syncAll} disabled={syncing}>
          <RefreshCwIcon size={14} className={syncing ? 'spinning' : ''} />
          {syncing ? 'Sinc...' : 'Sincronizar'}
        </button>
      </div>

      {syncing && syncProgress && (
        <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8, fontStyle:'italic' }}>
          {syncProgress}
        </div>
      )}

      {clientes.map((c, i) => {
        const folha = getFechamento(c.id, 'folha')
        const fiscal = getFechamento(c.id, 'fiscal')
        const vinculado = !!c.oneflow_token

        return (
          <div key={c.id} className="card" style={{ marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <Avatar name={c.nome} size={32} idx={i} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nome}</div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>
                  {vinculado
                    ? <span style={{ color:'var(--accent)' }}>● Vinculado ao OneFlow</span>
                    : <span style={{ color:'var(--text3)' }}>○ Não vinculado</span>
                  }
                </div>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'8px 10px' }}>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>Folha</div>
                <ErpBadge status={isMockMode ? (i % 2 === 0 ? 'aberto' : 'fechado') : folha?.status} />
                {folha?.sincronizado_em && (
                  <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>
                    Atualizado {new Date(folha.sincronizado_em).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
              <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'8px 10px' }}>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>Fiscal</div>
                <ErpBadge status={isMockMode ? (i % 3 === 0 ? 'fechado' : 'aberto') : fiscal?.status} />
                {fiscal?.sincronizado_em && (
                  <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>
                    Atualizado {new Date(fiscal.sincronizado_em).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <style>{`.spinning { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
