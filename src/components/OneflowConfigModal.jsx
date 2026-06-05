import { useState } from 'react'
import { InfoIcon, KeyIcon, RefreshCwIcon } from 'lucide-react'
import { Modal, useToast } from './shared'
import { useStore } from '../store'
import { getUserToken, autenticarEscritorioCompleto } from '../lib/oneflow'

export default function OneflowConfigModal({ onClose }) {
  const oneflowConfig = useStore(s => s.oneflowConfig)
  const setOneflowConfig = useStore(s => s.setOneflowConfig)
  const clientes = useStore(s => s.clientes)
  const updateCliente = useStore(s => s.updateCliente)
  const { show } = useToast()

  const [tab, setTab] = useState('token')
  const [login, setLogin] = useState('')
  const [senha, setSenha] = useState('')
  const [token, setToken] = useState(oneflowConfig.userToken || '')
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState(null)

  // Opção 1: login + senha para obter token automaticamente
  const autenticarViaLogin = async () => {
    if (!login || !senha) { show('Informe login e senha'); return }
    setLoading(true)
    try {
      const { token: t, refresh_token: rt } = await getUserToken(login, senha)
      setToken(t)
      setOneflowConfig({ userToken: t, refreshToken: rt, configurado: true, tokenExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() })
      show('Token obtido com sucesso')
      setTab('sincronizar')
    } catch (e) {
      show(`Erro: ${e.message}`)
    }
    setLoading(false)
  }

  // Opção 2: token colado manualmente
  const salvarTokenManual = () => {
    if (!token.trim()) { show('Cole o token'); return }
    setOneflowConfig({ userToken: token.trim(), configurado: true, tokenExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() })
    show('Token salvo')
    setTab('sincronizar')
  }

  // Sincronizar empresas do OneFlow → Supabase
  const sincronizarEmpresas = async () => {
    const t = token || oneflowConfig.userToken
    if (!t) { show('Configure o token primeiro'); return }
    setLoading(true)
    try {
      const { escritorioToken, escritorioHash, empresas } = await autenticarEscritorioCompleto(t)
      setOneflowConfig({ escritorioToken, escritorioHash })
      setResultado(empresas)

      // Tentar vincular empresas com clientes cadastrados (por CNPJ)
      let vinculados = 0
      for (const emp of empresas) {
        if (!emp.cnpj || !emp.token) continue
        const cliente = clientes.find(c => c.cnpj?.replace(/\D/g,'') === emp.cnpj?.replace(/\D/g,''))
        if (cliente) {
          await updateCliente(cliente.id, {
            oneflow_app_hash: emp.app_hash,
            oneflow_token: emp.token,
            oneflow_refresh_token: emp.refresh_token,
            oneflow_token_expires_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
          })
          vinculados++
        }
      }
      show(`${empresas.length} empresas encontradas, ${vinculados} vinculadas automaticamente`)
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
        <button className={`tab-btn ${tab==='token'?'active':''}`} onClick={() => setTab('token')}>Token</button>
        <button className={`tab-btn ${tab==='login'?'active':''}`} onClick={() => setTab('login')}>Login</button>
        <button className={`tab-btn ${tab==='sincronizar'?'active':''}`} onClick={() => setTab('sincronizar')}>Vincular</button>
      </div>

      {tab === 'token' && (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>
              Acesse <strong>app.omie.com.br/api/portal/users/me/token/</strong> com seu usuário de integração e cole o token abaixo. Expira em 24h.
            </span>
          </div>
          <div className="form-field">
            <label className="form-label">Token JWT do usuário</label>
            <textarea
              style={{ fontFamily:'var(--mono)', fontSize:11 }}
              placeholder="eyJ..."
              value={token}
              onChange={e => setToken(e.target.value)}
              rows={4}
            />
          </div>
          <button className="btn btn-accent" style={{ width:'100%' }} onClick={salvarTokenManual}>
            Salvar token
          </button>
        </>
      )}

      {tab === 'login' && (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>Informe as credenciais do usuário de integração (recomendamos criar um usuário separado).</span>
          </div>
          <div className="form-field">
            <label className="form-label">Login (e-mail)</label>
            <input type="email" value={login} onChange={e => setLogin(e.target.value)} placeholder="integracao@escritorio.com" />
          </div>
          <div className="form-field">
            <label className="form-label">Senha</label>
            <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn btn-accent" style={{ width:'100%' }} onClick={autenticarViaLogin} disabled={loading}>
            {loading ? 'Autenticando...' : 'Obter token automaticamente'}
          </button>
        </>
      )}

      {tab === 'sincronizar' && (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>Busca as empresas do seu escritório no OneFlow e vincula automaticamente pelos CNPJs cadastrados.</span>
          </div>

          {resultado && (
            <div className="card" style={{ marginBottom:14 }}>
              <p style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>{resultado.length} empresa(s) encontrada(s) no OneFlow</p>
              {resultado.slice(0,8).map((e, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <span>{e.nome || e.razao_social || `Empresa ${i+1}`}</span>
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
