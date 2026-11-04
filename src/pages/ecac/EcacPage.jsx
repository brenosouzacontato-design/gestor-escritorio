// EcacPage.jsx
// Fiscal → Situação e-CAC: situação fiscal de cada empresa na Receita e os
// pagamentos achados no e-CAC, alimentados pelo robô do servidor 24h
// (deploy/robo-parcelamentos/ecac.py). Pagamento que bateu com uma guia
// anexada já deu baixa nela; o que não bateu fica aqui para conferência.
import { useEffect, useMemo, useState } from 'react'
import {
  ShieldCheckIcon, RefreshCwIcon, SearchIcon, ChevronDownIcon, ChevronUpIcon, FileTextIcon,
  AlertTriangleIcon, CheckCircleIcon, LockIcon, ClockIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import { listarSituacaoEcac, definirMonitorar, urlArquivo, faltaSchema, DIAS_PAGAMENTOS } from './ecacApi'

const fmtMoeda = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtData = (iso) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—')
const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const fmtCnpj = (c) => (c?.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c || 'sem CNPJ')

const STATUS_ROBO = {
  ok:                 { label: 'Consultada', color: 'var(--ok)', Icon: CheckCircleIcon },
  erro:               { label: 'Erro na consulta', color: 'var(--danger)', Icon: AlertTriangleIcon },
  sem_procuracao:     { label: 'Sem procuração', color: 'var(--danger)', Icon: LockIcon },
  aguardando_captcha: { label: 'Aguardando captcha', color: 'var(--warn)', Icon: ClockIcon },
}

function SeloSituacao({ situacao }) {
  const s = situacao?.situacao_geral
  const [txt, cor, fundo] = s === 'regular' ? ['Regular', 'var(--ok)', 'var(--ok-dim)']
    : s === 'pendente' ? ['Pendente', 'var(--danger)', 'var(--danger-dim)']
    : ['Sem relatório', 'var(--text3)', 'var(--surface2)']
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: cor, background: fundo, whiteSpace: 'nowrap' }}>{txt}</span>
}

const th = { textAlign: 'left', fontWeight: 600, color: 'var(--text3)', padding: '4px 6px', fontSize: 11, whiteSpace: 'nowrap' }
const td = { padding: '4px 6px', fontSize: 11.5, color: 'var(--text2)', borderTop: '1px solid var(--border)' }

function Tabela({ colunas, linhas }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{colunas.map((c) => <th key={c} style={th}>{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} style={td}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export default function EcacPage() {
  const clientes = useStore((s) => s.clientes)
  const { show } = useToast()
  const [linhas, setLinhas] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [semSchema, setSemSchema] = useState(false)
  const [filtro, setFiltro] = useState('todas')
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState(null)

  const carregar = async () => {
    setCarregando(true)
    try { setLinhas(await listarSituacaoEcac(clientes)); setSemSchema(false) }
    catch (e) {
      if (faltaSchema(e)) setSemSchema(true)
      else show?.('Erro ao carregar: ' + e.message)
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [clientes])

  const stats = useMemo(() => {
    const mon = linhas.filter((l) => l.monitorar && l.temCnpj)
    return {
      monitoradas: mon.length,
      consultadas: mon.filter((l) => l.ecac?.status === 'ok').length,
      regulares: mon.filter((l) => l.situacao?.situacao_geral === 'regular').length,
      pendentes: mon.filter((l) => l.situacao?.situacao_geral === 'pendente').length,
      problemas: mon.filter((l) => ['erro', 'sem_procuracao'].includes(l.ecac?.status)).length,
      semGuia: mon.reduce((s, l) => s + l.pagamentosSemGuia, 0),
      baixadas: mon.reduce((s, l) => s + l.pagamentos.filter((p) => p.guia_id).length, 0),
      ultima: mon.map((l) => l.ecac?.ultima_consulta_em).filter(Boolean).sort().pop(),
    }
  }, [linhas])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const tD = t.replace(/\D/g, '')
    return linhas.filter((l) => {
      if (filtro === 'nao_monitoradas') { if (l.monitorar && l.temCnpj) return false }
      else if (!l.monitorar || !l.temCnpj) return false
      if (filtro === 'pendentes' && l.situacao?.situacao_geral !== 'pendente') return false
      if (filtro === 'problemas' && !['erro', 'sem_procuracao'].includes(l.ecac?.status)) return false
      if (filtro === 'sem_guia' && !l.pagamentosSemGuia) return false
      if (!t) return true
      return l.nome.toLowerCase().includes(t) || (tD && l.cnpj.includes(tD))
    }).sort((a, b) => {
      // pendências primeiro
      const peso = (l) => (l.situacao?.situacao_geral === 'pendente' ? 0 : ['erro', 'sem_procuracao'].includes(l.ecac?.status) ? 1 : 2)
      return peso(a) - peso(b) || a.nome.localeCompare(b.nome)
    })
  }, [linhas, filtro, busca])

  const abrir = async (path) => {
    try { window.open(await urlArquivo(path), '_blank', 'noopener') }
    catch (e) { show?.('Não consegui abrir: ' + e.message) }
  }

  const alternarMonitorar = async (l) => {
    try { await definirMonitorar(l.id, !l.monitorar); await carregar() }
    catch (e) { show?.('Erro: ' + e.message) }
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheckIcon size={18} /> Situação e-CAC
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Situação fiscal na Receita e pagamentos achados no e-CAC pelo robô (certificado do escritório).
            {stats.ultima && <> Última consulta: {fmtDataHora(stats.ultima)}.</>}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={carregar} title="Atualizar"><RefreshCwIcon size={13} /></button>
      </div>

      {semSchema && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--warn)', fontSize: 13 }}>
          Falta criar as tabelas: rode <b>supabase-schema-ecac.sql</b> no SQL Editor do Supabase.
        </div>
      )}

      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)', marginBottom: 16 }}>
        <div className="metric"><div className="metric-label">Consultadas</div><div className="metric-value">{stats.consultadas}/{stats.monitoradas}</div></div>
        <div className="metric"><div className="metric-label">Regulares</div><div className="metric-value ok">{stats.regulares}</div></div>
        <div className="metric"><div className="metric-label">Com pendência</div><div className={`metric-value ${stats.pendentes ? 'danger' : ''}`}>{stats.pendentes}</div></div>
        <div className="metric"><div className="metric-label">Sem procuração / erro</div><div className={`metric-value ${stats.problemas ? 'warn' : ''}`}>{stats.problemas}</div></div>
        <div className="metric"><div className="metric-label">Pagamentos ({DIAS_PAGAMENTOS} dias)</div>
          <div className="metric-value" style={{ fontSize: 15 }}>{stats.baixadas} com guia · <span style={{ color: stats.semGuia ? 'var(--warn)' : undefined }}>{stats.semGuia} sem</span></div></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[['todas', 'Todas'], ['pendentes', 'Com pendência'], ['problemas', 'Sem procuração / erro'], ['sem_guia', 'Pagamento sem guia'], ['nao_monitoradas', 'Fora do robô']].map(([k, l]) => (
            <button key={k} className={`tab-btn ${filtro === k ? 'active' : ''}`} onClick={() => setFiltro(k)}>{l}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <SearchIcon size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text3)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Empresa ou CNPJ" style={{ paddingLeft: 28 }} />
        </div>
      </div>

      {carregando && <div className="center"><div className="spinner" /></div>}
      {!carregando && filtradas.length === 0 && <div className="empty"><p>🛡️</p><p>Nenhuma empresa neste filtro.</p></div>}

      {!carregando && filtradas.map((l) => {
        const st = STATUS_ROBO[l.ecac?.status]
        const exp = aberto === l.id
        const s = l.situacao
        return (
          <div key={l.id} className="card" style={{ marginBottom: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setAberto(exp ? null : l.id)}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text1)' }}>{l.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtCnpj(l.cnpj)}</div>
              </div>
              <SeloSituacao situacao={s} />
              <div style={{ fontSize: 11.5, color: 'var(--text2)', minWidth: 210, lineHeight: 1.5 }}>
                {s ? <>
                  <div>Relatório de {fmtData(s.data_emissao || s.created_at)}</div>
                  <div>
                    {l.totalDebitos ? <span style={{ color: 'var(--danger)' }}>Débitos {fmtMoeda(l.totalDebitos)}</span> : 'Sem débitos'}
                    {l.totalDividaAtiva ? <> · <span style={{ color: 'var(--danger)' }}>Dív. ativa {fmtMoeda(l.totalDividaAtiva)}</span></> : ''}
                    {l.qtdParcelamentos ? ` · ${l.qtdParcelamentos} parc.` : ''}
                  </div>
                </> : <span style={{ color: 'var(--text3)' }}>Nenhum relatório ainda</span>}
              </div>
              <div style={{ fontSize: 11.5, minWidth: 150 }}>
                {st ? <span style={{ color: st.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}><st.Icon size={12} /> {st.label}</span>
                  : <span style={{ color: 'var(--text3)' }}>Ainda não consultada</span>}
                <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{l.ecac?.ultima_consulta_em ? fmtDataHora(l.ecac.ultima_consulta_em) : ''}</div>
              </div>
              <div style={{ fontSize: 11.5, color: l.pagamentosSemGuia ? 'var(--warn)' : 'var(--text3)', minWidth: 90, textAlign: 'right' }}>
                {l.pagamentos.length} pagto{l.pagamentos.length !== 1 ? 's' : ''}{l.pagamentosSemGuia ? ` · ${l.pagamentosSemGuia} sem guia` : ''}
              </div>
              {exp ? <ChevronUpIcon size={15} color="var(--text3)" /> : <ChevronDownIcon size={15} color="var(--text3)" />}
            </div>

            {exp && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {l.ecac?.mensagem && (
                  <div style={{ fontSize: 11.5, color: st?.color || 'var(--text2)' }}>Robô: {l.ecac.mensagem}</div>
                )}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {s?.storage_path && (
                    <button className="btn btn-ghost btn-sm" onClick={() => abrir(s.storage_path)}><FileTextIcon size={12} /> Relatório de situação fiscal</button>
                  )}
                  <label style={{ fontSize: 11.5, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5, cursor: l.temCnpj ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={l.monitorar && l.temCnpj} disabled={!l.temCnpj} onChange={() => alternarMonitorar(l)} />
                    Consultar no e-CAC {l.temCnpj ? '' : '(cadastre o CNPJ)'}
                  </label>
                </div>

                {s?.debitos?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>Débitos na Receita</div>
                    <Tabela colunas={['Tributo', 'Competência', 'Vencimento', 'Saldo', 'Situação']}
                      linhas={s.debitos.map((d) => [d.tributo, d.competencia || '—', fmtData(d.vencimento), fmtMoeda(d.valor), d.situacao || '—'])} />
                  </div>
                )}
                {s?.dividas_ativas?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>Dívida ativa (PGFN)</div>
                    <Tabela colunas={['Inscrição', 'Tributo', 'Valor', 'Situação']}
                      linhas={s.dividas_ativas.map((d) => [d.inscricao || '—', d.tributo || '—', fmtMoeda(d.valor), d.situacao || '—'])} />
                  </div>
                )}
                {s?.parcelamentos?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>Parcelamentos</div>
                    <Tabela colunas={['Modalidade', 'Parcelas', 'Valor']}
                      linhas={s.parcelamentos.map((p) => [p.modalidade, p.parcelas || '—', fmtMoeda(p.valor)])} />
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)', marginBottom: 4 }}>
                    Pagamentos no e-CAC (últimos {DIAS_PAGAMENTOS} dias)
                  </div>
                  {l.pagamentos.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Nenhum pagamento encontrado.</div> : (
                    <Tabela colunas={['Pago em', 'Tipo', 'Receita', 'Período', 'Vencimento', 'Valor', 'Guia no gestor']}
                      linhas={l.pagamentos.map((p) => [
                        fmtData(p.data_arrecadacao), p.tipo_documento || '—',
                        [p.codigo_receita, p.descricao_receita].filter(Boolean).join(' - ') || '—',
                        p.periodo_apuracao || '—', fmtData(p.data_vencimento), fmtMoeda(p.valor_total),
                        p.guia
                          ? <span style={{ color: 'var(--ok)' }} title={p.como_cruzou === 'numero_documento' ? 'Bateu pelo número do documento' : 'Bateu por valor e vencimento'}>
                              ✓ {p.guia.obrigacoes?.titulo || p.guia.obrigacoes?.tipo || p.guia.nome_arquivo}{p.guia.obrigacoes?.competencia ? ` (${p.guia.obrigacoes.competencia})` : ''}
                            </span>
                          : <span style={{ color: 'var(--warn)' }}>sem guia anexada</span>,
                      ])} />
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
