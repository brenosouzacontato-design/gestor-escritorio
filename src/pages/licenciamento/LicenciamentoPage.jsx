import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileBadgeIcon, PlusIcon, XIcon, PaperclipIcon, BellIcon, SearchIcon, UploadCloudIcon, FileIcon, DownloadIcon,
  Loader2Icon, SparklesIcon, CopyIcon, CheckIcon, Trash2Icon, ArchiveIcon, ArchiveRestoreIcon, ExternalLinkIcon, BadgeCheckIcon,
} from 'lucide-react'
import { useToast } from '../../components/shared'
import { abrirLinkAssinado } from '../documentos/documentosApi'
import { perguntarAssessor } from '../assessor/assessorApi'
import {
  TIPOS, ETAPAS, nomeLicenca, hojeISO, diasAte, faixa, licencasNaoCriada, listarLicencas, listarAnexosLicencas,
  salvarLicenca, registrarEmissao, listarClientesAtivos, arquivarLicenca, excluirLicenca, anexarDocumentoLicenca, textoPedidoCliente, perguntaAssessor,
} from './licenciamentoApi'

const FAIXAS = [
  { id: 'vencida',   nome: 'Vencidas',     cor: 'var(--danger)' },
  { id: 'ate30',     nome: 'Até 30 dias',  cor: 'var(--warn)' },
  { id: 'ate90',     nome: '31 a 90 dias', cor: 'var(--text2)' },
  { id: 'renovacao', nome: 'Em renovação', cor: 'var(--accent)' },
  { id: 'em_dia',    nome: 'Em dia',       cor: 'var(--ok)' },
]

const fmtData = (iso) => { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function Situacao({ l, hoje }) {
  const d = diasAte(l.data_validade, hoje)
  const prazo = d === null ? 'sem vencimento' : d < 0 ? `vencida há ${-d}d` : d === 0 ? 'vence hoje' : `${d} dias`
  if (l.etapa) {
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
        <span className="badge" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{ETAPAS[l.etapa]}</span>
        <span style={{ fontSize: 10.5, color: d !== null && d < 0 ? 'var(--danger)' : 'var(--text3)' }}>{prazo}</span>
      </span>
    )
  }
  const f = faixa(l, hoje)
  const classe = f === 'vencida' ? 'badge-err' : f === 'ate30' ? 'badge-warn' : f === 'ate90' ? 'badge-gray' : 'badge-ok'
  return <span className={`badge ${classe}`}>{f === 'em_dia' && d !== null ? 'em dia' : prazo}</span>
}

const VAZIA = {
  cliente_id: '', tipo: 'funcionamento', descricao: '', orgao: TIPOS.funcionamento.orgao, numero: '', municipio: '',
  data_emissao: '', data_validade: '', etapa: '', protocolo: '', observacao: '',
  checklist: TIPOS.funcionamento.checklist.map((texto) => ({ texto, ok: false })), avisos_texto: '60, 30', criar_tarefa: true,
}

export default function LicenciamentoPage() {
  const hoje = hojeISO()
  const [licencas, setLicencas] = useState(null)
  const [anexos, setAnexos] = useState([])
  const [semTabela, setSemTabela] = useState(false)
  const [erro, setErro] = useState(null)
  const [clientes, setClientes] = useState([])
  const [filtroFaixa, setFiltroFaixa] = useState(null)
  const [filtroTipo, setFiltroTipo] = useState('')
  const [busca, setBusca] = useState('')
  const [arquivadas, setArquivadas] = useState(false)
  const [aberta, setAberta] = useState(null) // licença | VAZIA
  const { show } = useToast()

  const carregar = () => {
    setErro(null)
    listarLicencas({ arquivadas })
      .then((d) => { setLicencas(d); setSemTabela(false) })
      .catch((e) => { if (licencasNaoCriada(e)) setSemTabela(true); else setErro(e.message); setLicencas([]) })
    listarAnexosLicencas().then(setAnexos).catch(() => setAnexos([]))
  }
  useEffect(() => { setLicencas(null); carregar() }, [arquivadas]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listarClientesAtivos().then(setClientes).catch(() => {}) }, [])

  const anexosPor = useMemo(() => {
    const m = new Map()
    for (const a of anexos) { if (!m.has(a.licenca_id)) m.set(a.licenca_id, []); m.get(a.licenca_id).push(a) }
    return m
  }, [anexos])

  const contagem = useMemo(() => {
    const c = Object.fromEntries(FAIXAS.map((f) => [f.id, 0]))
    for (const l of licencas || []) c[faixa(l, hoje)]++
    return c
  }, [licencas, hoje])

  const lista = useMemo(() => {
    const t = sem(busca.trim())
    const ordem = Object.fromEntries(FAIXAS.map((f, i) => [f.id, i]))
    return (licencas || [])
      .filter((l) => !filtroFaixa || faixa(l, hoje) === filtroFaixa)
      .filter((l) => !filtroTipo || l.tipo === filtroTipo)
      .filter((l) => !t || sem(l.clientes?.nome).includes(t) || sem(nomeLicenca(l)).includes(t) || sem(l.orgao).includes(t) || sem(l.numero).includes(t))
      .sort((a, b) => (ordem[faixa(a, hoje)] - ordem[faixa(b, hoje)]) || String(a.data_validade || '9999').localeCompare(String(b.data_validade || '9999')))
  }, [licencas, filtroFaixa, filtroTipo, busca, hoje])

  const abrir = (l) => setAberta({
    ...l, descricao: l.descricao || '', orgao: l.orgao || '', numero: l.numero || '', municipio: l.municipio || l.clientes?.municipio || '',
    data_emissao: l.data_emissao || '', data_validade: l.data_validade || '', etapa: l.etapa || '', protocolo: l.protocolo || '',
    observacao: l.observacao || '', checklist: l.checklist || [], avisos_texto: (l.avisos_dias || []).join(', '),
  })

  const th = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', whiteSpace: 'nowrap' }
  const td = { padding: '8px 12px', whiteSpace: 'nowrap' }

  return (
    <div className="page" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
      <div className="section-hdr" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileBadgeIcon size={18} /> Licenciamento
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Alvarás e licenças das empresas. O grupo do WhatsApp recebe um aviso antes de cada vencimento.
          </p>
        </div>
        {!semTabela && (
          <button className="btn btn-sm btn-accent" onClick={() => setAberta({ ...VAZIA, checklist: VAZIA.checklist.map((i) => ({ ...i })) })}>
            <PlusIcon size={14} /> Nova licença
          </button>
        )}
      </div>

      {semTabela ? (
        <div className="card" style={{ fontSize: 13, color: 'var(--text2)' }}>
          O Licenciamento ainda não foi ativado no banco de dados. Falta rodar o arquivo <code>supabase-schema-licencas.sql</code> no Supabase.
        </div>
      ) : (
        <>
          {!arquivadas && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              {FAIXAS.map((f) => (
                <button key={f.id} type="button" className="card" onClick={() => setFiltroFaixa((x) => x === f.id ? null : f.id)}
                  style={{ textAlign: 'left', cursor: 'pointer', padding: '10px 14px', outline: filtroFaixa === f.id ? `2px solid ${f.cor}` : 'none' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: f.cor }}>{f.nome}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text1)' }}>{licencas ? contagem[f.id] : '…'}</div>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px' }}>
              <SearchIcon size={14} color="var(--text3)" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa, licença, órgão ou número"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', padding: '8px 0', fontSize: 13, color: 'var(--text1)' }} />
            </label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} style={{ ...campo0, width: 'auto', flex: '0 0 auto' }}>
              <option value="">Todos os tipos</option>
              {Object.entries(TIPOS).map(([id, t]) => <option key={id} value={id}>{t.nome}</option>)}
            </select>
            <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={arquivadas} onChange={(e) => { setArquivadas(e.target.checked); setFiltroFaixa(null) }} />
              Arquivadas
            </label>
          </div>

          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          {!erro && !licencas && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>}
          {licencas && lista.length === 0 && !erro && (
            <div className="empty">
              <p>📄</p>
              {licencas.length === 0 ? (arquivadas ? 'Nenhuma licença arquivada.' : 'Cadastre o primeiro alvará em "Nova licença".') : 'Nenhuma licença com esse filtro.'}
            </div>
          )}

          {lista.length > 0 && (
            <div className="tabela-rolagem" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <th style={th}>Empresa</th><th style={th}>Licença</th><th style={th}>Órgão</th><th style={th}>Número</th>
                    <th style={th}>Validade</th><th style={th}>Situação</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((l) => {
                    const qtdAnexos = anexosPor.get(l.id)?.length || 0
                    const feitos = (l.checklist || []).filter((i) => i.ok).length
                    return (
                      <tr key={l.id} onClick={() => abrir(l)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                        <td style={{ ...td, color: 'var(--text1)', fontWeight: 500 }}>{l.clientes?.nome || '—'}</td>
                        <td style={td}>{nomeLicenca(l)}</td>
                        <td style={{ ...td, color: 'var(--text2)' }}>{l.orgao || '—'}</td>
                        <td style={{ ...td, color: 'var(--text2)' }}>{l.numero || '—'}</td>
                        <td style={td}>{fmtData(l.data_validade)}</td>
                        <td style={td}><Situacao l={l} hoje={hoje} /></td>
                        <td style={{ ...td, color: 'var(--text3)', fontSize: 11.5 }}>
                          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                            {l.etapa && l.checklist?.length > 0 && <span title="Checklist da renovação">{feitos}/{l.checklist.length}</span>}
                            {qtdAnexos > 0 && <span title={`${qtdAnexos} anexo(s)`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><PaperclipIcon size={12} />{qtdAnexos}</span>}
                            {l.data_validade && l.avisos_dias?.length > 0 && <span title={`Aviso ${l.avisos_dias.join(' e ')} dias antes`}><BellIcon size={12} /></span>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {aberta && (
        <FichaLicenca inicial={aberta} clientes={clientes} anexos={anexosPor.get(aberta.id) || []} hoje={hoje}
          onClose={() => setAberta(null)}
          onMudou={(msg, fechar = true) => { if (msg) show(msg); if (fechar) setAberta(null); carregar() }} />
      )}
    </div>
  )
}

const campo0 = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text1)', outline: 'none' }
const campo = { ...campo0, width: '100%' }
const rotulo = { fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 4 }
const caixa = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }
const titulo = { fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }

function Texto({ texto }) {
  return String(texto || '').split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
}

function FichaLicenca({ inicial, clientes, anexos: anexosIniciais, hoje, onClose, onMudou }) {
  const [l, setL] = useState(inicial)
  const [anexos, setAnexos] = useState(anexosIniciais)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(null)
  const [novoItem, setNovoItem] = useState('')
  const [emissao, setEmissao] = useState(null) // { numero, data_emissao, data_validade }
  const [enviando, setEnviando] = useState(false)
  const [assessor, setAssessor] = useState(null) // { carregando } | { texto, fontes } | { erro }
  const [copiado, setCopiado] = useState(false)
  const inputArquivo = useRef(null)
  const set = (k) => (e) => setL((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const trocarTipo = (e) => {
    const tipo = e.target.value
    setL((x) => {
      const antigo = TIPOS[x.tipo]
      const orgaoPadrao = !x.orgao || x.orgao === antigo?.orgao
      const checklistPadrao = !x.checklist.length || x.checklist.every((i, k) => i.texto === antigo?.checklist[k] && !i.ok)
      return {
        ...x, tipo,
        orgao: orgaoPadrao ? TIPOS[tipo].orgao : x.orgao,
        checklist: checklistPadrao ? TIPOS[tipo].checklist.map((texto) => ({ texto, ok: false })) : x.checklist,
      }
    })
  }
  const trocarCliente = (e) => {
    const c = clientes.find((x) => x.id === e.target.value)
    setL((x) => ({ ...x, cliente_id: e.target.value, municipio: x.municipio || c?.municipio || '' }))
  }
  const marcar = (k) => setL((x) => ({ ...x, checklist: x.checklist.map((i, j) => j === k ? { ...i, ok: !i.ok } : i) }))
  const tirar = (k) => setL((x) => ({ ...x, checklist: x.checklist.filter((_, j) => j !== k) }))
  const incluir = () => { if (!novoItem.trim()) return; setL((x) => ({ ...x, checklist: [...x.checklist, { texto: novoItem.trim(), ok: false }] })); setNovoItem('') }

  const validar = () => {
    if (!l.cliente_id) return 'Escolha a empresa.'
    if (l.tipo === 'outro' && !l.descricao.trim()) return 'Dê um nome para a licença.'
    if (l.data_emissao && l.data_validade && l.data_validade < l.data_emissao) return 'A validade está antes da emissão.'
    return null
  }
  const salvar = async ({ fechar = true } = {}) => {
    const v = validar()
    if (v) { setErro(v); return null }
    setSalvando(true); setErro(null)
    try {
      const salva = await salvarLicenca(l, inicial.id ? inicial : null)
      setSalvando(false)
      onMudou(fechar ? 'Licença salva' : null, fechar)
      return salva
    } catch (e) { setErro(e.message); setSalvando(false); return null }
  }

  const enviarArquivos = async (arquivos) => {
    if (!arquivos.length) return
    let id = l.id
    if (!id) {
      const salva = await salvar({ fechar: false })
      if (!salva) return
      id = salva.id
      setL((x) => ({ ...x, id }))
    }
    setEnviando(true); setErro(null)
    try {
      for (const arquivo of arquivos) {
        const doc = await anexarDocumentoLicenca({ clienteId: l.cliente_id, licencaId: id, arquivo })
        setAnexos((a) => [doc, ...a])
      }
      onMudou('Documento anexado', false)
    } catch (e) { setErro(e.message) }
    setEnviando(false)
  }

  const concluirEmissao = async () => {
    if (!emissao.data_validade && !window.confirm('Sem data de validade a licença fica como "sem vencimento". Continuar?')) return
    setSalvando(true); setErro(null)
    try {
      const salva = await salvarLicenca(l, inicial.id ? inicial : null)
      await registrarEmissao({ ...l, ...salva }, emissao)
      onMudou('Emissão registrada — avisos recomeçam pela nova validade')
    } catch (e) { setErro(e.message); setSalvando(false) }
  }

  const copiarPedido = async () => {
    const cliente = clientes.find((c) => c.id === l.cliente_id)
    try {
      await navigator.clipboard.writeText(textoPedidoCliente({ ...l, clientes: cliente ? { nome: cliente.nome } : l.clientes }))
      setCopiado(true); setTimeout(() => setCopiado(false), 2000)
    } catch { setErro('Não consegui copiar. Selecione o texto manualmente.') }
  }

  const perguntar = async () => {
    setAssessor({ carregando: true })
    try {
      const r = await perguntarAssessor({ modo: 'chat', mensagens: [{ role: 'user', content: perguntaAssessor(l) }] })
      setAssessor({ texto: r.texto, fontes: r.fontes || [] })
    } catch (e) { setAssessor({ erro: e.message }) }
  }

  const d = diasAte(l.data_validade, hoje)
  const feitos = l.checklist.filter((i) => i.ok).length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>{inicial.id ? `${nomeLicenca(l)} — ${l.clientes?.nome || ''}` : 'Nova licença'}</h3>
            {l.data_validade && (
              <p style={{ fontSize: 12, marginTop: 2, color: d < 0 ? 'var(--danger)' : d <= 30 ? 'var(--warn)' : 'var(--text3)' }}>
                {d < 0 ? `Vencida há ${-d} dias` : d === 0 ? 'Vence hoje' : `Vence em ${d} dias`} ({fmtData(l.data_validade)})
              </p>
            )}
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Fechar"><XIcon size={18} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {/* ── Dados da licença ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={rotulo}>Empresa *</label>
              <select value={l.cliente_id} onChange={trocarCliente} style={campo} disabled={!!inicial.id}>
                <option value="">— escolha —</option>
                {inicial.id && !clientes.some((c) => c.id === l.cliente_id) && <option value={l.cliente_id}>{l.clientes?.nome}</option>}
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={rotulo}>Tipo</label>
                <select value={l.tipo} onChange={trocarTipo} style={campo}>
                  {Object.entries(TIPOS).map(([id, t]) => <option key={id} value={id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label style={rotulo}>Órgão</label>
                <input value={l.orgao} onChange={set('orgao')} style={campo} />
              </div>
            </div>
            {l.tipo === 'outro' && (
              <div>
                <label style={rotulo}>Nome da licença *</label>
                <input value={l.descricao} onChange={set('descricao')} placeholder="Ex.: Licença da Polícia Civil" style={campo} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={rotulo}>Número</label><input value={l.numero} onChange={set('numero')} style={campo} /></div>
              <div><label style={rotulo}>Município</label><input value={l.municipio} onChange={set('municipio')} style={campo} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={rotulo}>Emissão</label><input type="date" value={l.data_emissao} onChange={set('data_emissao')} style={campo} /></div>
              <div><label style={rotulo}>Validade</label><input type="date" value={l.data_validade} onChange={set('data_validade')} style={campo} /></div>
            </div>
            <div style={caixa}>
              <div style={{ ...titulo, display: 'flex', alignItems: 'center', gap: 5 }}><BellIcon size={12} /> Avisos</div>
              <label style={{ fontSize: 12.5, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                Avisar no WhatsApp
                <input value={l.avisos_texto} onChange={set('avisos_texto')} style={{ ...campo0, width: 90, padding: '4px 8px' }} />
                dias antes e no dia do vencimento
              </label>
              <label style={{ fontSize: 12.5, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={l.criar_tarefa} onChange={set('criar_tarefa')} />
                Criar tarefa de renovação no primeiro aviso
              </label>
              {l.tarefa_id && <p style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 6 }}>Tarefa de renovação já aberta em Tarefas.</p>}
            </div>
            <div>
              <label style={rotulo}>Observações</label>
              <textarea value={l.observacao} onChange={set('observacao')} rows={2} style={{ ...campo, resize: 'vertical' }} />
            </div>

            <div style={caixa}>
              <div style={{ ...titulo, display: 'flex', alignItems: 'center', gap: 5 }}><PaperclipIcon size={12} /> Documentos</div>
              {anexos.length === 0 && <p style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhum documento anexado.</p>}
              {anexos.map((a) => (
                <button key={a.id} type="button" onClick={() => abrirLinkAssinado(a.storage_path).catch((e) => setErro(e.message))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12.5, color: 'var(--text1)', textAlign: 'left' }}>
                  <FileIcon size={13} color="var(--text3)" />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome_arquivo}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtData(a.created_at?.slice(0, 10))}</span>
                  <DownloadIcon size={13} color="var(--text3)" />
                </button>
              ))}
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => inputArquivo.current?.click()} disabled={enviando}>
                {enviando ? <Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <UploadCloudIcon size={13} />}
                {enviando ? 'Enviando...' : 'Anexar documento'}
              </button>
              <input ref={inputArquivo} type="file" multiple style={{ display: 'none' }}
                onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; enviarArquivos(f) }} />
            </div>
          </div>

          {/* ── Emissão / renovação ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={caixa}>
              <div style={titulo}>Emissão / renovação</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={rotulo}>Etapa</label>
                  <select value={l.etapa} onChange={set('etapa')} style={campo}>
                    <option value="">Nada em andamento</option>
                    {Object.entries(ETAPAS).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                  </select>
                </div>
                <div>
                  <label style={rotulo}>Protocolo</label>
                  <input value={l.protocolo} onChange={set('protocolo')} placeholder="nº do processo" style={campo} />
                </div>
              </div>

              <div style={{ fontSize: 11.5, color: 'var(--text3)', margin: '12px 0 6px' }}>
                Documentos exigidos {l.checklist.length > 0 && `· ${feitos} de ${l.checklist.length}`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {l.checklist.map((i, k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    <input type="checkbox" checked={i.ok} onChange={() => marcar(k)} />
                    <span style={{ flex: 1, color: i.ok ? 'var(--text3)' : 'var(--text1)', textDecoration: i.ok ? 'line-through' : 'none' }}>{i.texto}</span>
                    <button type="button" className="btn btn-icon btn-ghost" title="Tirar item" onClick={() => tirar(k)} style={{ padding: 2 }}><XIcon size={12} /></button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={novoItem} onChange={(e) => setNovoItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') incluir() }}
                  placeholder="Incluir documento exigido" style={{ ...campo, padding: '6px 10px' }} />
                <button type="button" className="btn btn-sm" onClick={incluir}><PlusIcon size={13} /></button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm" onClick={copiarPedido}>
                  {copiado ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copiado ? 'Copiado' : 'Copiar pedido ao cliente'}
                </button>
                {inicial.id && !emissao && (
                  <button type="button" className="btn btn-sm" onClick={() => setEmissao({ numero: l.numero, data_emissao: hoje, data_validade: '' })}>
                    <BadgeCheckIcon size={13} /> Registrar emissão
                  </button>
                )}
              </div>
              {emissao && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)', marginBottom: 8 }}>Licença emitida — dados do novo documento</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div><label style={rotulo}>Número</label><input value={emissao.numero || ''} onChange={(e) => setEmissao({ ...emissao, numero: e.target.value })} style={campo} /></div>
                    <div><label style={rotulo}>Emissão</label><input type="date" value={emissao.data_emissao} onChange={(e) => setEmissao({ ...emissao, data_emissao: e.target.value })} style={campo} /></div>
                    <div><label style={rotulo}>Nova validade</label><input type="date" value={emissao.data_validade} onChange={(e) => setEmissao({ ...emissao, data_validade: e.target.value })} style={campo} /></div>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: '6px 0 8px' }}>Encerra a etapa, desmarca o checklist para o próximo ciclo e dá baixa na tarefa de renovação. Anexe o alvará novo em Documentos.</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEmissao(null)}>Cancelar</button>
                    <button type="button" className="btn btn-sm btn-accent" onClick={concluirEmissao} disabled={salvando}>Confirmar emissão</button>
                  </div>
                </div>
              )}
            </div>

            <div style={caixa}>
              <div style={{ ...titulo, display: 'flex', alignItems: 'center', gap: 5 }}><SparklesIcon size={12} /> Assessor</div>
              {!assessor && (
                <>
                  <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Pesquisa em sites oficiais os documentos, taxas e prazos{l.municipio ? ` em ${l.municipio}` : ' do município'}.</p>
                  <button type="button" className="btn btn-sm" onClick={perguntar}><SparklesIcon size={13} /> Perguntar requisitos</button>
                </>
              )}
              {assessor?.carregando && <p style={{ fontSize: 12.5, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6 }}><Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Pesquisando em fontes oficiais… pode levar 1 a 2 minutos.</p>}
              {assessor?.erro && <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{assessor.erro} <button type="button" className="btn btn-sm btn-ghost" onClick={perguntar}>Tentar de novo</button></p>}
              {assessor?.texto && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                  <Texto texto={assessor.texto} />
                  {assessor.fontes.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3, whiteSpace: 'normal' }}>
                      {assessor.fontes.map((f) => (
                        <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <ExternalLinkIcon size={11} /> {f.titulo}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {erro && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{erro}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {inicial.id && (
              <>
                <button className="btn btn-sm btn-ghost" onClick={async () => {
                  try { await arquivarLicenca(inicial.id, !inicial.arquivada); onMudou(inicial.arquivada ? 'Licença reativada' : 'Licença arquivada') } catch (e) { setErro(e.message) }
                }}>
                  {inicial.arquivada ? <ArchiveRestoreIcon size={13} /> : <ArchiveIcon size={13} />} {inicial.arquivada ? 'Reativar' : 'Arquivar'}
                </button>
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={async () => {
                  if (!window.confirm('Excluir esta licença? Os documentos anexados continuam em Documentos.')) return
                  try { await excluirLicenca(inicial.id); onMudou('Licença excluída') } catch (e) { setErro(e.message) }
                }}>
                  <Trash2Icon size={13} /> Excluir
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn btn-accent" onClick={() => salvar()} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
