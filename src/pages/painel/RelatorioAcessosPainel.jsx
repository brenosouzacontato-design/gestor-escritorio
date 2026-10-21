import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  EyeIcon, DownloadIcon, SmartphoneIcon, TabletIcon, MonitorIcon, HelpCircleIcon, ChevronDownIcon, ChevronRightIcon,
  Building2Icon, EyeOffIcon, UsersIcon, SearchIcon, FileSpreadsheetIcon, BriefcaseIcon,
} from 'lucide-react'
import { obterEventosPainelPeriodo } from './painelApi'
import { descreverAparelho } from './aparelho'

// Relatório de interação dos clientes com o painel compartilhado (Painéis →
// Relatório de acessos): quem abriu, quantas vezes, o que baixou e de qual
// aparelho. Fonte: painel_eventos (gravada por netlify/functions/painel-evento.js
// a cada abertura/download do link público). O aparelho é o id anônimo que o
// navegador do cliente guarda (aparelho.js) + o user agent — só existe nos
// eventos gravados depois de supabase-schema-painel-eventos-aparelho.sql.

// data local "AAAA-MM-DD" (toISOString usaria UTC: depois das 21h "hoje" virava amanhã)
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const hojeIso = () => isoLocal(new Date())
function diasAtras(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoLocal(d)
}
function inicioMes(deslocamento = 0) {
  const d = new Date()
  return isoLocal(new Date(d.getFullYear(), d.getMonth() + deslocamento, 1))
}
function fimMes(deslocamento = 0) {
  const d = new Date()
  return isoLocal(new Date(d.getFullYear(), d.getMonth() + deslocamento + 1, 0))
}
const PERIODOS = [
  { id: '7', label: '7 dias', desde: () => diasAtras(6), ate: hojeIso },
  { id: '30', label: '30 dias', desde: () => diasAtras(29), ate: hojeIso },
  { id: 'mes', label: 'Este mês', desde: () => inicioMes(0), ate: hojeIso },
  { id: 'mes_anterior', label: 'Mês passado', desde: () => inicioMes(-1), ate: () => fimMes(-1) },
]

const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
function haQuanto(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 60) return `há ${Math.max(min, 1)} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '')

const ICONE_TIPO = { celular: SmartphoneIcon, tablet: TabletIcon, computador: MonitorIcon, desconhecido: HelpCircleIcon }

// Aparelhos de uma empresa, na ordem em que apareceram ("Aparelho 1, 2...").
// Evento sem aparelho_id (gravado antes do script) agrupa pelo user agent; sem
// nenhum dos dois, vira "não identificado".
function chaveAparelho(ev) {
  return ev.aparelho_id || (ev.user_agent ? `ua:${ev.user_agent}` : null)
}
function aparelhosDaEmpresa(eventosCrescentes) {
  const mapa = new Map()
  for (const ev of eventosCrescentes) {
    const chave = chaveAparelho(ev)
    if (!chave || mapa.has(chave)) continue
    mapa.set(chave, { chave, numero: mapa.size + 1, ...descreverAparelho(ev.user_agent) })
  }
  return mapa
}

export default function RelatorioAcessosPainel({ clientes }) {
  const [periodo, setPeriodo] = useState('30')
  const [desde, setDesde] = useState(diasAtras(29))
  const [ate, setAte] = useState(hojeIso())
  const [carteira, setCarteira] = useState('todas')
  const [busca, setBusca] = useState('')
  const [incluirEscritorio, setIncluirEscritorio] = useState(false)
  const [filtroSituacao, setFiltroSituacao] = useState('todas') // todas | abriram | nao_abriram | baixaram
  const [eventos, setEventos] = useState(null)
  const [erro, setErro] = useState(null)
  const [aberta, setAberta] = useState(null) // id da empresa expandida

  const escolherPeriodo = (id) => {
    const p = PERIODOS.find((x) => x.id === id)
    setPeriodo(id)
    if (p) { setDesde(p.desde()); setAte(p.ate()) }
  }

  useEffect(() => {
    if (!desde || !ate || desde > ate) return
    let ativo = true
    setEventos(null)
    setErro(null)
    obterEventosPainelPeriodo(desde, ate)
      .then((e) => ativo && setEventos(e))
      .catch((e) => ativo && setErro(e.message))
    return () => { ativo = false }
  }, [desde, ate])

  const carteiras = useMemo(() => {
    const set = new Set(clientes.map((c) => c.carteira || ''))
    return [...set].sort((a, b) => (a || 'zzz').localeCompare(b || 'zzz'))
  }, [clientes])

  const linhas = useMemo(() => {
    if (!eventos) return []
    const visiveis = incluirEscritorio ? eventos : eventos.filter((e) => e.origem !== 'escritorio')
    const porCliente = new Map()
    for (const ev of visiveis) {
      if (!porCliente.has(ev.cliente_id)) porCliente.set(ev.cliente_id, [])
      porCliente.get(ev.cliente_id).push(ev)
    }
    const termo = busca.trim().toLowerCase()
    return clientes
      .filter((c) => carteira === 'todas' || (c.carteira || '') === carteira)
      .filter((c) => !termo || `${c.nome} ${c.cnpj || ''}`.toLowerCase().includes(termo))
      .map((c) => {
        const evs = porCliente.get(c.id) || [] // decrescente (mais recente primeiro)
        const aberturas = evs.filter((e) => e.tipo === 'visualizacao')
        const downloads = evs.filter((e) => e.tipo === 'download')
        const aparelhos = aparelhosDaEmpresa([...evs].reverse())
        return {
          cliente: c, eventos: evs, aberturas: aberturas.length, downloads: downloads.length,
          ultima: evs[0]?.criado_em || null, ultimaAbertura: aberturas[0]?.criado_em || null, aparelhos,
        }
      })
      .filter((l) => filtroSituacao === 'todas'
        || (filtroSituacao === 'abriram' && l.aberturas > 0)
        || (filtroSituacao === 'nao_abriram' && l.aberturas === 0)
        || (filtroSituacao === 'baixaram' && l.downloads > 0))
      .sort((a, b) => (b.ultima || '').localeCompare(a.ultima || '') || a.cliente.nome.localeCompare(b.cliente.nome))
  }, [eventos, clientes, carteira, busca, incluirEscritorio, filtroSituacao])

  const resumo = useMemo(() => {
    const total = linhas.length
    const abriram = linhas.filter((l) => l.aberturas > 0).length
    const aparelhos = linhas.reduce((s, l) => s + l.aparelhos.size, 0)
    return {
      total, abriram, naoAbriram: total - abriram,
      aberturas: linhas.reduce((s, l) => s + l.aberturas, 0),
      downloads: linhas.reduce((s, l) => s + l.downloads, 0),
      baixaram: linhas.filter((l) => l.downloads > 0).length,
      aparelhos,
    }
  }, [linhas])

  const exportarCsv = () => {
    const cab = ['Empresa', 'CNPJ', 'Carteira', 'Data/hora', 'Ação', 'Detalhe', 'Competência', 'Aparelho', 'Origem']
    const linhasCsv = []
    for (const l of linhas) {
      for (const ev of l.eventos) {
        const ap = l.aparelhos.get(chaveAparelho(ev))
        linhasCsv.push([
          l.cliente.nome, l.cliente.cnpj || '', l.cliente.carteira || '', fmtDataHora(ev.criado_em),
          ev.tipo === 'download' ? 'Baixou' : 'Abriu o painel', ev.descricao || '', ev.competencia || '',
          ap ? `Aparelho ${ap.numero} — ${ap.nome}` : 'Não identificado', ev.origem === 'escritorio' ? 'Escritório' : 'Cliente',
        ])
      }
      if (l.eventos.length === 0) linhasCsv.push([l.cliente.nome, l.cliente.cnpj || '', l.cliente.carteira || '', '', 'Não abriu no período', '', '', '', ''])
    }
    const csv = [cab, ...linhasCsv].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `acessos-painel_${desde}_a_${ate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const semAparelho = eventos && eventos.length > 0 && eventos.every((e) => !('user_agent' in e))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filtros */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
            {PERIODOS.map((p) => (
              <button key={p.id} onClick={() => escolherPeriodo(p.id)}
                style={{ border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: periodo === p.id ? 'var(--navy)' : 'transparent', color: periodo === p.id ? '#fff' : 'var(--text2)' }}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="date" value={desde} max={ate} onChange={(e) => { setPeriodo('custom'); setDesde(e.target.value) }} style={{ width: 'auto' }} />
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>até</span>
          <input type="date" value={ate} min={desde} onChange={(e) => { setPeriodo('custom'); setAte(e.target.value) }} style={{ width: 'auto' }} />
          <button className="btn" onClick={exportarCsv} disabled={!eventos || linhas.length === 0} style={{ marginLeft: 'auto', padding: '6px 12px' }}>
            <FileSpreadsheetIcon size={13} /> Exportar CSV
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={carteira} onChange={(e) => setCarteira(e.target.value)} style={{ width: 'auto', minWidth: 170 }}>
            <option value="todas">Todas as carteiras</option>
            {carteiras.map((c) => <option key={c || '_'} value={c}>{c || 'Sem carteira'}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 9px', flex: 1, minWidth: 180 }}>
            <SearchIcon size={13} color="var(--text3)" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa..."
              style={{ border: 'none', outline: 'none', background: 'none', fontSize: 12.5, padding: 0, width: '100%' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}
            title="Aberturas feitas em navegadores com o login do gestor (o escritório conferindo o link)">
            <input type="checkbox" checked={incluirEscritorio} onChange={(e) => setIncluirEscritorio(e.target.checked)} />
            Incluir acessos do escritório
          </label>
        </div>
      </div>

      {erro && <div className="notice" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>Não consegui carregar os acessos: {erro}</div>}
      {semAparelho && (
        <div className="notice notice-info" style={{ fontSize: 12 }}>
          Os aparelhos aparecem a partir dos acessos gravados depois de rodar <b>supabase-schema-painel-eventos-aparelho.sql</b> no Supabase.
        </div>
      )}

      {/* Resumo — também filtra a tabela */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <CardResumo icone={<Building2Icon size={14} />} titulo="Abriram o painel" valor={`${resumo.abriram} de ${resumo.total}`}
          sub={resumo.total ? `${Math.round((resumo.abriram / resumo.total) * 100)}% das empresas` : '—'} cor="var(--ok)"
          ativo={filtroSituacao === 'abriram'} onClick={() => setFiltroSituacao(filtroSituacao === 'abriram' ? 'todas' : 'abriram')} />
        <CardResumo icone={<EyeOffIcon size={14} />} titulo="Não abriram" valor={resumo.naoAbriram} sub="no período" cor="var(--danger)"
          ativo={filtroSituacao === 'nao_abriram'} onClick={() => setFiltroSituacao(filtroSituacao === 'nao_abriram' ? 'todas' : 'nao_abriram')} />
        <CardResumo icone={<EyeIcon size={14} />} titulo="Aberturas" valor={resumo.aberturas} sub="vezes que o painel foi aberto" cor="var(--info)" />
        <CardResumo icone={<DownloadIcon size={14} />} titulo="Downloads" valor={resumo.downloads} sub={resumo.baixaram === 1 ? '1 empresa baixou' : `${resumo.baixaram} empresas baixaram`} cor="var(--accent)"
          ativo={filtroSituacao === 'baixaram'} onClick={() => setFiltroSituacao(filtroSituacao === 'baixaram' ? 'todas' : 'baixaram')} />
        <CardResumo icone={<SmartphoneIcon size={14} />} titulo="Aparelhos" valor={resumo.aparelhos} sub="diferentes, somando as empresas" cor="var(--navy2, var(--text2))" />
      </div>

      {/* Tabela por empresa */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--surface)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '8px 12px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          {['', 'Empresa', 'Última abertura', 'Aberturas', 'Downloads', 'Aparelhos'].map((h, i) => (
            <span key={i} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', textAlign: i >= 3 ? 'center' : 'left' }}>{h}</span>
          ))}
        </div>
        {!eventos && !erro && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Carregando acessos...</div>}
        {eventos && linhas.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Nenhuma empresa com esse filtro.</div>}
        {linhas.map((l, i) => {
          const expandida = aberta === l.cliente.id
          const semAcesso = l.eventos.length === 0
          return (
            <Fragment key={l.cliente.id}>
              <div onClick={() => !semAcesso && setAberta(expandida ? null : l.cliente.id)}
                style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center', padding: '9px 12px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)', cursor: semAcesso ? 'default' : 'pointer',
                  background: expandida ? 'var(--surface2)' : 'transparent',
                  borderLeft: `3px solid ${semAcesso ? 'var(--danger)' : l.downloads > 0 ? 'var(--ok)' : 'var(--info)'}` }}>
                <span style={{ color: 'var(--text3)', display: 'flex' }}>
                  {!semAcesso && (expandida ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nomeCurto(l.cliente.nome)}
                  </span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10.5, color: 'var(--text3)' }}>
                    {l.cliente.cnpj && <span>{l.cliente.cnpj}</span>}
                    {l.cliente.carteira && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><BriefcaseIcon size={10} /> {l.cliente.carteira}</span>}
                  </span>
                </span>
                <span style={{ fontSize: 12 }}>
                  {l.ultimaAbertura
                    ? <><span style={{ color: 'var(--text1)', fontWeight: 600 }}>{haQuanto(l.ultimaAbertura)}</span><span style={{ display: 'block', fontSize: 10.5, color: 'var(--text3)' }}>{fmtDataHora(l.ultimaAbertura)}</span></>
                    : <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Não abriu</span>}
                </span>
                <Contagem valor={l.aberturas} cor="var(--info)" />
                <Contagem valor={l.downloads} cor="var(--ok)" />
                <span style={{ display: 'flex', justifyContent: 'center', gap: 3, flexWrap: 'wrap' }}>
                  {[...l.aparelhos.values()].map((ap) => {
                    const Icone = ICONE_TIPO[ap.tipo] || HelpCircleIcon
                    return (
                      <span key={ap.chave} title={`Aparelho ${ap.numero} — ${ap.nome}`}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 6,
                          background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                        <Icone size={13} />
                      </span>
                    )
                  })}
                  {l.aparelhos.size === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>—</span>}
                </span>
              </div>
              {expandida && <LinhaDoTempo linha={l} />}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

const GRID = '18px minmax(160px, 2.2fr) minmax(110px, 1fr) 80px 80px minmax(90px, 1fr)'

function Contagem({ valor, cor }) {
  return (
    <span style={{ textAlign: 'center', fontSize: 14, fontWeight: 800, color: valor > 0 ? cor : 'var(--text3)' }}>{valor}</span>
  )
}

function CardResumo({ icone, titulo, valor, sub, cor, ativo, onClick }) {
  return (
    <div onClick={onClick} title={onClick ? 'Clique para filtrar a tabela' : undefined}
      style={{ background: ativo ? `color-mix(in srgb, ${cor}, transparent 88%)` : 'var(--surface)', border: `1px solid ${ativo ? cor : 'var(--border)'}`,
        borderRadius: 'var(--r-md)', padding: '11px 13px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
        <span style={{ color: cor, display: 'flex' }}>{icone}</span> {titulo}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: cor, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</div>
    </div>
  )
}

function LinhaDoTempo({ linha }) {
  return (
    <div style={{ background: 'var(--surface2)', padding: '4px 12px 12px 42px', borderTop: '1px solid var(--border)' }}>
      {linha.aparelhos.size > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          {[...linha.aparelhos.values()].map((ap) => {
            const Icone = ICONE_TIPO[ap.tipo] || HelpCircleIcon
            const usos = linha.eventos.filter((e) => chaveAparelho(e) === ap.chave).length
            return (
              <span key={ap.chave} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '3px 10px', color: 'var(--text2)' }}>
                <Icone size={12} color="var(--accent)" /> Aparelho {ap.numero} · {ap.nome}
                <span style={{ color: 'var(--text3)', fontWeight: 500 }}>({usos} {usos === 1 ? 'acesso' : 'acessos'})</span>
              </span>
            )
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {linha.eventos.map((ev) => {
          const ap = linha.aparelhos.get(chaveAparelho(ev))
          const download = ev.tipo === 'download'
          return (
            <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: download ? 'var(--ok-dim)' : 'var(--info-dim)', color: download ? 'var(--ok)' : 'var(--info)' }}>
                {download ? <DownloadIcon size={12} /> : <EyeIcon size={12} />}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {download ? <>Baixou <b>{ev.descricao || 'um arquivo'}</b></> : <>Abriu o painel{ev.competencia ? <> · competência <b>{ev.competencia}</b></> : null}</>}
              </span>
              {ev.origem === 'escritorio' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: 'var(--warn)', background: 'var(--warn-dim)', borderRadius: 99, padding: '1px 7px', flexShrink: 0 }}>
                  <UsersIcon size={10} /> escritório
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {ap ? `Aparelho ${ap.numero} · ${ap.nome}` : 'aparelho não identificado'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text2)', flexShrink: 0, whiteSpace: 'nowrap', width: 108, textAlign: 'right' }}>{fmtDataHora(ev.criado_em)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
