import { useState } from 'react'
import { InfoIcon, KeyIcon, RefreshCwIcon, ExternalLinkIcon, AlertTriangleIcon } from 'lucide-react'
import { Modal, useToast } from './shared'
import { useStore } from '../store'
import { getUserToken, autenticarEscritorioCompleto, listarApps, extrairTokenColado, expiracaoDoToken } from '../lib/oneflow'

const OMIE_LOGIN_URL = 'https://app.omie.com.br/login/'
const OMIE_TOKEN_URL = 'https://app.omie.com.br/api/portal/users/me/token/'
import { supabase } from '../lib/supabase'

export default function OneflowConfigModal({ onClose }) {
  const oneflowConfig = useStore(s => s.oneflowConfig)
  const setOneflowConfig = useStore(s => s.setOneflowConfig)
  const clientes = useStore(s => s.clientes)
  const updateCliente = useStore(s => s.updateCliente)
  const syncEmpresasOneFlow = useStore(s => s.syncEmpresasOneFlow)
  const { show } = useToast()

  // A Omie passou a exigir reCAPTCHA no login do portal, então o login por
  // senha direto pela API é recusado (403) — o caminho que funciona é o
  // token colado, por isso ele virou a aba padrão.
  const [tab, setTab] = useState(oneflowConfig.configurado ? 'sincronizar' : 'token')
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState(null)

  const salvarTokenNoSupabase = async (cfg) => {
    const rows = [
      { chave: 'of_user_token',       valor: cfg.userToken || '' },
      { chave: 'of_refresh_token',    valor: cfg.refreshToken || '' },
      { chave: 'of_escritorio_token', valor: cfg.escritorioToken || '' },
      { chave: 'of_escritorio_hash',  valor: cfg.escritorioHash || '' },
      { chave: 'of_token_expires_at', valor: cfg.tokenExpiresAt || '' },
    ].filter(r => r.valor)
    
    if (rows.length > 0) {
      await supabase.from('configuracoes').upsert(rows, { onConflict: 'chave' })
    }
  }

  const autenticarViaLogin = async () => {
    if (!login || !senha) { show('Informe login e senha'); return }
    setLoading(true)
    try {
      const res = await getUserToken(login, senha)
      const userToken = res.token || res.access_token
      const refreshToken = res.refresh_token
      const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
      
      const cfg = { userToken, refreshToken, configurado: true, tokenExpiresAt: expiresAt }
      setOneflowConfig(cfg)
      await salvarTokenNoSupabase(cfg)
      
      show('Token obtido e salvo com sucesso!')
      setTab('sincronizar')
    } catch (e) {
      show(`Erro: ${e.message}`)
    }
    setLoading(false)
  }

  const salvarTokenManual = async () => {
    const { token: jwt, refresh_token } = extrairTokenColado(token)
    if (!jwt) { show('Não encontrei um token no texto colado (deve começar com "eyJ")'); return }
    const expiresAt = expiracaoDoToken(jwt) || new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
    if (new Date(expiresAt) <= new Date()) { show('Esse token já venceu — gere um novo'); return }
    setLoading(true)
    try {
      // Testa o token antes de salvar — senão um token inválido só aparecia
      // como erro depois, na hora de sincronizar.
      await listarApps(jwt)
      const cfg = { userToken: jwt, refreshToken: refresh_token || undefined, configurado: true, tokenExpiresAt: expiresAt }
      setOneflowConfig(cfg)
      await salvarTokenNoSupabase(cfg)
      setToken('')
      show('Token válido e salvo!')
      setTab('sincronizar')
    } catch (e) {
      show(`Erro: ${e.message}`)
    }
    setLoading(false)
  }

  const tokenVencido = oneflowConfig.configurado && oneflowConfig.tokenExpiresAt && new Date(oneflowConfig.tokenExpiresAt) <= new Date()

  const sincronizarEmpresas = async () => {
    const t = oneflowConfig.userToken
    if (!t) { show('Configure o token primeiro'); return }
    setLoading(true)
    try {
      const { escritorioToken, escritorioHash, empresas } = await autenticarEscritorioCompleto(t)
      
      const cfg = { ...oneflowConfig, escritorioToken, escritorioHash }
      setOneflowConfig(cfg)
      await salvarTokenNoSupabase(cfg)
      
      setResultado(empresas)
      const { desativadas } = await syncEmpresasOneFlow(empresas)

      // Vincular tokens nas empresas existentes
      let vinculados = 0
      const clientesAtuais = clientes.length > 0 ? clientes : []
      for (const emp of empresas) {
        if (!emp.cnpj || !emp.token) continue
        const cliente = clientesAtuais.find(c => c.cnpj?.replace(/\D/g,'') === emp.cnpj?.replace(/\D/g,''))
        if (cliente) {
          await updateCliente(cliente.id, {
            oneflow_app_hash: emp.app_hash,
            oneflow_token: emp.token,
            oneflow_refresh_token: emp.refresh_token || null,
            oneflow_token_expires_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
          })
          vinculados++
        }
      }
      show(`${empresas.length} empresas, ${vinculados} vinculadas${desativadas > 0 ? `, ${desativadas} desativada${desativadas !== 1 ? 's' : ''} (saíram do ERP)` : ''}`)
    } catch (e) {
      show(`Erro: ${e.message}`)
    }
    setLoading(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
        <KeyIcon size={18} /> Conector OneFlow
      </p>

      <div className="tabs">
        <button className={`tab-btn ${tab==='login'?'active':''}`} onClick={() => setTab('login')}>Login</button>
        <button className={`tab-btn ${tab==='token'?'active':''}`} onClick={() => setTab('token')}>Token</button>
        <button className={`tab-btn ${tab==='sincronizar'?'active':''}`} onClick={() => setTab('sincronizar')}>Vincular</button>
      </div>

      {tab === 'login' && (
        <>
          <div className="notice notice-info" style={{ background:'var(--warn-dim)', color:'var(--warn)' }}>
            <AlertTriangleIcon size={14} />
            <span>A Omie passou a exigir reCAPTCHA no login, então esse caminho costuma ser recusado. Se der erro 403, use a aba <strong>Token</strong>.</span>
          </div>
          <div className="form-field">
            <label className="form-label">Login (e-mail)</label>
            <input type="email" value={login} onChange={e => setLogin(e.target.value)} placeholder="email@escritorio.com" />
          </div>
          <div className="form-field">
            <label className="form-label">Senha</label>
            <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn btn-accent" style={{ width:'100%' }} onClick={autenticarViaLogin} disabled={loading}>
            {loading ? 'Autenticando...' : 'Entrar e salvar token'}
          </button>
        </>
      )}

      {tab === 'token' && (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>
              O endereço do token só funciona com você <strong>logado na Omie no mesmo navegador</strong> — sem login a Omie recusa (403, página em branco).
            </span>
          </div>
          <ol style={{ fontSize:12, color:'var(--text2)', margin:'0 0 12px', paddingLeft:18, display:'flex', flexDirection:'column', gap:6 }}>
            <li>
              Entre na Omie normalmente:{' '}
              <a href={OMIE_LOGIN_URL} target="_blank" rel="noreferrer" style={{ color:'var(--accent)', fontWeight:600, display:'inline-flex', alignItems:'center', gap:3 }}>
                app.omie.com.br/login <ExternalLinkIcon size={11} />
              </a>
            </li>
            <li>
              Já logado, abra:{' '}
              <a href={OMIE_TOKEN_URL} target="_blank" rel="noreferrer" style={{ color:'var(--accent)', fontWeight:600, display:'inline-flex', alignItems:'center', gap:3 }}>
                /api/portal/users/me/token/ <ExternalLinkIcon size={11} />
              </a>
            </li>
            <li>Copie tudo o que aparecer na página (pode ser o JSON inteiro) e cole abaixo.</li>
          </ol>
          <div className="form-field">
            <label className="form-label">Token JWT (ou o JSON da página)</label>
            <textarea
              style={{ fontFamily:'monospace', fontSize:11 }}
              placeholder='eyJ...  ou  {"token": "eyJ...", ...}'
              value={token}
              onChange={e => setToken(e.target.value)}
              rows={4}
            />
          </div>
          <button className="btn btn-accent" style={{ width:'100%' }} onClick={salvarTokenManual} disabled={loading}>
            {loading ? 'Validando...' : 'Validar e salvar token'}
          </button>
          {oneflowConfig.configurado && (
            <div style={{ marginTop:10, padding:'8px 12px', background: tokenVencido ? 'var(--danger-dim)' : 'var(--ok-dim)', borderRadius:'var(--r-sm)', fontSize:12, color: tokenVencido ? 'var(--danger)' : 'var(--ok)' }}>
              {tokenVencido ? '⚠ Token vencido em ' : '✓ Token configurado — expira '}
              {oneflowConfig.tokenExpiresAt ? new Date(oneflowConfig.tokenExpiresAt).toLocaleString('pt-BR') : 'em breve'}
            </div>
          )}
        </>
      )}

      {tab === 'sincronizar' && (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>Busca as empresas do seu escritório no OneFlow e vincula automaticamente pelos CNPJs cadastrados.</span>
          </div>

          {tokenVencido && (
            <div className="notice" style={{ background:'var(--danger-dim)', color:'var(--danger)', cursor:'pointer' }} onClick={() => setTab('token')}>
              <AlertTriangleIcon size={14} />
              <span>
                O token venceu em {new Date(oneflowConfig.tokenExpiresAt).toLocaleString('pt-BR')} — por isso as atualizações estão falhando.
                {' '}<strong style={{ textDecoration:'underline' }}>Gerar um novo na aba Token</strong>.
              </span>
            </div>
          )}

          {resultado && (
            <div className="card" style={{ marginBottom:14 }}>
              <p style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>{resultado.length} empresa(s) encontrada(s) no OneFlow</p>
              {resultado.slice(0,8).map((e, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <span style={{ color:'var(--text1)' }}>{e.nome || e.razao_social || `Empresa ${i+1}`}</span>
                  <span className={`badge ${e.token ? 'badge-ok' : 'badge-gray'}`}>{e.token ? 'ok' : 'sem token'}</span>
                </div>
              ))}
            </div>
          )}

          <button className="btn btn-accent" style={{ width:'100%' }} onClick={sincronizarEmpresas} disabled={loading}>
            <RefreshCwIcon size={15} />
            {loading ? 'Sincronizando...' : 'Sincronizar empresas do OneFlow'}
          </button>
        </>
      )}

      <button className="btn btn-ghost" style={{ width:'100%', marginTop:10 }} onClick={onClose}>Fechar</button>
    </Modal>
  )
}
