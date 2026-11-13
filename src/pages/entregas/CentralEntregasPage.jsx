// CentralEntregasPage.jsx — Central de Entregas
// Todas as guias anexadas da competência, numa lista com seletor de empresa
// e ordenação (empresa, tipo de obrigação, vencimento, situação, valor). Cada
// obrigação/tarefa tem o trilho A entregar → Entregue → Aberta; passando o
// mouse numa etapa aparece a data/hora e o histórico. Entrega pelo WhatsApp do
// escritório (uma, ou várias selecionadas) ou marcada por fora. Aba Empresas: o
// WhatsApp de entrega de cada uma e o painel ligado/desligado.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SendIcon, RefreshCwIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, ExternalLinkIcon,
  CheckIcon, EyeIcon, AlertTriangleIcon, MonitorOffIcon, MonitorIcon, Undo2Icon, BellIcon, BellOffIcon,
  ClockIcon, XIcon, HandIcon, HistoryIcon,
  ClipboardListIcon, CheckSquareIcon, LayersIcon, PaperclipIcon, UsersIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import EscolherGrupoModal, { listarGruposWhatsapp, nomeDoGrupo } from '../../components/EscolherGrupoModal'
import AvisoPainelModal, { chamarAvisoPainel } from '../../components/AvisoPainelModal'
import {
  listarGuias, situacaoGuia, enviarGuia, marcarEntregaManual, confirmarAberturaManual, obterLogGuia, urlGuia,
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

// clienteFixo: aberta dentro da aba da empresa (EmpresaAbaPage), só com as guias dela
export default function CentralEntregasPage({ clienteFixo = null } = {}) {
  const { show } = useToast()
  const competencia = useStore((s) => s.competenciaSelecionada)
  const setCompetencia = useStore((s) => s.setCompetenciaSelecionada)
  const [aba, setAba] = useState('guias')
  const [guias, setGuias] = useState(null)
  const [erro, setErro] = useState(null)
  // controle de entregas: abre com tudo (as entregues pelo aviso do painel também)
  const [filtro, setFiltro] = useState('todas')
  const [empresaSel, setEmpresaSel] = useState(clienteFixo || '') // '' = todas as empresas
  const [ordem, setOrdem] = useState('empresa')
  const [busca, setBusca] = useState('')
  const [selecionadas, setSelecionadas] = useState(() => new Set())
  const [enviando, setEnviando] = useState(() => new Set())
  const [progresso, setProgresso] = useState(null) // { feitas, total }
  const [painelDe, setPainelDe] = useState(null) // empresa com a janela "Enviar painel" aberta
  const [progressoPainel, setProgressoPainel] = useState(null) // { feitas, total }

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

  // empresas que têm guia na competência (para o seletor)
  const empresas = useMemo(() => {
    const mapa = new Map()
    for (const g of guias || []) if (!mapa.has(g.cliente_id)) mapa.set(g.cliente_id, g.clientes)
    return [...mapa.values()].sort((a, b) => nomeCurto(a.nome).localeCompare(nomeCurto(b.nome)))
  }, [guias])
  useEffect(() => { if (!clienteFixo && empresaSel && guias && !empresas.some((c) => c.id === empresaSel)) setEmpresaSel('') }, [empresas])

  const daEmpresa = useMemo(() => (guias || []).filter((g) => !empresaSel || g.cliente_id === empresaSel), [guias, empresaSel])

  // os cards contam o que está no seletor de empresa
  const contagem = useMemo(() => {
    const c = { a_entregar: 0, falhou: 0, entregue: 0, vista: 0, aberta: 0 }
    for (const g of daEmpresa) c[situacaoGuia(g)]++
    return c
  }, [daEmpresa])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return daEmpresa.filter((g) => {
      const s = situacaoGuia(g)
      if (filtro === 'pendentes' && !(s === 'a_entregar' || s === 'falhou')) return false
      if (filtro === 'entregues' && !(s === 'entregue' || s === 'vista' || s === 'aberta')) return false
      if (filtro === 'nao_abertas' && s !== 'entregue') return false
      if (filtro === 'vistas' && s !== 'vista') return false
      if (filtro === 'abertas' && s !== 'aberta') return false
      return !termo || `${g.clientes.nome} ${g.titulo} ${g.origem || ''}`.toLowerCase().includes(termo)
    })
  }, [daEmpresa, filtro, busca])

  const secoes = useMemo(() => montarSecoes(visiveis, ordem), [visiveis, ordem])

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

  // Painel: em vez de (ou além de) cada guia separada, manda o aviso com o
  // link do painel da empresa (mesma mensagem do "Notificar cliente" do painel).
  // As guias novas listadas no aviso ficam como entregues pelo painel.
  const podeEnviarPainel = (c) => !!c && c.painel_ativo !== false && !!destinoDe(c)
  const motivoSemPainel = (c) => (c?.painel_ativo === false ? 'O painel desta empresa está desligado (aba Empresas)'
    : !destinoDe(c) ? 'Empresa sem WhatsApp de entrega' : 'Enviar o link do painel da empresa no WhatsApp')
  const empresasSelecionadas = useMemo(() => {
    const mapa = new Map()
    for (const g of guias || []) if (selecionadas.has(g.id) && podeEnviarPainel(g.clientes)) mapa.set(g.cliente_id, g.clientes)
    return [...mapa.values()]
  }, [guias, selecionadas])

  const enviarPainelSelecionadas = async () => {
    const lista = empresasSelecionadas
    if (!lista.length) return
    if (!window.confirm(`Enviar o painel para ${lista.length} empresa(s) pelo WhatsApp do escritório?

${lista.map((c) => '• ' + nomeCurto(c.nome)).join('\n')}`)) return
    setProgressoPainel({ feitas: 0, total: lista.length })
    let ok = 0
    let forcar = false
    const falhas = []
    for (const [i, c] of lista.entries()) {
      try {
        await chamarAvisoPainel(c.id, { forcar })
        ok++
      } catch (e) {
        if (e.silencio && !forcar && window.confirm('Horário de silêncio (19h às 7h). Enviar mesmo assim?')) {
          forcar = true
          try { await chamarAvisoPainel(c.id, { forcar }); ok++ } catch (e2) { falhas.push(`${nomeCurto(c.nome)}: ${e2.message}`) }
        } else falhas.push(`${nomeCurto(c.nome)}: ${e.message}`)
      }
      setProgressoPainel({ feitas: i + 1, total: lista.length })
    }
    setProgressoPainel(null)
    setSelecionadas(new Set())
    carregar({ silencioso: true })
    show(falhas.length ? `Painel enviado para ${ok} de ${lista.length}. ${falhas[0]}` : `Painel enviado para ${ok} empresa(s).`)
  }

  const marcarManual = async (g, entregue) => {
    try {
      await marcarEntregaManual(g.id, entregue)
      atualizarGuia(g.id, entregue
        ? { entregue_em: new Date().toISOString(), entrega_canal: 'manual', entrega_erro: null }
        : { entregue_em: null, entrega_canal: null, entrega_destino: null })
    } catch (e) { show('Erro: ' + e.message) }
  }

  const confirmarAbertura = async (g, confirmada) => {
    try { atualizarGuia(g.id, await confirmarAberturaManual(g.id, confirmada)) }
    catch (e) { show('Erro: ' + e.message) }
  }

  const abrir = async (g) => {
    const aba = window.open('', '_blank')
    try { const url = await urlGuia(g.storage_path); if (aba) aba.location.href = url; else window.open(url, '_blank') }
    catch (e) { aba?.close(); show('Erro: ' + e.message) }
  }

  const alternar = (id) => setSelecionadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const alternarVarias = (lista) => setSelecionadas((s) => {
    const n = new Set(s)
    const todas = lista.every((g) => n.has(g.id))
    lista.forEach((g) => (todas ? n.delete(g.id) : n.add(g.id)))
    return n
  })
  const selecionarPendentes = () => setSelecionadas(new Set(visiveis
    .filter((g) => ['a_entregar', 'falhou'].includes(situacaoGuia(g)) && destinoDe(g.clientes)).map((g) => g.id)))

  const empresaAtual = empresaSel ? empresas.find((c) => c.id === empresaSel) : null

  return (
    <div className="page">
      <div className="section-hdr" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <SendIcon size={18} /> Central de Entregas
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Guias anexadas da competência: entregue cada guia ou o painel da empresa pelo WhatsApp e acompanhe pelo trilho de cada obrigação e tarefa.
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
            <Metrica label="A entregar" valor={contagem.a_entregar} ativo={filtro === 'pendentes'} onClick={() => setFiltro('pendentes')} />
            <Metrica label="Falharam" valor={contagem.falhou} classe={contagem.falhou ? 'danger' : ''} onClick={() => setFiltro('pendentes')} />
            <Metrica label="Entregues, sem abrir" valor={contagem.entregue} ativo={filtro === 'nao_abertas'} onClick={() => setFiltro('nao_abertas')} />
            <Metrica label="Viram no painel" valor={contagem.vista} ativo={filtro === 'vistas'} onClick={() => setFiltro('vistas')} />
            <Metrica label="Abertas pelo cliente" valor={contagem.aberta} classe="ok" ativo={filtro === 'abertas'} onClick={() => setFiltro('abertas')} />
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            {!clienteFixo && <Campo label="Empresa">
              <select className="input" value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} style={{ width: 240 }}>
                <option value="">Todas as empresas ({empresas.length})</option>
                {empresas.map((c) => <option key={c.id} value={c.id}>{nomeCurto(c.nome)}</option>)}
              </select>
            </Campo>}
            <Campo label="Situação">
              <select className="input" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 'auto' }}>
                <option value="todas">Todas</option>
                <option value="pendentes">A entregar</option>
                <option value="entregues">Entregues</option>
                <option value="nao_abertas">Entregues, sem abrir</option>
                <option value="vistas">Viram no painel</option>
                <option value="abertas">Abertas pelo cliente</option>
              </select>
            </Campo>
            <Campo label="Ordenar por">
              <select className="input" value={ordem} onChange={(e) => setOrdem(e.target.value)} style={{ width: 'auto' }}>
                {Object.entries(ORDENS).map(([id, o]) => <option key={id} value={id}>{o.label}</option>)}
              </select>
            </Campo>
            <div style={{ position: 'relative', flex: '1 1 180px' }}>
              <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text3)' }} />
              <input className="input" placeholder="Buscar obrigação, tarefa ou empresa" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ paddingLeft: 30 }} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={selecionarPendentes}>Selecionar pendentes</button>
            <button className="btn btn-accent btn-sm" onClick={entregarSelecionadas} disabled={!selecionadas.size || !!progresso || !!progressoPainel}
              title="Envia cada guia selecionada, em PDF, no WhatsApp da empresa">
              <SendIcon size={13} /> {progresso ? `Enviando ${progresso.feitas}/${progresso.total}…` : `Entregar ${selecionadas.size || ''} guia(s)`}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={enviarPainelSelecionadas} disabled={!empresasSelecionadas.length || !!progresso || !!progressoPainel}
              title="Envia o link do painel (uma mensagem por empresa) para as empresas das guias selecionadas">
              <MonitorIcon size={13} /> {progressoPainel ? `Enviando painel ${progressoPainel.feitas}/${progressoPainel.total}…`
                : `Enviar painel${empresasSelecionadas.length ? ` (${empresasSelecionadas.length} empresa${empresasSelecionadas.length > 1 ? 's' : ''})` : ''}`}
            </button>
          </div>

          {empresaAtual && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
              <InfoEmpresa cliente={empresaAtual} />
              <BotaoPainel cliente={empresaAtual} pode={podeEnviarPainel(empresaAtual)} motivo={motivoSemPainel(empresaAtual)} onClick={() => setPainelDe(empresaAtual)} />
            </div>
          )}

          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          {guias === null ? <div className="center" style={{ padding: 40 }}><div className="spinner" /></div>
            : visiveis.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 30 }}>
                {guias.length === 0 ? `Nenhuma guia anexada na competência ${competencia}.` : 'Nada nesse filtro.'}
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'visible' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4, background: 'var(--surface2)', borderRadius: 'inherit' }}>
                  <input type="checkbox" checked={visiveis.every((g) => selecionadas.has(g.id))} onChange={() => alternarVarias(visiveis)} title="Selecionar tudo o que está na lista" />
                  <span style={{ flex: '1 1 200px' }}>{ordem === 'empresa' || empresaSel ? 'Obrigação / tarefa' : 'Empresa · obrigação / tarefa'}</span>
                  <span style={{ flex: '0 0 300px', display: 'flex' }}>
                    {ROTULO_ETAPA.map((r) => <span key={r} style={{ flex: 1, textAlign: 'center' }}>{r}</span>)}
                  </span>
                  <span style={{ flex: '0 0 196px', textAlign: 'right' }}>Ações</span>
                </div>
                {secoes.map((sec) => (
                  <div key={sec.chave}>
                    {sec.titulo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexWrap: 'wrap' }}>
                        <input type="checkbox" checked={sec.guias.every((g) => selecionadas.has(g.id))} onChange={() => alternarVarias(sec.guias)} title="Selecionar o grupo" />
                        <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--text1)', flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {sec.Icone && <sec.Icone size={13} style={{ color: 'var(--text3)' }} />} {sec.titulo}
                        </span>
                        <ResumoEmpresa lista={sec.guias} />
                        {sec.cliente && !empresaSel && <InfoEmpresa cliente={sec.cliente} />}
                        {sec.cliente && !empresaSel && (
                          <BotaoPainel cliente={sec.cliente} pode={podeEnviarPainel(sec.cliente)} motivo={motivoSemPainel(sec.cliente)} onClick={() => setPainelDe(sec.cliente)} />
                        )}
                      </div>
                    )}
                    {sec.guias.map((g) => (
                      <LinhaGuia key={g.id} g={g} mostrarEmpresa={ordem !== 'empresa' && !empresaSel}
                        marcada={selecionadas.has(g.id)} enviando={enviando.has(g.id)}
                        onMarcar={() => alternar(g.id)} onEntregar={() => entregar(g)} onAbrir={() => abrir(g)}
                        onManual={(v) => marcarManual(g, v)} onConfirmarAbertura={(v) => confirmarAbertura(g, v)}
                        semDestino={!destinoDe(g.clientes)} />
                    ))}
                  </div>
                ))}
              </div>
            )}
        </>
      )}
      {painelDe && (
        <AvisoPainelModal clienteId={painelDe.id} motivo="painel" onClose={() => setPainelDe(null)}
          onEnviado={() => carregar({ silencioso: true })} />
      )}
    </div>
  )
}

function BotaoPainel({ pode, motivo, onClick }) {
  return (
    <button className="btn btn-ghost btn-sm" onClick={onClick} disabled={!pode} title={motivo}
      style={{ fontSize: 11.5, padding: '3px 8px', color: pode ? 'var(--accent)' : 'var(--text3)' }}>
      <MonitorIcon size={12} /> Enviar painel
    </button>
  )
}

function Campo({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      {children}
    </label>
  )
}

function InfoEmpresa({ cliente }) {
  return (
    <>
      {cliente.painel_ativo === false && (
        <span style={{ ...selo, color: 'var(--text3)', background: 'var(--surface2)' }}><MonitorOffIcon size={11} /> painel desligado</span>
      )}
      {destinoDe(cliente)
        ? <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>📱 {destinoDe(cliente)}</span>
        : <span style={{ ...selo, color: 'var(--warn)', background: 'var(--warn-dim)' }}><AlertTriangleIcon size={11} /> sem WhatsApp — cadastre na aba Empresas</span>}
    </>
  )
}

// Tipo da guia: obrigação, tarefa, parcelamento ou anexo avulso
const GRUPOS = {
  obrigacao:    { label: 'Obrigação', plural: 'Obrigações', Icone: ClipboardListIcon, ordem: 0 },
  tarefa:       { label: 'Tarefa', plural: 'Tarefas', Icone: CheckSquareIcon, ordem: 1 },
  parcelamento: { label: 'Parcelamento', plural: 'Parcelamentos', Icone: LayersIcon, ordem: 2 },
  avulsa:       { label: 'Avulsa', plural: 'Anexos avulsos', Icone: PaperclipIcon, ordem: 3 },
}
const grupoDe = (g) => GRUPOS[g.grupo] || GRUPOS.obrigacao
// "DAS", "FGTS", "DCTFWeb"… (obrigação); as demais pelo tipo
const tipoObrigacao = (g) => (g.grupo === 'obrigacao' || !g.grupo ? (g.obrigacoes?.tipo || g.titulo || 'Obrigação') : grupoDe(g).plural)
const ORDEM_SITUACAO = ['falhou', 'a_entregar', 'entregue', 'vista', 'aberta']
const porEmpresa = (a, b) => nomeCurto(a.clientes.nome).localeCompare(nomeCurto(b.clientes.nome))
const porTipo = (a, b) => grupoDe(a).ordem - grupoDe(b).ordem || (a.titulo || '').localeCompare(b.titulo || '')
const porVencimento = (a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999'))

// Ordenações da lista: cada uma separa em seções com um título (ou nenhuma)
const ORDENS = {
  empresa:    { label: 'Empresa' },
  tipo:       { label: 'Tipo de obrigação' },
  vencimento: { label: 'Vencimento' },
  situacao:   { label: 'Situação da entrega' },
  valor:      { label: 'Valor (maior primeiro)' },
}

export function montarSecoes(lista, ordem) {
  const agrupar = (chaveDe, tituloDe, ordenarItens) => {
    const mapa = new Map()
    for (const g of lista) {
      const k = chaveDe(g)
      if (!mapa.has(k)) mapa.set(k, { chave: k, ...tituloDe(g), guias: [] })
      mapa.get(k).guias.push(g)
    }
    const secoes = [...mapa.values()]
    secoes.forEach((s) => s.guias.sort(ordenarItens))
    return secoes
  }
  if (ordem === 'tipo') {
    return agrupar(tipoObrigacao, (g) => ({ titulo: tipoObrigacao(g), Icone: grupoDe(g).Icone, ordem: grupoDe(g).ordem }),
      (a, b) => porEmpresa(a, b) || porVencimento(a, b))
      .sort((a, b) => a.ordem - b.ordem || a.titulo.localeCompare(b.titulo))
  }
  if (ordem === 'situacao') {
    return agrupar(situacaoGuia, (g) => ({ titulo: SITUACOES[situacaoGuia(g)].label }), (a, b) => porEmpresa(a, b) || porTipo(a, b))
      .sort((a, b) => ORDEM_SITUACAO.indexOf(a.chave) - ORDEM_SITUACAO.indexOf(b.chave))
  }
  if (ordem === 'vencimento') {
    return [{ chave: 'todas', guias: [...lista].sort((a, b) => porVencimento(a, b) || porEmpresa(a, b)) }]
  }
  if (ordem === 'valor') {
    return [{ chave: 'todas', guias: [...lista].sort((a, b) => (Number(b.valor_guia) || 0) - (Number(a.valor_guia) || 0) || porEmpresa(a, b)) }]
  }
  return agrupar((g) => g.cliente_id, (g) => ({ titulo: nomeCurto(g.clientes.nome), cliente: g.clientes }), porTipo)
    .sort((a, b) => a.titulo.localeCompare(b.titulo))
}

// Resumo de um grupo: quantas guias e em que etapa estão, com uma
// barrinha (verde = aberta, azul = entregue, vermelho = falhou, cinza = a entregar)
export function ResumoEmpresa({ lista }) {
  const n = { aberta: 0, entregue: 0, falhou: 0, a_entregar: 0 }
  for (const g of lista) {
    const s = situacaoGuia(g)
    n[s === 'vista' ? 'entregue' : s]++
  }
  const partes = [
    ['aberta', 'var(--ok)'], ['entregue', 'var(--info)'], ['falhou', 'var(--danger)'], ['a_entregar', 'var(--border)'],
  ]
  const texto = [
    n.a_entregar && `${n.a_entregar} a entregar`,
    n.falhou && `${n.falhou} falhou`,
    n.entregue && `${n.entregue} entregue${n.entregue > 1 ? 's' : ''}`,
    n.aberta && `${n.aberta} aberta${n.aberta > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text3)' }}>
      <span style={{ display: 'inline-flex', width: 70, height: 6, borderRadius: 99, overflow: 'hidden', background: 'var(--border)' }}>
        {partes.map(([k, cor]) => n[k] > 0 && <span key={k} style={{ width: `${(n[k] / lista.length) * 100}%`, background: cor }} />)}
      </span>
      <span><b style={{ color: 'var(--text2)' }}>{lista.length} guia{lista.length > 1 ? 's' : ''}</b>{texto && ` · ${texto}`}</span>
    </span>
  )
}

const selo = { display:'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }

function Metrica({ label, valor, classe = '', onClick, ativo = false }) {
  return (
    <button type="button" className="metric" onClick={onClick}
      style={{ textAlign: 'left', cursor: 'pointer', border: 'none', boxShadow: ativo ? 'inset 0 0 0 2px var(--accent)' : 'none' }}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${classe}`}>{valor}</div>
    </button>
  )
}

// Trilho da guia: A entregar → Entregue → Aberta, com a data embaixo de
// cada etapa concluída. Verde = feito, amarelo = etapa atual (esperando),
// vermelho = envio falhou, cinza = ainda não chegou. Entrega manual não tem
// rastreio de abertura: a última etapa vira o botão "Confirmar".
const COR_ETAPA = {
  feito:    { cor: 'var(--ok)', fundo: 'var(--ok-dim)', linha: 'var(--ok)' },
  atual:    { cor: 'var(--warn)', fundo: 'var(--warn-dim)', linha: 'var(--border)' },
  erro:     { cor: 'var(--danger)', fundo: 'var(--danger-dim)', linha: 'var(--danger)' },
  pendente: { cor: 'var(--text3)', fundo: 'var(--surface)', linha: 'var(--border)' },
}

function haQuanto(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`
}

const CANAL = { manual: 'manual', painel: 'aviso', whatsapp: 'WhatsApp' }
// "2026-11-09…" → "09/11" (cabe embaixo da etapa)
const fmtDiaMes = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : null)

function etapasDaGuia(g) {
  const s = situacaoGuia(g)
  const anexada = g.confirmado_em || g.created_at
  const entregar = {
    estado: g.entregue_em || s === 'falhou' ? 'feito' : 'atual',
    label: 'A entregar', quando: anexada, resumo: 'Anexada em',
    data: anexada ? `anexada ${fmtDiaMes(new Date(anexada).toLocaleDateString('sv-SE'))}` : null,
  }
  // aberta pelo cliente no painel: aberto_vezes conta os downloads/cópias do painel
  // (painel-evento.js); a confirmação manual do escritório não mexe nele
  const abertaNoPainel = !!g.aberto_em && (g.aberto_vezes || 0) > 0
  const dadosAbertura = {
    quando: g.aberto_ultimo_em || g.aberto_em,
    data: `${fmtQuando(g.aberto_ultimo_em || g.aberto_em).replace(',', '')}${g.aberto_vezes > 1 ? ` · ${g.aberto_vezes}x` : ''}`,
    resumo: g.aberto_vezes > 1 ? `Aberta no painel ${g.aberto_vezes}x, a última em` : 'Aberta no painel em',
  }
  let entregue = { estado: 'pendente', label: 'Entregue' }
  if (!g.entregue_em && abertaNoPainel) {
    // o cliente achou a guia no painel antes de ela ser entregue pela Central
    entregar.estado = 'feito'
    entregue = { estado: 'feito', label: 'No painel', quando: g.aberto_em, resumo: 'Encontrada no painel pelo cliente em', data: fmtDiaMes(new Date(g.aberto_em).toLocaleDateString('sv-SE')) }
    return [entregar, entregue, { estado: 'feito', label: 'Aberta', ...dadosAbertura }]
  }
  if (g.entregue_em) {
    entregue = {
      estado: 'feito', label: 'Entregue', manual: g.entrega_canal === 'manual', quando: g.entregue_em,
      resumo: `Entregue (${CANAL[g.entrega_canal] || 'WhatsApp'}) em`,
      data: fmtQuando(g.entregue_em).replace(',', ''),
    }
  } else if (s === 'falhou') {
    entregue = { estado: 'erro', label: 'Falhou', data: fmtDiaMes(g.entrega_erro?.slice(0, 10)) }
  }
  let aberta = { estado: 'pendente', label: 'Aberta' }
  if (g.entregue_em) {
    if (abertaNoPainel) {
      aberta = { estado: 'feito', label: 'Aberta', ...dadosAbertura }
    } else if (g.aberto_em) {
      aberta = {
        estado: 'feito', label: g.entrega_canal === 'manual' ? 'Confirmada' : 'Aberta',
        quando: g.aberto_ultimo_em || g.aberto_em,
        resumo: g.entrega_canal === 'manual' ? 'Confirmada em' : g.aberto_vezes > 1 ? `Aberta ${g.aberto_vezes}x, a última em` : 'Aberta em',
        desfazer: g.entrega_canal === 'manual',
        data: `${fmtQuando(g.aberto_ultimo_em || g.aberto_em).replace(',', '')}${g.aberto_vezes > 1 ? ` · ${g.aberto_vezes}x` : ''}`,
      }
    } else if (g.entrega_canal === 'manual' && !g.visto_em) {
      aberta = { estado: 'pendente', label: 'Aberta', confirmar: true }
    } else if (g.visto_em) {
      // entrega manual: viu o painel conta, e o escritório ainda pode confirmar a abertura
      aberta = { estado: 'atual', label: 'Viu o painel', data: fmtQuando(g.visto_em).replace(',', ''), quando: g.visto_em, resumo: 'Viu o painel em', confirmarLink: g.entrega_canal === 'manual' }
    } else {
      aberta = { estado: 'atual', label: 'Não abriu', data: haQuanto(g.entregue_em) }
    }
  }
  return [entregar, entregue, aberta]
}

function IconeEtapa({ etapa }) {
  if (etapa.estado === 'erro') return <XIcon size={13} />
  if (etapa.estado === 'atual') return <ClockIcon size={13} />
  if (etapa.estado === 'feito') return etapa.manual ? <HandIcon size={12} /> : <CheckIcon size={13} />
  return <span style={{ width: 5, height: 5, borderRadius: 99, background: 'currentColor' }} />
}

// Histórico de cada etapa: abre ao passar o mouse e fica fixo ao clicar
// (clicar fora fecha). Carrega na primeira vez que alguém olha a guia.
const ROTULO_ETAPA = ['A entregar', 'Entregue', 'Aberta']

const fmtCompleto = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(', ', ' às ')

function BalaoLog({ etapa, info, log, carregando, fixo, onFechar }) {
  const itens = log?.[etapa] || []
  return (
    <div onClick={(e) => e.stopPropagation()} style={{
      position: 'absolute', top: 30, left: '50%', transform: 'translateX(-50%)', zIndex: 30, width: 270,
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.14)',
      padding: '8px 10px', textAlign: 'left', cursor: 'default',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <HistoryIcon size={12} style={{ color: 'var(--text3)' }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4, flex: 1 }}>
          Histórico · {ROTULO_ETAPA[etapa]}
        </span>
        {fixo && <button className="btn btn-icon btn-ghost" style={{ padding: 2 }} onClick={onFechar} title="Fechar"><XIcon size={12} /></button>}
      </div>
      {info?.quando && (
        <div style={{ fontSize: 12, color: 'var(--text1)', padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--surface2)' }}>
          {info.resumo || 'Em'} <b>{fmtCompleto(info.quando)}</b>
        </div>
      )}
      {carregando && !log ? <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Carregando…</div>
        : itens.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Nada registrado nessa etapa ainda.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {itens.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
                <span style={{ flex: '0 0 auto', width: 6, height: 6, borderRadius: 99, marginTop: 5, background: i === 0 ? 'var(--accent)' : 'var(--border)' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text1)', fontWeight: 600 }}>{it.texto}</div>
                  <div style={{ color: 'var(--text3)', fontSize: 10.5 }}>
                    {new Date(it.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {it.detalhe && <> · <span style={{ wordBreak: 'break-word' }}>{it.detalhe}</span></>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

export function TrilhoGuia({ g, onConfirmarAbertura }) {
  const etapas = etapasDaGuia(g)
  const [mostrando, setMostrando] = useState(null) // índice da etapa com o balão aberto
  const [fixo, setFixo] = useState(false)
  const [log, setLog] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const raiz = useRef(null)

  // a guia mudou (entregou, abriu…): o histórico guardado fica velho
  const assinatura = `${g.entregue_em}|${g.aberto_em}|${g.aberto_ultimo_em}|${g.visto_em}|${g.entrega_erro}|${g.pago_em}`
  useEffect(() => { setLog(null) }, [assinatura])

  useEffect(() => {
    if (!fixo) return undefined
    const fora = (e) => { if (raiz.current && !raiz.current.contains(e.target)) { setFixo(false); setMostrando(null) } }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [fixo])

  const carregar = () => {
    if (log || carregando) return
    setCarregando(true)
    obterLogGuia(g).then(setLog).catch(() => setLog([[], [], []])).finally(() => setCarregando(false))
  }
  const entrar = (i) => { if (!fixo) { setMostrando(i); carregar() } }
  const sair = () => { if (!fixo) setMostrando(null) }
  const clicar = (i) => {
    if (fixo && mostrando === i) { setFixo(false); setMostrando(null); return }
    setFixo(true); setMostrando(i); carregar()
  }

  return (
    <div ref={raiz} style={{ flex: '0 0 300px', display: 'flex', alignItems: 'flex-start' }}>
      {etapas.map((e, i) => {
        const c = COR_ETAPA[e.estado]
        return (
          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            {i > 0 && <span style={{ position: 'absolute', top: 11, right: '50%', width: '100%', height: 2, background: c.linha }} />}
            <span onMouseEnter={() => entrar(i)} onMouseLeave={sair} onClick={() => clicar(i)}
              title=""
              style={{
                position: 'relative', zIndex: 1, width: 24, height: 24, borderRadius: 99, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                // tom claro por cima de um fundo sólido: a linha do trilho não aparece através da bolinha
                color: c.cor, background: `linear-gradient(${c.fundo}, ${c.fundo}), var(--surface)`,
                border: `2px solid ${e.estado === 'pendente' ? 'var(--border)' : c.cor}`,
                boxShadow: mostrando === i ? `0 0 0 3px ${c.fundo}` : 'none',
              }}><IconeEtapa etapa={e} /></span>
            {mostrando === i && (
              <BalaoLog etapa={i} info={e} log={log} carregando={carregando} fixo={fixo} onFechar={() => { setFixo(false); setMostrando(null) }} />
            )}
            {e.confirmar ? (
              <button className="btn btn-accent btn-sm" style={{ marginTop: 4, fontSize: 11, padding: '2px 8px' }}
                onClick={() => onConfirmarAbertura(true)}
                title="Entrega manual: confirme quando o cliente tiver recebido/aberto a guia">Confirmar</button>
            ) : (
              <span onMouseEnter={() => entrar(i)} onMouseLeave={sair} onClick={() => clicar(i)}
                style={{ marginTop: 4, fontSize: 11, fontWeight: 600, textAlign: 'center', cursor: 'pointer', color: e.estado === 'pendente' ? 'var(--text3)' : c.cor }}>{e.label}</span>
            )}
            {e.data && <span style={{ fontSize: 10.5, color: 'var(--text3)', textAlign: 'center', whiteSpace: 'nowrap' }}>{e.data}</span>}
            {e.confirmarLink && (
              <button className="btn btn-ghost" style={{ fontSize: 10, padding: '0 4px', color: 'var(--accent)' }}
                onClick={() => onConfirmarAbertura(true)} title="Confirmar que o cliente abriu a guia">confirmar</button>
            )}
            {e.desfazer && (
              <button className="btn btn-ghost" style={{ fontSize: 10, padding: '0 4px', color: 'var(--text3)' }}
                onClick={() => onConfirmarAbertura(false)} title="Desfazer a confirmação">desfazer</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function LinhaGuia({ g, mostrarEmpresa, marcada, enviando, onMarcar, onEntregar, onAbrir, onManual, onConfirmarAbertura, semDestino }) {
  const s = situacaoGuia(g)
  const detalhes = [
    g.vencimento && `vence ${fmtData(g.vencimento)}`,
    fmtMoeda(g.valor_guia),
  ].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <input type="checkbox" checked={marcada} onChange={onMarcar} />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        {mostrarEmpresa && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>{nomeCurto(g.clientes.nome)}</div>}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {g.titulo}
          <span style={{ ...selo, padding: '1px 7px', fontSize: 10, color: 'var(--text3)', background: 'var(--surface2)' }}>
            {(() => { const G = grupoDe(g); return <><G.Icone size={10} /> {G.label}</> })()}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>{detalhes || g.nome_arquivo}</div>
        {g.origem && <div style={{ fontSize: 10.5, color: 'var(--text3)', fontStyle: 'italic' }}>{g.origem}</div>}
        {s === 'falhou' && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 2 }}>{g.entrega_erro}</div>}
      </div>
      <TrilhoGuia g={g} onConfirmarAbertura={onConfirmarAbertura} />
      <div style={{ flex: '0 0 196px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button className="btn btn-icon btn-ghost" title="Ver a guia" onClick={onAbrir}><ExternalLinkIcon size={13} /></button>
        {g.entregue_em
          ? <button className="btn btn-icon btn-ghost" title="Desfazer entrega" onClick={() => onManual(false)}><Undo2Icon size={13} /></button>
          : <button className="btn btn-icon btn-ghost" title="Marcar entregue (por fora do WhatsApp)" onClick={() => onManual(true)}><CheckIcon size={13} /></button>}
        <button className={`btn btn-sm ${g.entregue_em ? 'btn-ghost' : 'btn-accent'}`} onClick={onEntregar} disabled={enviando || semDestino}
          title={semDestino ? 'Cadastre o WhatsApp da empresa na aba Empresas' : 'Enviar pelo WhatsApp do escritório'}>
          <SendIcon size={12} /> {enviando ? 'Enviando…' : s === 'falhou' ? 'Tentar de novo' : g.entregue_em ? 'Reenviar' : 'Entregar'}
        </button>
      </div>
    </div>
  )
}

function AbaEmpresas({ show, onSalvo }) {
  const [empresas, setEmpresas] = useState(null)
  const [busca, setBusca] = useState('')
  const [rascunho, setRascunho] = useState({}) // id → whatsapp digitado
  const [grupoDe, setGrupoDe] = useState(null) // empresa escolhendo grupo
  const [, setGruposLidos] = useState(0) // redesenha quando os nomes dos grupos chegam

  useEffect(() => {
    listarEmpresasEntrega().then((l) => {
      setEmpresas(l)
      // empresa já com grupo: busca os nomes para mostrar no lugar do id
      if (l.some((c) => /@g\.us$/.test(c.whatsapp_entrega || ''))) listarGruposWhatsapp().then(() => setGruposLidos((n) => n + 1)).catch(() => {})
    }).catch((e) => { show('Erro: ' + e.message); setEmpresas([]) })
  }, [])

  const escolherGrupo = async (c, g) => {
    setGrupoDe(null)
    setRascunho((r) => { const n = { ...r }; delete n[c.id]; return n })
    if (await salvar(c, { whatsapp_entrega: g.id })) show(`${nomeCurto(c.nome)}: entregas vão para o grupo "${g.nome}".`)
  }

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

  // ao anexar guia dessa empresa, o sistema pergunta se avisa o cliente no
  // WhatsApp com o link do painel (AvisoPainelModal.jsx → painel-aviso-enviar.js)
  const alternarAviso = async (c) => {
    if (!('aviso_guia_painel' in c)) { show('Falta rodar supabase-schema-aviso-guia-painel.sql no Supabase.'); return }
    const ligar = c.aviso_guia_painel === false
    if (await salvar(c, { aviso_guia_painel: ligar })) show(ligar ? 'Ao anexar guia, o sistema vai perguntar se avisa o cliente.' : 'Ao anexar guia, o sistema não vai mais perguntar.')
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
        WhatsApp de entrega: número com DDD ou um grupo ("Escolher grupo" lista os grupos do WhatsApp do escritório). Em branco, usa o telefone do cadastro.
        O aviso com o link do painel vai para esse WhatsApp quando você pede: ao concluir a edição do painel, pelo botão "Notificar cliente" ou na pergunta que aparece ao anexar uma guia (desligue aqui para não perguntar).
      </p>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {lista.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 220px', fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{nomeCurto(c.nome)}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 220 }}>
              <input className="input" style={{ width: '100%' }} placeholder={c.telefone ? `${c.telefone} (cadastro)` : 'sem telefone no cadastro'}
                value={rascunho[c.id] ?? c.whatsapp_entrega ?? ''}
                onChange={(e) => setRascunho((r) => ({ ...r, [c.id]: e.target.value }))}
                onBlur={() => salvarWhatsapp(c)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
              {/@g\.us$/.test(c.whatsapp_entrega || '') && !(c.id in rascunho) && (
                <span style={{ fontSize: 11, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <UsersIcon size={11} /> {nomeDoGrupo(c.whatsapp_entrega) ? `Grupo: ${nomeDoGrupo(c.whatsapp_entrega)}` : 'Grupo do WhatsApp'}
                </span>
              )}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setGrupoDe(c)} title="Escolher um grupo do WhatsApp pelo nome">
              <UsersIcon size={13} /> Escolher grupo
            </button>
            <button className={`btn btn-sm ${c.painel_ativo === false ? 'btn-ghost' : 'btn-ghost'}`} onClick={() => alternarPainel(c)}
              style={{ color: c.painel_ativo === false ? 'var(--text3)' : 'var(--ok)', minWidth: 140 }}
              title={c.painel_ativo === false ? 'Ligar o painel do cliente' : 'Desligar o painel do cliente'}>
              {c.painel_ativo === false ? <><MonitorOffIcon size={13} /> Painel desligado</> : <><MonitorIcon size={13} /> Painel ligado</>}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => alternarAviso(c)} disabled={c.painel_ativo === false}
              style={{ color: c.aviso_guia_painel === false || c.painel_ativo === false ? 'var(--text3)' : 'var(--ok)', minWidth: 150 }}
              title="Ao anexar uma guia desta empresa, perguntar se avisa o cliente no WhatsApp com o link do painel">
              {c.aviso_guia_painel === false || c.painel_ativo === false
                ? <><BellOffIcon size={13} /> Não perguntar ao anexar</> : <><BellIcon size={13} /> Perguntar ao anexar</>}
            </button>
          </div>
        ))}
      </div>
      {grupoDe && (
        <EscolherGrupoModal empresa={grupoDe.nome} atual={grupoDe.whatsapp_entrega}
          onEscolher={(g) => escolherGrupo(grupoDe, g)} onClose={() => setGrupoDe(null)} />
      )}
    </>
  )
}
