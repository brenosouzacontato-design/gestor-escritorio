import { useEffect, useState } from 'react'
import { KeyRoundIcon, CalculatorIcon, LayersIcon, FileTextIcon, FileDownIcon, SendIcon, RefreshCwIcon, AlertTriangleIcon, UploadIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import { cabecalhosFunctions } from '../../lib/supabase'
import EmpresaCombobox from '../../components/EmpresaCombobox'

// Integra Contador (API oficial do SERPRO): recálculo de DARF (Sicalc), DAS do Simples (PGDAS-D) e
// DAS das parcelas dos parcelamentos do Simples/MEI. Servidor: netlify/functions/integra-contador.js.
// Ver docs/integra-contador.md. Cada consulta/emissão é cobrada pelo SERPRO por requisição.

async function chamar(acao, dados = {}) {
  const r = await fetch('/.netlify/functions/integra-contador', {
    method: 'POST', headers: await cabecalhosFunctions(), body: JSON.stringify({ acao, ...dados }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(corpo.erro || corpo.error || `Erro ${r.status}`)
  return corpo
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const rotulo = { fontSize: 11, color: 'var(--text2)', marginBottom: 3, display: 'block' }
const campo = { width: '100%', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text1)', fontSize: 13 }
const grade = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }
const td = { padding: '6px 8px', borderTop: '1px solid var(--border)', fontSize: 12, verticalAlign: 'middle' }
const brl = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
const amanha = () => { const d = new Date(Date.now() + 86400000); return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) }
const mesPassado = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }
const TIPO = { darf: 'DARF', das: 'DAS', parcela: 'Parcela' }
const TIPOS_PA = [['ME', 'Mensal (MM/AAAA)'], ['TR', 'Trimestral (T/AAAA)'], ['AN', 'Anual (AAAA)'], ['QZ', 'Quinzenal (QQ/MM/AAAA)'],
  ['DC', 'Decendial (DD/MM/AAAA)'], ['SM', 'Semanal (SS/MM/AAAA)'], ['DI', 'Diário (DD/MM/AAAA)']]

function Campo({ label, children, dica }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={rotulo}>{label}</span>
      {children}
      {dica && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{dica}</span>}
    </label>
  )
}

// ---------------------------------------------------------------- configuração
function Configuracao({ status, onSalvo }) {
  const { show } = useToast()
  const [arquivo, setArquivo] = useState(null)
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)
  const cert = status?.certificado

  const salvar = async () => {
    if (!arquivo || !senha) { show('Escolha o arquivo .pfx e digite a senha'); return }
    setSalvando(true)
    try {
      const b64 = await new Promise((ok, erro) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result).split(',')[1])
        r.onerror = erro
        r.readAsDataURL(arquivo)
      })
      await chamar('salvar_certificado', { pfx_base64: b64, senha })
      setSenha(''); setArquivo(null)
      show('Certificado do escritório guardado')
      onSalvo()
    } catch (e) { show(e.message) } finally { setSalvando(false) }
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <KeyRoundIcon size={16} /> <b style={{ fontSize: 14 }}>Configuração</b>
        {status?.ambiente === 'trial' && <span className="badge badge-warn">Demonstração (dados simulados)</span>}
      </div>
      <div style={{ ...grade, fontSize: 12, marginBottom: 12 }}>
        <div>Chaves do SERPRO no Netlify: <b style={{ color: status?.chaves ? 'var(--accent)' : 'var(--warn)' }}>{status?.chaves ? 'ok' : 'faltando'}</b></div>
        <div>Certificado do escritório: {cert
          ? <b style={{ color: cert.dias_restantes < 30 ? 'var(--warn)' : 'var(--accent)' }}>{cert.titular} · vence {dataBR(cert.valido_ate)}</b>
          : <b style={{ color: 'var(--warn)' }}>não cadastrado</b>}</div>
      </div>
      <div style={{ ...grade, alignItems: 'end' }}>
        <Campo label={cert ? 'Trocar certificado A1 (e-CNPJ do escritório)' : 'Certificado A1 (e-CNPJ do escritório, .pfx)'}>
          <input type="file" accept=".pfx,.p12" onChange={(e) => setArquivo(e.target.files[0] || null)} style={{ fontSize: 12 }} />
        </Campo>
        <Campo label="Senha do certificado">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} style={campo} autoComplete="off" />
        </Campo>
        <div><button className="btn" onClick={salvar} disabled={salvando}><UploadIcon size={14} /> {salvando ? 'Guardando…' : 'Guardar certificado'}</button></div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        Tem de ser o mesmo e-CNPJ usado para contratar o Integra Contador. Fica cifrado no banco; a senha nunca volta para o navegador.
        Cada empresa precisa ter dado procuração no e-CAC ao CNPJ do escritório para os serviços usados aqui.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- resultado de uma guia
function Resultado({ r, onEnviar }) {
  if (!r) return null
  const g = r.guia
  return (
    <div style={{ marginTop: 12, padding: 12, background: 'var(--surface2)', borderRadius: 8 }}>
      <div style={{ ...grade, fontSize: 12, marginBottom: 10 }}>
        <div>Principal<br /><b>{brl(g.principal)}</b></div>
        <div>Multa<br /><b>{brl(g.multa)}</b></div>
        <div>Juros<br /><b>{brl(g.juros)}</b></div>
        <div>Total<br /><b style={{ fontSize: 15 }}>{brl(g.total)}</b></div>
        <div>Pagar até<br /><b>{dataBR(g.validade)}</b></div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn btn-accent" href={r.url} target="_blank" rel="noopener noreferrer"><FileDownIcon size={14} /> Abrir PDF</a>
        <button className="btn" onClick={() => onEnviar(g)} disabled={!!g.documento_id}><SendIcon size={14} /> {g.documento_id ? 'Já está em Documentos' : 'Enviar para Documentos do cliente'}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- DARF
function FormDarf({ clienteId, onGuia }) {
  const { show } = useToast()
  const [f, setF] = useState({ codigo_receita: '', tipo_pa: 'ME', periodo: mesPassado(), vencimento: '', cota: '', valor: '', data_consolidacao: hoje(), observacao: '' })
  const [usarCota, setUsarCota] = useState(false)
  const [r, setR] = useState(null)
  const [indo, setIndo] = useState(false)
  const muda = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const enviar = async () => {
    if (!clienteId) { show('Escolha a empresa'); return }
    setIndo(true); setR(null)
    try {
      const form = { ...f, cota: usarCota ? f.cota : '', vencimento: usarCota ? '' : f.vencimento }
      const res = await chamar('darf', { cliente_id: clienteId, form })
      setR(res); onGuia()
    } catch (e) { show(e.message) } finally { setIndo(false) }
  }

  return (
    <div>
      <div style={grade}>
        <Campo label="Código da receita" dica="ex.: 2089-01 (IRPJ), 1708-01"><input style={campo} value={f.codigo_receita} onChange={muda('codigo_receita')} placeholder="0000-00" /></Campo>
        <Campo label="Tipo de período"><select style={campo} value={f.tipo_pa} onChange={muda('tipo_pa')}>{TIPOS_PA.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></Campo>
        <Campo label="Período de apuração"><input style={campo} value={f.periodo} onChange={muda('periodo')} /></Campo>
        <Campo label="Valor do imposto (principal)"><input style={campo} value={f.valor} onChange={muda('valor')} placeholder="0,00" inputMode="decimal" /></Campo>
        {usarCota
          ? <Campo label="Cota"><input style={campo} value={f.cota} onChange={muda('cota')} inputMode="numeric" /></Campo>
          : <Campo label="Vencimento original"><input type="date" style={campo} value={f.vencimento} onChange={muda('vencimento')} /></Campo>}
        <Campo label="Data do pagamento" dica="dia útil; multa e juros até essa data"><input type="date" style={campo} value={f.data_consolidacao} onChange={muda('data_consolidacao')} /></Campo>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={usarCota} onChange={(e) => setUsarCota(e.target.checked)} /> Débito em cotas (IRPJ/CSLL trimestral)</label>
        <input style={{ ...campo, flex: 1, minWidth: 180 }} value={f.observacao} onChange={muda('observacao')} placeholder="Observação no DARF (opcional)" />
        <button className="btn btn-accent" onClick={enviar} disabled={indo}><CalculatorIcon size={14} /> {indo ? 'Calculando…' : 'Recalcular e gerar DARF'}</button>
      </div>
      <Resultado r={r} onEnviar={async (g) => { try { await chamar('enviar_documentos', { id: g.id }); setR((x) => ({ ...x, guia: { ...x.guia, documento_id: true } })); show('Enviado para Documentos') } catch (e) { show(e.message) } }} />
    </div>
  )
}

// ---------------------------------------------------------------- DAS
function FormDas({ clienteId, onGuia }) {
  const { show } = useToast()
  const [periodo, setPeriodo] = useState(mesPassado())
  const [data, setData] = useState('')
  const [r, setR] = useState(null)
  const [indo, setIndo] = useState(false)

  const enviar = async () => {
    if (!clienteId) { show('Escolha a empresa'); return }
    setIndo(true); setR(null)
    try {
      setR(await chamar('das', { cliente_id: clienteId, periodo, data_consolidacao: data || undefined })); onGuia()
    } catch (e) { show(e.message) } finally { setIndo(false) }
  }

  return (
    <div>
      <div style={{ ...grade, alignItems: 'end' }}>
        <Campo label="Período de apuração (MM/AAAA)"><input style={campo} value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></Campo>
        <Campo label="Pagar em data futura (opcional)" dica="vazio = DAS para pagar até hoje (já com multa e juros, se vencido)"><input type="date" style={campo} value={data} min={amanha()} onChange={(e) => setData(e.target.value)} /></Campo>
        <div><button className="btn btn-accent" onClick={enviar} disabled={indo}><FileTextIcon size={14} /> {indo ? 'Gerando…' : 'Gerar DAS'}</button></div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>Precisa da declaração do PGDAS-D já transmitida para o período.</div>
      <Resultado r={r} onEnviar={async (g) => { try { await chamar('enviar_documentos', { id: g.id }); setR((x) => ({ ...x, guia: { ...x.guia, documento_id: true } })); show('Enviado para Documentos') } catch (e) { show(e.message) } }} />
    </div>
  )
}

// ---------------------------------------------------------------- parcelamentos
function Parcelamentos({ clienteId, onGuia }) {
  const { show } = useToast()
  const [sistemas, setSistemas] = useState([])
  const [sistema, setSistema] = useState('PARCSN')
  const [parcelas, setParcelas] = useState(null)
  const [indo, setIndo] = useState('')
  const [emitidas, setEmitidas] = useState({})

  useEffect(() => { chamar('parcelamentos').then((r) => setSistemas(r.parcelamentos)).catch(() => {}) }, [])
  useEffect(() => { setParcelas(null); setEmitidas({}) }, [clienteId, sistema])

  const consultar = async () => {
    if (!clienteId) { show('Escolha a empresa'); return }
    setIndo('consulta')
    try { setParcelas((await chamar('parcelas', { cliente_id: clienteId, sistema })).parcelas) } catch (e) { show(e.message) } finally { setIndo('') }
  }

  const emitir = async (p) => {
    setIndo(p.parcela)
    try {
      const r = await chamar('parcela', { cliente_id: clienteId, sistema, parcela: p.parcela, valor: p.valor })
      setEmitidas((x) => ({ ...x, [p.parcela]: r })); onGuia()
      window.open(r.url, '_blank', 'noopener')
    } catch (e) { show(e.message) } finally { setIndo('') }
  }

  const enviarDoc = async (p) => {
    try { await chamar('enviar_documentos', { id: emitidas[p.parcela].guia.id }); setEmitidas((x) => ({ ...x, [p.parcela]: { ...x[p.parcela], enviada: true } })); show('Enviado para Documentos') } catch (e) { show(e.message) }
  }

  return (
    <div>
      <div style={{ ...grade, alignItems: 'end' }}>
        <Campo label="Parcelamento">
          <select style={campo} value={sistema} onChange={(e) => setSistema(e.target.value)}>
            {sistemas.map((x) => <option key={x.sistema} value={x.sistema}>{x.sistema} · {x.nome}</option>)}
          </select>
        </Campo>
        <div><button className="btn btn-accent" onClick={consultar} disabled={!!indo}><RefreshCwIcon size={14} /> {indo === 'consulta' ? 'Consultando…' : 'Consultar parcelas'}</button></div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>Parcelamentos da PGFN não estão no Integra Contador: continuam pelo robô do SISPAR (tela Parcelamentos).</div>
      {parcelas && (parcelas.length === 0
        ? <div style={{ marginTop: 12, fontSize: 13 }}>Nenhuma parcela disponível para emissão nesse parcelamento.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead><tr><th style={{ ...td, textAlign: 'left' }}>Parcela</th><th style={{ ...td, textAlign: 'right' }}>Valor</th><th style={td} /></tr></thead>
            <tbody>
              {parcelas.map((p) => {
                const e = emitidas[p.parcela]
                return (
                  <tr key={p.parcela}>
                    <td style={td}>{p.parcela}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{brl(p.valor)}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {e
                        ? <>
                            <a className="btn btn-sm" href={e.url} target="_blank" rel="noopener noreferrer"><FileDownIcon size={12} /> PDF</a>{' '}
                            <button className="btn btn-sm" onClick={() => enviarDoc(p)} disabled={e.enviada}><SendIcon size={12} /> {e.enviada ? 'Em Documentos' : 'Documentos'}</button>
                          </>
                        : <button className="btn btn-sm" onClick={() => emitir(p)} disabled={!!indo}>{indo === p.parcela ? 'Emitindo…' : 'Emitir DAS'}</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------- histórico
function Historico({ versao }) {
  const { show } = useToast()
  const [h, setH] = useState(null)
  useEffect(() => { chamar('historico').then(setH).catch((e) => setH({ erro: e.message })) }, [versao])
  if (!h) return null
  if (h.erro) return <div style={{ ...card, fontSize: 12, color: 'var(--text3)' }}>{h.erro}</div>
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>Guias geradas</b>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>Requisições ao SERPRO neste mês: {h.consumo_mes ?? 0}</span>
      </div>
      {!h.guias.length ? <div style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhuma guia ainda.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Quando', 'Empresa', 'Guia', 'Referência', 'Total', 'Pagar até', ''].map((t) => <th key={t} style={{ ...td, textAlign: 'left', color: 'var(--text2)' }}>{t}</th>)}</tr></thead>
            <tbody>
              {h.guias.map((g) => (
                <tr key={g.id}>
                  <td style={td}>{new Date(g.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={td}>{g.clientes?.nome}</td>
                  <td style={td}>{TIPO[g.tipo]}{g.tipo === 'parcela' ? ` ${g.sistema}` : ''}{g.ambiente === 'trial' ? ' (demo)' : ''}</td>
                  <td style={td}>{g.referencia}</td>
                  <td style={td}>{brl(g.total)}</td>
                  <td style={td}>{dataBR(g.validade)}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => chamar('arquivo', { id: g.id }).then((r) => window.open(r.url, '_blank', 'noopener')).catch((e) => show(e.message))}><FileDownIcon size={12} /> PDF</button>
                    {g.documento_id && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 6 }}>em Documentos</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- página
export default function IntegraContadorPage() {
  const clientes = useStore((s) => s.clientes)
  const [status, setStatus] = useState(null)
  const [erroStatus, setErroStatus] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [aba, setAba] = useState('darf')
  const [versao, setVersao] = useState(0)

  const carregar = () => chamar('status').then((s) => { setStatus(s); setErroStatus(s.erro || '') }).catch((e) => setErroStatus(e.message))
  useEffect(() => { carregar() }, [])

  const pronto = status && (status.ambiente === 'trial' || (status.chaves && status.certificado))
  const empresas = clientes.filter((c) => String(c.cnpj || '').replace(/\D/g, '').length === 14)
  const ABAS = [['darf', 'Recalcular DARF', CalculatorIcon], ['das', 'DAS do Simples', FileTextIcon], ['parc', 'Parcelamentos SN/MEI', LayersIcon]]

  return (
    <div className="page">
      {erroStatus && <div className="notice notice-warn"><AlertTriangleIcon size={14} /> <span>{erroStatus}</span></div>}
      <Configuracao status={status} onSalvo={carregar} />

      <div style={{ ...card, opacity: pronto ? 1 : 0.6 }}>
        {!pronto && status && <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 10 }}>Configure as chaves e o certificado acima para usar.</div>}
        <div style={{ marginBottom: 12, maxWidth: 480 }}>
          <span style={rotulo}>Empresa</span>
          <EmpresaCombobox empresas={empresas} value={clienteId} onChange={setClienteId} />
          {status?.ambiente === 'trial' && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Na demonstração o SERPRO responde com uma empresa fictícia, qualquer que seja a escolhida, e só aos dados dos cenários dele.</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {ABAS.map(([id, nome, Icon]) => (
            <button key={id} className={`btn ${aba === id ? 'btn-accent' : ''}`} onClick={() => setAba(id)}><Icon size={14} /> {nome}</button>
          ))}
        </div>
        {aba === 'darf' && <FormDarf clienteId={clienteId} onGuia={() => setVersao((v) => v + 1)} />}
        {aba === 'das' && <FormDas clienteId={clienteId} onGuia={() => setVersao((v) => v + 1)} />}
        {aba === 'parc' && <Parcelamentos clienteId={clienteId} onGuia={() => setVersao((v) => v + 1)} />}
      </div>

      <Historico versao={versao} />
    </div>
  )
}
