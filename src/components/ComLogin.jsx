import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Portão de login do gestor (Supabase Auth, e-mail e senha). Só envolve o <App />: os links
// públicos (painel do cliente, relatórios e documentos compartilhados) são resolvidos antes em
// main.jsx e continuam abertos. O cadastro de usuários é feito no painel do Supabase
// (Authentication → Users); não existe "criar conta" aqui.
export default function ComLogin({ children }) {
  const [sessao, setSessao] = useState(undefined) // undefined = verificando
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)

  useEffect(() => {
    // tema salvo pelo App, para a tela de login não piscar no tema errado
    const tema = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', tema)

    supabase.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s))
    return () => data.subscription.unsubscribe()
  }, [])

  async function entrar(ev) {
    ev.preventDefault()
    setErro('')
    setEntrando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEntrando(false)
    if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
  }

  if (sessao === undefined) return null
  if (sessao) return children

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 16 }}>
      <form onSubmit={entrar} className="card" style={{ width: '100%', maxWidth: 360, padding: 28 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>
          <span style={{ fontSize: 22 }}>⬡</span> Gestor
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 22 }}>Entre para continuar</div>
        <div className="form-field">
          <label className="form-label" htmlFor="login-email">E-mail</label>
          <input id="login-email" type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="login-senha">Senha</label>
          <input id="login-senha" type="password" autoComplete="current-password" required value={senha}
            onChange={(e) => setSenha(e.target.value)} />
        </div>
        {erro && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        <button type="submit" className="btn btn-accent" style={{ width: '100%', justifyContent: 'center' }} disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

export function sair() {
  return supabase.auth.signOut()
}
