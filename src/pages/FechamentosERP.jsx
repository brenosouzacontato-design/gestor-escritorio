import { useState } from 'react'
import { RefreshCwIcon, InfoIcon } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, ErpBadge } from '../components/shared'
import { getFolhaStatus, getFiscalStatus, competenciaAtual, competenciaAnterior, tokenExpirado, getAppToken } from '../lib/oneflow'
import { useToast } from '../components/shared'

export default function FechamentosERP({ onOpenConfig }) {
  const clientes = useStore(s => s.clientes)
  const fechamentos = useStore(s => s.fechamentos)
  const upsertFechamento = useStore(s => s.upsertFechamento)
  const updateCliente = useStore(s => s.updateCliente)
  const oneflowConfig = useStore(s => s.oneflowConfig)
  const { show } = useToast()

  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [syncLog, setSyncLog] = useState([])
  const [competencia, setCompetencia] = useState(competenciaAnterior())

  const isMockMode = !oneflowConfig.configurado

  const renovarToken = async (cliente) => {
    try {
      if (!cliente.oneflow_hash && !cliente.oneflow_app_hash) return null
      const hash = cliente.oneflow_hash || cliente.oneflow_app_hash
      const userToken = oneflowConfig.userToken
      if (!userToken) return null
      const r = await getAppToken(hash, userToken)
      if (r?.token) {
        await updateCliente(cliente.id, {
          oneflow_token: r.token,
          oneflow_refresh_token: r.refresh_token || null,
          oneflow_token_expires_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
        })
        return r.token
      }
    } catch (e) {
      console.warn('Falha ao renovar token de', cliente.nome, e.message)
    }
    return null
  }

  const syncCliente = async (cliente) => {
    if (!cliente.oneflow_token) return { folha: 'sem_token', fiscal: 'sem_token' }

    let token = cliente.oneflow_token

    // Renovar se expirado
    if (tokenExpirado(cliente.oneflow_token_expires_at)) {
      const novoToken = await renovarToken(cliente)
      if (novoToken) token = novoToken
      else {
        console.warn('Token expirado e não renovado:', cliente.nome)
        return { folha: 'erro', fiscal: 'erro' }
      }
    }

    try {
      const [folhaData, fiscalData] = await Promise.allSettled([
        getFolhaStatus(token, competencia),
        getFiscalStatus(token, competencia),
      ])

      // Log para debug
      console.log(`[${cliente.nome}] folha:`, JSON.stringify(folhaData.value || folhaData.reason?.message))
      console.log(`[${cliente.nome}] fiscal:`, JSON.stringify(fiscalData.value || fiscalData.reason?.message))

      const mapStatus = (r) => {
        if (r.status === 'rejected') return 'aberto'
        const v = JSON.stringify(r.value || '').toLowerCase()
        if (v.includes('fechad') || v.includes('closed') || v.includes('conclu')) return 'fechado'
        if (v.includes('nao_aplica') || v.includes('n/a') || v.includes('nao aplica')) return 'nao_aplica'
        return 'aberto'
      }

      const folhaStatus = mapStatus(folhaData)
      const fiscalStatus = mapStatus(fiscalData)

      await upsertFechamento({
        cliente_id: cliente.id,
        competencia,
        tipo: 'folha',
        status: folhaStatus,
        dados_erp: folhaData.value || null,
        sincronizado_em: new Date().toISOString(),
      })

      await upsertFechamento({
        cliente_id: cliente.id,
        competencia,
        tipo: 'fiscal',
        status: fiscalStatus,
        dados_erp: fiscalData.value || null,
        sincronizado_em: new Date().toISOString(),
      })

      return { folha: folhaStatus, fiscal: fiscalStatus }
    } catch (e) {
      console.warn('Erro ao sincronizar', cliente.nome, e)
      return { folha: 'erro', fiscal: 'erro' }
    }
  }

  const syncAll = async () => {
    if (isMockMode) { show('Configure o token OneFlow primeiro'); return }
    setSyncing(true)
    setSyncLog([])
    const comToken = clientes.filter(c => c.oneflow_token)
    if (!comToken.length) { show('Nenhum cliente vinculado ao OneFlow'); setSyncing(false); return }

    const log = []
    for (const c of comToken) {
      setSyncProgress(`Sincronizando ${c.nome}...`)
      const result = await syncCliente(c)
      log.push({ nome: c.nome, ...result })
    }
    setSyncLog(log)
    setSyncProgress('')
    setSyncing(false)

    const fechados = log.filter(l => l.folha === 'fechado' || l.fiscal === 'fechado').length
    const erros = log.filter(l => l.folha === 'erro' || l.fiscal === 'erro').length
    show(`Sincronizado: ${comToken.length} clientes, ${fechados} fechados${erros > 0 ? `, ${erros} erros` : ''}`)
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
          style={{ flex:1, padding:'8px 11px', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', fontSize:14, background:'var(--surface)', color:'var(--text1)' }}
        >
          {[0,1,2,3].map(i => {
            const d = new Date(); d.setMonth(d.getMonth() - i)
            const c = String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear()
            const label = i === 0 ? 'Competência atual' : i === 1 ? 'Competência anterior' : ''
            return <option key={c} value={c}>{label ? `${label} (${c})` : c}</option>
          })}
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
        const tokenExp = tokenExpirado(c.oneflow_token_expires_at)

        return (
          <div key={c.id} className="card" style={{ marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <Avatar name={c.nome} size={32} idx={i} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.nome}</div>
                <div style={{ fontSize:11, color:'var(--text2)' }}>
                  {vinculado
                    ? <span style={{ color: tokenExp ? 'var(--warn)' : 'var(--accent)' }}>
                        {tokenExp ? '⚠ Token expirado' : '● Vinculado ao OneFlow'}
                      </span>
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
                    {new Date(folha.sincronizado_em).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
              <div style={{ background:'var(--surface2)', borderRadius:'var(--r-sm)', padding:'8px 10px' }}>
                <div style={{ fontSize:11, color:'var(--text2)', marginBottom:4 }}>Fiscal</div>
                <ErpBadge status={isMockMode ? (i % 3 === 0 ? 'fechado' : 'aberto') : fiscal?.status} />
                {fiscal?.sincronizado_em && (
                  <div style={{ fontSize:10, color:'var(--text3)', marginTop:3 }}>
                    {new Date(fiscal.sincronizado_em).toLocaleDateString('pt-BR')}
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
