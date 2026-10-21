import { useEffect, useMemo, useState } from 'react'
import {
  BriefcaseIcon, LinkIcon, CopyIcon, Share2Icon, RefreshCwIcon, EyeIcon, DownloadIcon, EyeOffIcon, MonitorIcon, CheckIcon, SearchIcon,
} from 'lucide-react'
import { useToast } from '../../components/shared'
import { chavePainel, urlPublica } from '../../lib/linksPublicos'
import { obterEventosPainelPeriodo } from './painelApi'
import { obterTokenCarteira, gerarTokenCarteira, urlCarteira } from './carteiraApi'

// Painéis → Por carteira: as empresas de uma carteira (BRENO, Eloiza...) num
// lugar só, com o que o cliente fez no painel nos últimos 30 dias e atalhos
// pra ver/mandar o painel de cada uma. Daqui também sai o link da carteira
// (PainelCarteiraPage.jsx) pra pessoa responsável abrir os painéis sem login.

const CHAVE_CARTEIRA = 'paineis-carteira-selecionada'
const SEM_CARTEIRA = '__sem__'
const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '')
const normalizar = (t) => (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function haQuanto(iso) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  return `há ${dias} dias`
}
function diasAtrasIso(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CarteirasPainel({ clientes, competencia, versao, onVerPainel }) {
  const { show } = useToast()
  const carteiras = useMemo(() => {
    const contagem = new Map()
    clientes.forEach((c) => {
      const k = c.carteira || SEM_CARTEIRA
      contagem.set(k, (contagem.get(k) || 0) + 1)
    })
    return [...contagem.entries()]
      .sort((a, b) => (a[0] === SEM_CARTEIRA) - (b[0] === SEM_CARTEIRA) || a[0].localeCompare(b[0]))
      .map(([nome, qtd]) => ({ nome, qtd }))
  }, [clientes])

  const [carteira, setCarteira] = useState(() => {
    try { return localStorage.getItem(CHAVE_CARTEIRA) || '' } catch { return '' }
  })
  useEffect(() => {
    if (carteiras.length && !carteiras.some((c) => c.nome === carteira)) setCarteira(carteiras[0].nome)
  }, [carteiras, carteira])
  useEffect(() => {
    try { if (carteira) localStorage.setItem(CHAVE_CARTEIRA, carteira) } catch { /* sem localStorage */ }
  }, [carteira])

  const [busca, setBusca] = useState('')
  const empresas = useMemo(() => {
    const termo = normalizar(busca.trim())
    return clientes
      .filter((c) => (c.carteira || SEM_CARTEIRA) === carteira)
      .filter((c) => !termo || normalizar(`${c.nome} ${c.cnpj || ''}`).includes(termo))
      .sort((a, b) => nomeCurto(a.nome).localeCompare(nomeCurto(b.nome)))
  }, [clientes, carteira, busca])

  // Atividade do cliente nos últimos 30 dias (sem os acessos do escritório)
  const [eventos, setEventos] = useState(null)
  useEffect(() => {
    obterEventosPainelPeriodo(diasAtrasIso(29), diasAtrasIso(0))
      .then((e) => setEventos(e.filter((x) => x.origem !== 'escritorio')))
      .catch(() => setEventos([]))
  }, [])
  const atividade = useMemo(() => {
    const m = new Map()
    for (const ev of eventos || []) {
      const a = m.get(ev.cliente_id) || { ultimaAbertura: null, aberturas: 0, downloads: 0 }
      if (ev.tipo === 'download') a.downloads++
      else { a.aberturas++; if (!a.ultimaAbertura) a.ultimaAbertura = ev.criado_em }
      m.set(ev.cliente_id, a)
    }
    return m
  }, [eventos])
  const abriram = empresas.filter((c) => atividade.get(c.id)?.aberturas > 0).length

  // Link da carteira
  const temCarteiraDeVerdade = carteira && carteira !== SEM_CARTEIRA
  const [token, setToken] = useState(undefined) // undefined = carregando; null = ainda não gerado
  const [erroLink, setErroLink] = useState(null)
  const [gerando, setGerando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    setToken(undefined)
    setErroLink(null)
    if (!temCarteiraDeVerdade) return
    obterTokenCarteira(carteira).then(setToken).catch((e) => { setToken(null); setErroLink(e.message) })
  }, [carteira])

  const gerarLink = async (trocar) => {
    if (trocar && !window.confirm(`Gerar um link novo pra carteira ${carteira}? O link enviado antes para de funcionar.`)) return
    setGerando(true)
    try {
      setToken(await gerarTokenCarteira(carteira))
      setErroLink(null)
      show(trocar ? 'Link novo gerado — o anterior parou de funcionar' : 'Link da carteira gerado')
    } catch (e) {
      setErroLink(e.message)
    }
    setGerando(false)
  }
  const copiarLinkCarteira = async () => {
    try {
      await navigator.clipboard.writeText(urlCarteira(token))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      window.prompt('Copie o link da carteira:', urlCarteira(token))
    }
  }
  const enviarLinkCarteira = () => {
    const msg = `Link da carteira ${carteira} no painel do escritório — ${empresas.length} empresa${empresas.length !== 1 ? 's' : ''}. Abra, escolha a empresa e use "Enviar ao cliente" pra mandar o painel dela:\n${urlCarteira(token)}\n\nNão encaminhe este link a clientes: ele abre o painel de todas as empresas da carteira.`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  // Link do cliente (painel de uma empresa)
  const linkCliente = (c) => urlPublica({ painel: chavePainel(c), competencia, versao: versao === 'completa' ? 1 : null })
  const enviarAoCliente = (c) => {
    const msg = `Olá! Seguem os impostos e as pendências fiscais de ${c.nome} — competência ${competencia}:\n${linkCliente(c)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }
  const copiarLinkCliente = async (c) => {
    try {
      await navigator.clipboard.writeText(linkCliente(c))
      show(`Link de ${nomeCurto(c.nome)} copiado`)
    } catch {
      window.prompt('Copie o link do cliente:', linkCliente(c))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Escolha da carteira */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {carteiras.map((c) => {
          const ativa = c.nome === carteira
          return (
            <button key={c.nome} onClick={() => setCarteira(c.nome)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                border: `1px solid ${ativa ? 'var(--navy)' : 'var(--border)'}`, background: ativa ? 'var(--navy)' : 'var(--surface)', color: ativa ? '#fff' : 'var(--text1)' }}>
              <BriefcaseIcon size={14} /> {c.nome === SEM_CARTEIRA ? 'Sem carteira' : c.nome}
              <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 99, padding: '1px 8px',
                background: ativa ? 'rgba(255,255,255,.18)' : 'var(--surface2)', color: ativa ? '#fff' : 'var(--text2)' }}>{c.qtd}</span>
            </button>
          )
        })}
      </div>

      {/* Link da carteira pro responsável */}
      {temCarteiraDeVerdade && (
        <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LinkIcon size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text1)' }}>Link da carteira {carteira}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
              Pra quem cuida da carteira abrir o painel de cada empresa no celular, sem login, e mandar ao cliente. Abre sempre no mês anterior. Não mande este link pra clientes.
            </div>
            {erroLink && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{erroLink}</div>}
          </div>
          {token === undefined && !erroLink && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando...</span>}
          {token === null && !erroLink && (
            <button className="btn btn-accent" onClick={() => gerarLink(false)} disabled={gerando}>
              <LinkIcon size={13} /> {gerando ? 'Gerando...' : 'Gerar link da carteira'}
            </button>
          )}
          {token && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn" onClick={copiarLinkCarteira}>{copiado ? <><CheckIcon size={13} /> Copiado</> : <><CopyIcon size={13} /> Copiar link</>}</button>
              <button className="btn btn-accent" onClick={enviarLinkCarteira}><Share2Icon size={13} /> Enviar no WhatsApp</button>
              <button className="btn btn-ghost" onClick={() => window.open(urlCarteira(token), '_blank')} title="Abrir o link da carteira numa aba nova"><MonitorIcon size={13} /> Abrir</button>
              <button className="btn btn-ghost" onClick={() => gerarLink(true)} disabled={gerando} title="O link enviado antes para de funcionar"><RefreshCwIcon size={13} /> Novo link</button>
            </div>
          )}
        </div>
      )}

      {/* Empresas da carteira */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
          <b style={{ color: 'var(--text1)' }}>{empresas.length}</b> empresa{empresas.length !== 1 ? 's' : ''}
          {eventos && <> · <b style={{ color: 'var(--ok)' }}>{abriram}</b> abriram o painel nos últimos 30 dias</>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 9px', marginLeft: 'auto', minWidth: 200 }}>
          <SearchIcon size={13} color="var(--text3)" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na carteira..."
            style={{ border: 'none', outline: 'none', background: 'none', fontSize: 12.5, padding: 0, width: '100%' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {empresas.map((c) => {
          const a = atividade.get(c.id)
          const abriu = a?.aberturas > 0
          return (
            <div key={c.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 13px',
              borderLeft: `3px solid ${!eventos ? 'var(--border)' : abriu ? 'var(--ok)' : 'var(--danger)'}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nome}>{nomeCurto(c.nome)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{[c.cnpj, c.regime].filter(Boolean).join(' · ')}</div>
              </div>
              {eventos && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {abriu
                    ? <Selo icone={<EyeIcon size={11} />} cor="var(--ok)" bg="var(--ok-dim)">abriu {haQuanto(a.ultimaAbertura)}{a.aberturas > 1 ? ` · ${a.aberturas}x` : ''}</Selo>
                    : <Selo icone={<EyeOffIcon size={11} />} cor="var(--danger)" bg="var(--danger-dim)">não abriu em 30 dias</Selo>}
                  {a?.downloads > 0 && <Selo icone={<DownloadIcon size={11} />} cor="var(--accent)" bg="var(--accent-dim)">{a.downloads} download{a.downloads !== 1 ? 's' : ''}</Selo>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 12 }} onClick={() => onVerPainel(c.id)}>
                  <MonitorIcon size={12} /> Ver painel
                </button>
                <button className="btn btn-accent" style={{ flex: 1, justifyContent: 'center', padding: '5px 8px', fontSize: 12 }} onClick={() => enviarAoCliente(c)}>
                  <Share2Icon size={12} /> Enviar ao cliente
                </button>
                <button className="btn btn-ghost" style={{ padding: '5px 8px' }} onClick={() => copiarLinkCliente(c)} title="Copiar o link do painel do cliente">
                  <CopyIcon size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {empresas.length === 0 && <div className="empty">Nenhuma empresa nessa carteira{busca ? ' com essa busca' : ''}.</div>}
    </div>
  )
}

function Selo({ icone, cor, bg, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: cor, background: bg, borderRadius: 99, padding: '2px 8px' }}>
      {icone} {children}
    </span>
  )
}
