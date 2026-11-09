// CentralEntregasPage.jsx — Central de Entregas
// Todas as guias anexadas da competência, por empresa: entregar pelo
// WhatsApp do escritório (uma, ou várias selecionadas), marcar entregue por
// fora, e ver quando o cliente abriu a guia pelo painel. Aba Empresas: o
// WhatsApp de entrega de cada uma e o painel ligado/desligado.
import { useEffect, useMemo, useState } from 'react'
import {
  SendIcon, RefreshCwIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, ExternalLinkIcon,
  CheckIcon, EyeIcon, AlertTriangleIcon, MonitorOffIcon, MonitorIcon, Undo2Icon, BellIcon, BellOffIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import {
  listarGuias, situacaoGuia, enviarGuia, marcarEntregaManual, urlGuia,
  listarEmpresasEntrega, salvarEmpresaEntrega,
} from './entregasApi'

const SITUACOES = {
  a_entregar: { label: 'A entregar', color: 'var(--text2)', bg: 'var(--surface2)' },
  falhou:     { label: 'Falhou', color: 'var(--danger)', bg: 'var(--danger-dim)' },
  entregue:   { label: 'Entregue', color: 'var(--info)', bg: 'var(--info-dim)' },
  vista:      { label: 'Viu no painel', color: 'var(--accent)', bg: 'var(--accent-dim, var(--surface2))' },
  aberta:     { label: 'Aberta pelo cliente', color: 'var(--ok)', bg: 'var(--ok-dim)' },
}

const fmtMoeda = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtData = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : null)
const fmtQuando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '')

function deslocarCompetencia(comp, delta) {
  const [m, a] = comp.split('/').map(Number)
  const d = new Date(a, m - 1 + delta, 1)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const destinoDe = (c) => (c?.whatsapp_entrega || c?.telefone || '').trim()

export default function CentralEntregasPage() {
  const { show } = useToast()
  const competencia = useStore((s) => s.competenciaSelecionada)
  const setCompetencia = useStore((s) => s.setCompetenciaSelecionada)
  const [aba, setAba] = useState('guias')
  const [guias, setGuias] = useState(null)
  const [erro, setErro] = useState(null)
  const [filtro, setFiltro] = useState('pendentes')
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState(() => new Set())
  const [enviando, setEnviando] = useState(() => new Set())
  const [progresso, setProgresso] = useState(null) // { feitas, total }

  const carregar = async ({ silencioso = false } = {}) => {
    if (!silencioso) setGuias(null)
    setErro(null)
    try { setGuias(await listarGuias(competencia)) }
    catch (e) { setErro(e.message); setGuias([]) }
  }

  useEffect(() => { setSelecionadas(new Set()); carregar() }, [competencia])
  // o cliente pode abrir a guia a qualquer momento: atualiza sozinho a cada minuto
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar({ silencioso: true }) }, 60000)
    return () => clearInterval(t)
  }, [competencia])

  const contagem = useMemo(() => {
    const c = { a_entregar: 0, falhou: 0, entregue: 0, vista: 0, aberta: 0 }
    for (const g of guias || []) c[situacaoGuia(g)]++
    return c
  }, [guias])

  const visiveis = useMemo(() => {
    // aviso automático: guia anexada vira mensagem com o link curto do painel (guias-aviso-cron.js)
  const alternarAviso = async (c) => {
    if (!('aviso_guia_painel' in c)) { show('Falta rodar supabase-schema-aviso-guia-painel.sql no Supabase.'); return }
    const ligar = c.aviso_guia_painel === false
    if (await salvar(c, { aviso_guia_painel: ligar })) show(ligar ? 'Aviso automático ligado.' : 'Aviso automático desligado.')
  }

  const termo = busca.trim().toLowerCase()
    return (guias || []).filter((g) => {
      const s = situacaoGuia(g)
      if (filtro === 'pendentes' && !(s === 'a_entregar' || s === 'falhou')) return false
      if (filtro === 'entregues' && !(s === 'entregue' || s === 'vista' || s === 'aberta')) return false
      if (filtro === 'nao_abertas' && s !== 'entregue') return false
      if (filtro === 'vistas' && s !== 'vista') return false
      if (filtro === 'abertas' && s !== 'aberta') return false
      return !termo || `${g.clientes.nome} ${g.titulo}`.toLowerCase().includes(termo)
    })
  }, [guias, filtro, busca])

  const porEmpresa = useMemo(() => {
    const mapa = new Map()
    for (const g of visiveis) {
      if (!mapa.has(g.cliente_id)) mapa.set(g.cliente_id, { cliente: g.clientes, guias: [] })
      mapa.get(g.cliente_id).guias.push(g)
    }
    return [...mapa.values()]
  }, [visiveis])

  const atualizarGuia = (id, patch) => setGuias((lista) => lista.map((g) => (g.id === id ? { ...g, ...patch } : g)))

  const entregarUma = async (g) => {
    setEnviando((s) => new Set(s).add(g.id))
    try {
      const r = await enviarGuia(g.id)
      atualizarGuia(g.id, { entregue_em: new Date().toISOString(), entrega_canal: 'whatsapp', entrega_destino: r.destino, entrega_erro: null })
      return true
    } catch (e) {
      atualizarGuia(g.id, { entrega_erro: e.message })
      return e.message
    } finally {
      setEnviando((s) => { const n = new Set(s); n.delete(g.id); return n })
    }
  }

  const entregar = async (g) => {
    const r = await entregarUma(g)
    show(r === true ? `Guia enviada para ${nomeCurto(g.clientes.nome)}.` : `Não enviou: ${r}`)
  }

  const entregarSelecionadas = async () => {
    const lista = (guias || []).filter((g) => selecionadas.has(g.id))
    if (!lista.length) return
    const jaEntregues = lista.filter((g) => g.entregue_em).length
    if (!window.confirm(`Enviar ${lista.length} guia(s) pelo WhatsApp do escritório?${jaEntregues ? `\n${jaEntregues} já foram entregues e serão enviadas de novo.` : ''}`)) return
    setProgresso({ feitas: 0, total: lista.length })
    let ok = 0
    for (const [i, g] of lista.entries()) {
      if ((await entregarUma(g)) === true) ok++
      setProgresso({ feitas: i + 1, total: lista.length })
    }
    setProgresso(null)
    setSelecionadas(new Set())
    show(ok === lista.length ? `${ok} guia(s) enviadas.` : `${ok} de ${lista.length} enviadas — veja as que falharam.`)
  }

  const marcarManual = async (g, entregue) => {
    try {
      await marcarEntregaManual(g.id, entregue)
      atualizarGuia(g.id, entregue
        ? { entregue_em: new Date().toISOString(), entrega_canal: 'manual', entrega_erro: null }
        : { entregue_em: null, entrega_canal: null, entrega_destino: null })
    } catch (e) { show('Erro: ' + e.message) }
  }

  const abrir = async (g) => {
    const aba = window.open('', '_blank')
    try { const url = await urlGuia(g.storage_path); if (aba) aba.location.href = url; else window.open(url, '_blank') }
    catch (e) { aba?.close(); show('Erro: ' + e.message) }
  }

  const alternar = (id) => setSelecionadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const alternarEmpresa = (lista) => setSelecionadas((s) => {
    const n = new Set(s)
    const todas = lista.every((g) => n.has(g.id))
    lista.forEach((g) => (todas ? n.delete(g.id) : n.add(g.id)))
    return n
  })
  const selecionarPendentes = () => setSelecionadas(new Set(visiveis
    .filter((g) => ['a_entregar', 'falhou'].includes(situacaoGuia(g)) && destinoDe(g.clientes)).map((g) => g.id)))

  return (
    <div className="page">
      <div className="section-hdr" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SendIcon size={18} /> Central de Entregas
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Guias anexadas da competência: entregue pelo WhatsApp e veja quando o cliente abriu pelo painel.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn btn-icon btn-ghost" onClick={() => setCompetencia(deslocarCompetencia(competencia, -1))} title="Competência anterior"><ChevronLeftIcon size={16} /></button>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text1)', minWidth: 70, textAlign: 'center' }}>{competencia}</span>
          <button className="btn btn-icon btn-ghost" onClick={() => setCompetencia(deslocarCompetencia(competencia, 1))} title="Próxima competência"><ChevronRightIcon size={16} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => carregar()} title="Atualizar"><RefreshCwIcon size={13} /></button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['guias', 'Guias'], ['empresas', 'Empresas']].map(([id, label]) => (
          <button key={id} className={`btn btn-sm ${aba === id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setAba(id)}>{label}</button>
        ))}
      </div>

      {aba === 'empresas' ? <AbaEmpresas show={show} onSalvo={() => carregar({ silencioso: true })} /> : (
        <>
          <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', marginBottom: 14 }}>
            <Metrica label="A entregar" valor={contagem.a_entregar} onClick={() => setFiltro('pendentes')} />
            <Metrica label="Falharam" valor={contagem.falhou} classe={contagem.falhou ? 'danger' : ''} onClick={() => setFiltro('pendentes')} />
            <Metrica label="Entregues, sem abrir" valor={contagem.entregue} onClick={() => setFiltro('nao_abertas')} />
            <Metrica label="Viram no painel" valor={contagem.vista} onClick={() => setFiltro('vistas')} />
            <Metrica label="Abertas pelo cliente" valor={contagem.aberta} classe="ok" onClick={() => setFiltro('abertas')} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 'auto' }}>
              <option value="pendentes">A entregar</option>
              <option value="entregues">Entregues</option>
              <option value="nao_abertas">Entregues, sem abrir</option>
              <option value="vistas">Viram no painel</option>
              <option value="abertas">Abertas pelo cliente</option>
              <option value="todas">Todas</option>
            </select>
            <div style={{ position: 'relative', flex: '1 1 200px' }}>
              <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
              <input className="input" placeholder="Buscar empresa ou guia" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ paddingLeft: 30 }} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={selecionarPendentes}>Selecionar pendentes</button>
            <button className="btn btn-accent btn-sm" onClick={entregarSelecionadas} disabled={!selecionadas.size || !!progresso}>
              <SendIcon size={13} /> {progresso ? `Enviando ${progresso.feitas}/${progresso.total}…` : `Entregar ${selecionadas.size || ''} selecionada(s)`}
            </button>
          </div>

          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          {guias === null ? <div className="center" style={{ padding: 40 }}><div className="spinner" /></div>
            : porEmpresa.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 30 }}>
                {guias.length === 0 ? `Nenhuma guia anexada na competência ${competencia}.` : 'Nada nesse filtro.'}
              </div>
            ) : porEmpresa.map(({ cliente, guias: lista }) => (
              <div key={cliente.id} className="card" style={{ marginBottom: 8, padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface2)', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={lista.every((g) => selecionadas.has(g.id))} onChange={() => alternarEmpresa(lista)} title="Selecionar as guias da empresa" />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text1)', flex: '1 1 200px' }}>{nomeCurto(cliente.nome)}</span>
                  {cliente.painel_ativo === false && (
                    <span style={{ ...selo, color: 'var(--text3)', background: 'var(--surface)' }}><MonitorOffIcon size={11} /> painel desligado</span>
                  )}
                  {destinoDe(cliente)
                    ? <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>📱 {destinoDe(cliente)}</span>
                    : <span style={{ ...selo, color: 'var(--warn)', background: 'var(--warn-dim)' }}><AlertTriangleIcon size={11} /> sem WhatsApp — cadastre na aba Empresas</span>}
                </div>
                {lista.map((g) => (
                  <LinhaGuia key={g.id} g={g} marcada={selecionadas.has(g.id)} enviando={enviando.has(g.id)}
                    onMarcar={() => alternar(g.id)} onEntregar={() => entregar(g)} onAbrir={() => abrir(g)}
                    onManual={(v) => marcarManual(g, v)} semDestino={!destinoDe(cliente)} />
                ))}
              </div>
            ))}
        </>
      )}
    </div>
  )
}

const selo = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }

function Metrica({ label, valor, classe = '', onClick }) {
  return (
    <button type="button" className="metric" onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', border: 'none' }}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${classe}`}>{valor}</div>
    </button>
  )
}

function LinhaGuia({ g, marcada, enviando, onMarcar, onEntregar, onAbrir, onManual, semDestino }) {
  const s = situacaoGuia(g)
  const cfg = SITUACOES[s]
  const detalhes = [
    g.vencimento && `vence ${fmtData(g.vencimento)}`,
    fmtMoeda(g.valor_guia),
  ].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <input type="checkbox" checked={marcada} onChange={onMarcar} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{g.titulo}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{detalhes || g.nome_arquivo}</div>
        {s === 'falhou' && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 2 }}>{g.entrega_erro}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ ...selo, color: cfg.color, background: cfg.bg }}>
          {s === 'aberta' || s === 'vista' ? <EyeIcon size={11} /> : s === 'entregue' ? <CheckIcon size={11} /> : null} {cfg.label}
        </span>
        {g.entregue_em && (
          <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>
            entregue {fmtQuando(g.entregue_em)} · {g.entrega_canal === 'manual' ? 'manual' : g.entrega_canal === 'painel' ? 'aviso automático (link do painel)' : 'WhatsApp'}
          </span>
        )}
        {g.visto_em && g.entregue_em && (
          <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>viu no painel {fmtQuando(g.visto_em)}</span>
        )}
        {g.aberto_em && (
          <span style={{ fontSize: 10.5, color: 'var(--ok)' }}>
            baixou/copiou {fmtQuando(g.aberto_ultimo_em || g.aberto_em)}{g.aberto_vezes > 1 ? ` · ${g.aberto_vezes}x` : ''}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-icon btn-ghost" title="Ver a guia" onClick={onAbrir}><ExternalLinkIcon size={13} /></button>
        {g.entregue_em
          ? <button className="btn btn-icon btn-ghost" title="Desfazer entrega" onClick={() => onManual(false)}><Undo2Icon size={13} /></button>
          : <button className="btn btn-icon btn-ghost" title="Marcar entregue (por fora do WhatsApp)" onClick={() => onManual(true)}><CheckIcon size={13} /></button>}
        <button className={`btn btn-sm ${g.entregue_em ? 'btn-ghost' : 'btn-accent'}`} onClick={onEntregar} disabled={enviando || semDestino}
          title={semDestino ? 'Cadastre o WhatsApp da empresa na aba Empresas' : 'Enviar pelo WhatsApp do escritório'}>
          <SendIcon size={12} /> {enviando ? 'Enviando…' : g.entregue_em ? 'Reenviar' : 'Entregar'}
        </button>
      </div>
    </div>
  )
}

function AbaEmpresas({ show, onSalvo }) {
  const [empresas, setEmpresas] = useState(null)
  const [busca, setBusca] = useState('')
  const [rascunho, setRascunho] = useState({}) // id → whatsapp digitado

  useEffect(() => {
    listarEmpresasEntrega().then(setEmpresas).catch((e) => { show('Erro: ' + e.message); setEmpresas([]) })
  }, [])

  const salvar = async (c, patch) => {
    try {
      await salvarEmpresaEntrega(c.id, patch)
      setEmpresas((l) => l.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
      onSalvo?.()
      return true
    } catch (e) { show('Erro: ' + e.message); return false }
  }

  const salvarWhatsapp = async (c) => {
    if (!(c.id in rascunho)) return
    const valor = rascunho[c.id].trim() || null
    if (valor === (c.whatsapp_entrega || null)) return
    if (await salvar(c, { whatsapp_entrega: valor })) show(`WhatsApp de ${nomeCurto(c.nome)} salvo.`)
  }

  const alternarPainel = async (c) => {
    const ligar = c.painel_ativo === false
    if (!ligar && !window.confirm(`Desligar o painel de ${nomeCurto(c.nome)}?\nO link do cliente passa a mostrar "Painel indisponível". As guias continuam saindo pelo WhatsApp.`)) return
    if (await salvar(c, { painel_ativo: ligar })) show(ligar ? 'Painel ligado.' : 'Painel desligado.')
  }

  const termo = busca.trim().toLowerCase()
  const lista = (empresas || []).filter((c) => !termo || (c.nome || '').toLowerCase().includes(termo))
  const desligados = (empresas || []).filter((c) => c.painel_ativo === false).length

  if (empresas === null) return <div className="center" style={{ padding: 40 }}><div className="spinner" /></div>
  if (empresas.length && !('painel_ativo' in empresas[0])) {
    return <div className="card" style={{ fontSize: 13, color: 'var(--warn)' }}>Falta rodar <b>supabase-schema-central-entregas.sql</b> no Supabase para usar esta aba.</div>
  }
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
          <input className="input" placeholder="Buscar empresa" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ paddingLeft: 30 }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{empresas.length} empresas · {desligados} com painel desligado</span>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: '0 0 10px' }}>
        WhatsApp de entrega: número com DDD ou id de grupo (…@g.us). Em branco, usa o telefone do cadastro.
        Com o aviso automático ligado, toda guia anexada vai para esse WhatsApp como mensagem com o link curto do painel.
      </p>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {lista.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 220px', fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{nomeCurto(c.nome)}</span>
            <input className="input" style={{ width: 220 }} placeholder={c.telefone ? `${c.telefone} (cadastro)` : 'sem telefone no cadastro'}
              value={rascunho[c.id] ?? c.whatsapp_entrega ?? ''}
              onChange={(e) => setRascunho((r) => ({ ...r, [c.id]: e.target.value }))}
              onBlur={() => salvarWhatsapp(c)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            <button className={`btn btn-sm ${c.painel_ativo === false ? 'btn-ghost' : 'btn-ghost'}`} onClick={() => alternarPainel(c)}
              style={{ color: c.painel_ativo === false ? 'var(--text3)' : 'var(--ok)', minWidth: 140 }}
              title={c.painel_ativo === false ? 'Ligar o painel do cliente' : 'Desligar o painel do cliente'}>
              {c.painel_ativo === false ? <><MonitorOffIcon size={13} /> Painel desligado</> : <><MonitorIcon size={13} /> Painel ligado</>}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => alternarAviso(c)} disabled={c.painel_ativo === false}
              style={{ color: c.aviso_guia_painel === false || c.painel_ativo === false ? 'var(--text3)' : 'var(--ok)', minWidth: 150 }}
              title="Avisar o cliente no WhatsApp, com o link do painel, toda vez que uma guia for anexada">
              {c.aviso_guia_painel === false || c.painel_ativo === false
                ? <><BellOffIcon size={13} /> Aviso automático off</> : <><BellIcon size={13} /> Aviso automático on</>}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
