// ParcelamentosPage.jsx
// Parcelamentos cadastrados pela própria guia: solte os PDFs (PARCMEI ou
// PGFN-SISPAR), confira empresa e dados lidos, importe. Cada parcelamento
// guarda a conta e o CPF/CNPJ do devedor — o que o robô do servidor vai usar
// pra buscar a guia do mês sozinho (busca_automatica).
import { useEffect, useMemo, useState } from 'react'
import {
  LayersIcon, UploadCloudIcon, FileIcon, XIcon, ChevronDownIcon, ChevronUpIcon,
  AlertTriangleIcon, CheckCircleIcon, ExternalLinkIcon, SearchIcon, RefreshCwIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import {
  ORIGENS, listarParcelamentos, prepararImportacao, salvarGuia, urlDaGuia, atualizarParcelamento,
} from './parcelamentosApi'

const fmtMoeda = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtData = (iso) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—')
const fmtDoc = (d) => {
  const s = (d || '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || '—'
}
const hojeISO = () => new Date().toISOString().slice(0, 10)
const mesAtual = () => hojeISO().slice(0, 7)

const CORES_ORIGEM = {
  PARCMEI: { color: 'var(--info)', bg: 'var(--info-dim)' },
  PGFN:    { color: 'var(--warn)', bg: 'var(--warn-dim)' },
}

const STATUS_BUSCA = {
  ok:                  { label: 'Guia buscada', color: 'var(--ok)' },
  erro:                { label: 'Erro na busca', color: 'var(--danger)' },
  nao_permite_emissao: { label: 'Situação não permite emissão', color: 'var(--danger)' },
  aguardando_captcha:  { label: 'Aguardando captcha', color: 'var(--warn)' },
}

function Selo({ origem }) {
  const c = CORES_ORIGEM[origem] || { color: 'var(--text2)', bg: 'var(--surface2)' }
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 99, color: c.color, background: c.bg }}>
      {ORIGENS[origem]?.label || origem || 'Manual'}
    </span>
  )
}

export default function ParcelamentosPage() {
  const clientes = useStore((s) => s.clientes)
  const { show } = useToast()

  const [parcelamentos, setParcelamentos] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [itens, setItens] = useState([])
  const [lendo, setLendo] = useState(false)
  const [importando, setImportando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroOrigem, setFiltroOrigem] = useState('todos')
  const [aberto, setAberto] = useState(null)

  const carregar = async () => {
    setCarregando(true)
    try { setParcelamentos(await listarParcelamentos()) }
    catch (e) { show?.('Erro ao carregar parcelamentos: ' + e.message) }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  // ---------- importação ----------
  const adicionarArquivos = async (fileList) => {
    const pdfs = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
    if (!pdfs.length) { show?.('Só PDF de guia.'); return }
    setLendo(true)
    try {
      const novos = await prepararImportacao(pdfs, clientes, parcelamentos)
      setItens((prev) => [...prev, ...novos.map((i) => ({ ...i, ignorar: i.duplicada || !!i.erro }))])
    } catch (e) { show?.('Erro ao ler: ' + e.message) }
    setLendo(false)
  }

  const atualizarItem = (chave, patch) => setItens((prev) => prev.map((i) => (i.chave === chave ? { ...i, ...patch } : i)))
  const prontos = itens.filter((i) => i.dados && !i.ignorar)
  const semEmpresa = prontos.filter((i) => !i.clienteId).length

  const importar = async () => {
    setImportando(true)
    let ok = 0, ligadas = 0
    const falhas = []
    // mais antigas primeiro: o parcelamento termina com os dados da guia mais nova
    const ordem = [...prontos].sort((a, b) => (a.dados.vencimento || '').localeCompare(b.dados.vencimento || ''))
    for (const it of ordem) {
      try {
        const r = await salvarGuia(it)
        ok++
        if (r.ligadaObrigacao) ligadas++
        setItens((prev) => prev.filter((p) => p.chave !== it.chave))
      } catch (e) {
        falhas.push(`${it.arquivo.name}: ${e.message}`)
      }
    }
    setImportando(false)
    await carregar()
    show?.(falhas.length
      ? `${ok} importada(s); ${falhas.length} com erro — ${falhas.join('; ')}`
      : `${ok} guia(s) importada(s)${ligadas ? `, ${ligadas} ligada(s) à obrigação do mês` : ''}`)
  }

  // ---------- lista ----------
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return parcelamentos.filter((p) => {
      if (filtroOrigem !== 'todos' && (p.origem || 'manual') !== filtroOrigem) return false
      if (!t) return true
      return [p.clientes?.nome, p.nome_devedor, p.conta, p.documento_devedor].some((v) => (v || '').toLowerCase().includes(t))
    })
  }, [parcelamentos, busca, filtroOrigem])

  const stats = useMemo(() => {
    const ativos = parcelamentos.filter((p) => p.status === 'ativo')
    const mes = mesAtual()
    return {
      ativos: ativos.length,
      comGuiaDoMes: ativos.filter((p) => (p.ultima_guia_vencimento || '').startsWith(mes)).length,
      alertas: parcelamentos.filter((p) => ['erro', 'nao_permite_emissao'].includes(p.ultima_busca_status)).length,
      mensal: ativos.reduce((s, p) => s + Number(p.valor_parcela || 0), 0),
    }
  }, [parcelamentos])

  const abrirGuia = async (g) => {
    try { window.open(await urlDaGuia(g.storage_path), '_blank', 'noopener') }
    catch (e) { show?.('Não consegui abrir a guia: ' + e.message) }
  }

  const alternarBusca = async (p) => {
    try { await atualizarParcelamento(p.id, { busca_automatica: !p.busca_automatica }); await carregar() }
    catch (e) { show?.('Erro: ' + e.message) }
  }

  const mudarStatus = async (p, status) => {
    try { await atualizarParcelamento(p.id, { status }); await carregar() }
    catch (e) { show?.('Erro: ' + e.message) }
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <LayersIcon size={18} /> Parcelamentos
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Solte as guias (PARCMEI ou PGFN) — o parcelamento é cadastrado e atualizado pela própria guia.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={carregar} title="Atualizar"><RefreshCwIcon size={13} /></button>
      </div>

      <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 16 }}>
        <div className="metric"><div className="metric-label">Ativos</div><div className="metric-value">{stats.ativos}</div></div>
        <div className="metric"><div className="metric-label">Com guia deste mês</div><div className="metric-value ok">{stats.comGuiaDoMes}/{stats.ativos}</div></div>
        <div className="metric"><div className="metric-label">Total mensal</div><div className="metric-value">{fmtMoeda(stats.mensal)}</div></div>
        <div className="metric"><div className="metric-label">Alertas</div><div className={`metric-value ${stats.alertas ? 'danger' : ''}`}>{stats.alertas}</div></div>
      </div>

      {/* Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionarArquivos(e.dataTransfer.files) }}
        style={{
          border: `2px dashed ${arrastando ? 'var(--accent)' : 'var(--border2)'}`, borderRadius: 'var(--r-lg)',
          padding: '22px 16px', textAlign: 'center', marginBottom: 16, transition: 'all .15s',
          background: arrastando ? 'var(--accent-dim)' : 'var(--surface)',
        }}
      >
        <UploadCloudIcon size={24} color="var(--text3)" style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {lendo ? 'Lendo guias…' : <>Arraste guias de parcelamento aqui, ou{' '}
            <label style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
              selecione
              <input type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }}
                onChange={(e) => { adicionarArquivos(e.target.files); e.target.value = '' }} />
            </label></>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>DAS do PARCMEI ou DAS/DARF da PGFN (SISPAR) — PDF</div>
      </div>

      {itens.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text1)' }}>Conferir antes de importar ({itens.length})</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setItens([])} disabled={importando}>Limpar</button>
              <button className="btn btn-accent btn-sm" onClick={importar} disabled={importando || !prontos.length || semEmpresa > 0}
                title={semEmpresa ? 'Escolha a empresa das guias sem empresa' : ''}>
                {importando ? 'Importando…' : `Importar ${prontos.length} guia${prontos.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {itens.map((it) => (
              <div key={it.chave} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px',
                background: it.ignorar ? 'var(--surface2)' : 'var(--surface)', opacity: it.ignorar ? 0.65 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <FileIcon size={14} color="var(--text3)" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)', flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.arquivo.name}
                  </span>
                  {it.dados && <Selo origem={it.dados.origem} />}
                  {it.duplicada && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--warn)' }}>já importada</span>}
                  {it.dados && (
                    <label style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={it.ignorar} onChange={(e) => atualizarItem(it.chave, { ignorar: e.target.checked })} /> ignorar
                    </label>
                  )}
                  <button className="btn btn-icon btn-ghost" onClick={() => setItens((p) => p.filter((x) => x.chave !== it.chave))}><XIcon size={13} /></button>
                </div>

                {it.erro && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertTriangleIcon size={13} /> {it.erro}
                  </div>
                )}

                {it.dados && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) 2fr', gap: 10, marginTop: 8, alignItems: 'center' }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
                      <div><b>{it.dados.nome}</b> · {fmtDoc(it.dados.documento)}</div>
                      <div>
                        Conta {it.dados.conta}
                        {it.dados.parcela ? ` · parcela ${it.dados.parcela}/${it.dados.totalParcelas}` : it.dados.competencia ? ` · competência ${it.dados.competencia}` : ''}
                      </div>
                      <div>{fmtMoeda(it.dados.valor)} · vence {fmtData(it.dados.vencimento)}</div>
                    </div>
                    <div>
                      <EmpresaCombobox empresas={clientes} value={it.clienteId || ''} onChange={(id) => atualizarItem(it.chave, { clienteId: id, como: 'manual' })} />
                      <div style={{ fontSize: 10.5, marginTop: 3, color: it.clienteId ? 'var(--text3)' : 'var(--danger)' }}>
                        {it.clienteId ? `Empresa achada por ${it.como}` : 'Empresa não encontrada — escolha acima'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {[['todos', 'Todos'], ['PARCMEI', 'PARCMEI'], ['PGFN', 'PGFN'], ['manual', 'Manuais']].map(([k, l]) => (
            <button key={k} className={`tab-btn ${filtroOrigem === k ? 'active' : ''}`} onClick={() => setFiltroOrigem(k)}>{l}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <SearchIcon size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text3)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Empresa, conta ou CPF/CNPJ" style={{ paddingLeft: 28 }} />
        </div>
      </div>

      {carregando && <div className="center"><div className="spinner" /></div>}
      {!carregando && filtrados.length === 0 && (
        <div className="empty"><p>📋</p><p>Nenhum parcelamento ainda — solte uma guia acima.</p></div>
      )}

      {!carregando && filtrados.map((p) => {
        const progresso = p.total_parcelas && p.parcela_atual ? Math.min(100, Math.round((p.parcela_atual / p.total_parcelas) * 100)) : null
        const statusBusca = STATUS_BUSCA[p.ultima_busca_status]
        const guiaDoMes = (p.ultima_guia_vencimento || '').startsWith(mesAtual())
        return (
          <div key={p.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>{p.clientes?.nome || p.nome_devedor || '—'}</span>
                  <Selo origem={p.origem} />
                  {p.status !== 'ativo' && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{p.status}</span>}
                  {guiaDoMes && <span style={{ fontSize: 10.5, color: 'var(--ok)', display: 'flex', gap: 3, alignItems: 'center' }}><CheckCircleIcon size={11} /> guia do mês</span>}
                  {statusBusca && <span style={{ fontSize: 10.5, fontWeight: 700, color: statusBusca.color }} title={p.ultima_busca_msg || ''}>{statusBusca.label}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3 }}>
                  {p.conta ? `Conta ${p.conta}` : p.numero_processo || ''}
                  {p.documento_devedor ? ` · ${fmtDoc(p.documento_devedor)}` : ''}
                  {p.valor_parcela ? ` · ${fmtMoeda(p.valor_parcela)}/mês` : ''}
                  {p.ultima_guia_vencimento ? ` · última guia vence ${fmtData(p.ultima_guia_vencimento)}` : ''}
                </div>
                {progresso != null && (
                  <div style={{ marginTop: 7 }}>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>
                      Parcela {p.parcela_atual} de {p.total_parcelas} · faltam {p.total_parcelas - p.parcela_atual}
                    </div>
                    <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 99 }}>
                      <div style={{ height: '100%', width: `${progresso}%`, background: 'var(--ok)', borderRadius: 99 }} />
                    </div>
                  </div>
                )}
              </div>
              <button className="btn btn-icon btn-ghost" onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                {aberto === p.id ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
              </button>
            </div>

            {aberto === p.id && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  {p.origem && (
                    <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!p.busca_automatica} onChange={() => alternarBusca(p)} />
                      Buscar a guia automaticamente todo mês
                    </label>
                  )}
                  <select value={p.status} onChange={(e) => mudarStatus(p, e.target.value)} style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}>
                    {['ativo', 'quitado', 'inadimplente', 'cancelado'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {p.ultima_busca_msg && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{p.ultima_busca_msg}</span>}
                </div>

                {p.guias.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhuma guia anexada.</div>}
                <div style={{ display: 'grid', gap: 5 }}>
                  {p.guias.map((g) => {
                    const vencida = !g.pago_em && g.vencimento_guia && g.vencimento_guia < hojeISO()
                    return (
                      <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 'var(--r-sm)', background: 'var(--surface2)', fontSize: 11.5 }}>
                        <span style={{ width: 54, color: 'var(--text3)', fontWeight: 700 }}>{g.parcela_numero ? `#${g.parcela_numero}` : '—'}</span>
                        <span style={{ flex: 1, color: 'var(--text2)' }}>
                          Vence {fmtData(g.vencimento_guia)} · {fmtMoeda(g.valor_guia)}
                          {!g.obrigacao_id && <span style={{ color: 'var(--text3)' }}> · sem obrigação</span>}
                        </span>
                        <span style={{ fontWeight: 700, color: g.pago_em ? 'var(--ok)' : vencida ? 'var(--danger)' : 'var(--warn)' }}>
                          {g.pago_em ? `Paga ${fmtData(g.pago_em)}` : vencida ? 'Vencida' : 'Em aberto'}
                        </span>
                        <button className="btn btn-icon btn-ghost" title="Abrir guia" onClick={() => abrirGuia(g)}><ExternalLinkIcon size={13} /></button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
