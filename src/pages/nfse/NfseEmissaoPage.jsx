import { useEffect, useMemo, useState } from 'react'
import { FileSignatureIcon, UploadIcon, ShieldCheckIcon, SendIcon, RefreshCwIcon, CopyIcon, Trash2Icon, FileCodeIcon, SettingsIcon } from 'lucide-react'
import { useStore } from '../../store'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import { Modal, useToast } from '../../components/shared'
import { chamarNfse, listarLotes, listarNotas, baixarXml, arquivoParaBase64, totais } from './nfseApi'
import { baixarNfse } from '../painel/nfsePainelApi'

// Emissão de NFS-e pela API da Sefin Nacional, por empresa. Ver docs/nfse-emissao.md.
// Tudo que grava passa pela function nfse (login conferido no servidor); a tela só lê do Supabase.

const brl = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const cpfFmt = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || '')
const hoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)

const COR_STATUS = {
  pronto: ['var(--ok-dim)', 'var(--ok)'],
  pendente: ['var(--warn-dim)', 'var(--warn)'],
  invalido: ['var(--danger-dim)', 'var(--danger)'],
  autorizada: ['var(--ok)', '#fff'],
  rejeitada: ['var(--danger-dim)', 'var(--danger)'],
  indeterminada: ['var(--warn-dim)', 'var(--warn)'],
  enviada: ['var(--warn-dim)', 'var(--warn)'],
  numero_reservado: ['var(--surface3)', 'var(--text2)'],
}
const EDITAVEL = (n) => n.estado === 'importada' || n.estado === 'validada'

function Pill({ tipo, children }) {
  const [bg, cor] = COR_STATUS[tipo] || ['var(--surface2)', 'var(--text3)']
  return <span style={{ background: bg, color: cor, borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
}

function AmbienteBadge({ ambiente, grande = false }) {
  const prod = ambiente === 'producao'
  return (
    <span style={{
      background: prod ? 'var(--danger)' : 'var(--warn-dim)', color: prod ? '#fff' : 'var(--warn)',
      border: prod ? 'none' : '1px solid var(--warn)', borderRadius: 6, fontWeight: 800, letterSpacing: '.04em',
      padding: grande ? '10px 16px' : '4px 10px', fontSize: grande ? 18 : 12, display: 'inline-block',
    }}>{prod ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}</span>
  )
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const titulo = { fontSize: 14, fontWeight: 700, color: 'var(--text1)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }
const suave = { color: 'var(--text3)', fontSize: 12 }

// ---------------------------------------------------------------- configuração da empresa e certificado

function Configuracao({ clienteId, status, onAtualizado }) {
  const { show } = useToast()
  const emp = status.empresa
  const [aberto, setAberto] = useState(!status.configurada)
  const [form, setForm] = useState({ serie_dps: emp?.serie_dps || '900', regra_competencia: emp?.regra_competencia || 'mes_do_atendimento', ambiente: emp?.ambiente || 'homologacao', whatsapp_origem: emp?.whatsapp_origem || '' })
  const [gabarito, setGabarito] = useState(null)
  const [pfx, setPfx] = useState(null)
  const [senha, setSenha] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { setAberto(!status.configurada) }, [clienteId, status.configurada])

  async function salvarEmpresa() {
    if (form.ambiente === 'producao' && emp?.ambiente !== 'producao'
      && !window.confirm('Mudar para PRODUÇÃO: as próximas notas emitidas serão notas fiscais reais. Confirmar?')) return
    setSalvando(true)
    try {
      const dados = { cliente_id: clienteId, ...form }
      if (gabarito) dados.gabarito_xml = await gabarito.text()
      onAtualizado(await chamarNfse('salvar_empresa', dados))
      setGabarito(null)
      show('Configuração salva')
      setAberto(false)
    } catch (e) { show(e.message) } finally { setSalvando(false) }
  }

  async function salvarCertificado() {
    if (!pfx || !senha) { show('Escolha o arquivo .pfx e digite a senha'); return }
    setSalvando(true)
    try {
      onAtualizado(await chamarNfse('salvar_certificado', { cliente_id: clienteId, pfx_base64: await arquivoParaBase64(pfx), senha }))
      setPfx(null)
      setSenha('')
      show('Certificado salvo (cifrado no servidor)')
    } catch (e) { show(e.message) } finally { setSalvando(false) }
  }

  const cert = status.certificado
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ ...titulo, margin: 0 }}><SettingsIcon size={16} /> Configuração de emissão</h3>
        {status.configurada && <AmbienteBadge ambiente={emp.ambiente} />}
        {status.configurada && (
          <span style={suave}>
            CNPJ {emp.cnpj} · município {emp.codigo_municipio} · serviço {emp.servico_padrao?.cTribNac} · série DPS {emp.serie_dps}
            {' · '}competência padrão: {emp.regra_competencia === 'mes_da_emissao' ? 'data da emissão' : 'data do atendimento'}
          </span>
        )}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAberto((a) => !a)}>{aberto ? 'Fechar' : 'Editar'}</button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        <ShieldCheckIcon size={14} style={{ verticalAlign: -2, marginRight: 6, color: cert && !cert.bloqueios.length ? 'var(--ok)' : 'var(--danger)' }} />
        {cert
          ? <>Certificado: <b>{cert.titular}</b> · válido até {dataBR(cert.valido_ate)} ({cert.dias_restantes} dias)</>
          : <span style={{ color: 'var(--danger)' }}>Sem certificado A1 cadastrado</span>}
        {cert && [...cert.bloqueios, ...cert.alertas].map((m) => <div key={m} style={{ color: cert.bloqueios.includes(m) ? 'var(--danger)' : 'var(--warn)' }}>{m}</div>)}
      </div>

      {aberto && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 14 }}>
          <div>
            <div className="form-field">
              <label className="form-label">XML de uma NFS-e já emitida (gabarito){status.configurada ? ' — só se quiser trocar' : ''}</label>
              <input type="file" accept=".xml" onChange={(e) => setGabarito(e.target.files[0] || null)} />
              <div style={suave}>Baixe no portal da NFS-e uma nota desta empresa. Dela vêm regime, código do serviço e tributação.</div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">Série da DPS</label>
                <input value={form.serie_dps} onChange={(e) => setForm({ ...form, serie_dps: e.target.value })} />
              </div>
              <div className="form-field">
                <label className="form-label">Ambiente</label>
                <select value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value })}>
                  <option value="homologacao">Homologação (testes)</option>
                  <option value="producao">Produção (nota real)</option>
                </select>
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">Competência padrão</label>
              <select value={form.regra_competencia} onChange={(e) => setForm({ ...form, regra_competencia: e.target.value })}>
                <option value="mes_do_atendimento">Data do atendimento</option>
                <option value="mes_da_emissao">Data da emissão</option>
              </select>
            </div>
            <button className="btn btn-accent" disabled={salvando} onClick={salvarEmpresa}>Salvar configuração</button>
          </div>
          <div>
            <div className="form-field">
              <label className="form-label">Certificado A1 (.pfx)</label>
              <input type="file" accept=".pfx,.p12" onChange={(e) => setPfx(e.target.files[0] || null)} disabled={!status.configurada} />
            </div>
            <div className="form-field">
              <label className="form-label">Senha do certificado</label>
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} disabled={!status.configurada} />
            </div>
            <div style={{ ...suave, marginBottom: 10 }}>O arquivo e a senha são cifrados no servidor e nunca voltam para o navegador.</div>
            <button className="btn btn-accent" disabled={salvando || !status.configurada} onClick={salvarCertificado}>Salvar certificado</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- página

export default function NfseEmissaoPage() {
  const { show } = useToast()
  const clientes = useStore((s) => s.clientes)
  const empresas = useMemo(() => [...clientes].filter((c) => c.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes])
  const [clienteId, setClienteId] = useState(() => localStorage.getItem('nfse-cliente') || '')
  const [status, setStatus] = useState(null)
  const [lotes, setLotes] = useState([])
  const [loteId, setLoteId] = useState('')
  const [notas, setNotas] = useState([])
  const [selecionadas, setSelecionadas] = useState(() => new Set())
  const [texto, setTexto] = useState('')
  const [compMassa, setCompMassa] = useState('')
  const [filtro, setFiltro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [previa, setPrevia] = useState(null)

  const ambiente = status?.empresa?.ambiente
  const podeEmitir = status?.configurada && status.certificado && !status.certificado.bloqueios.length

  async function carregarStatus(id = clienteId) {
    if (!id) return
    try { setStatus(await chamarNfse('status', { cliente_id: id })) } catch (e) { show(e.message) }
  }

  async function carregarLotes(selecionar) {
    if (!clienteId || !ambiente) { setLotes([]); return }
    const l = await listarLotes(clienteId, ambiente)
    setLotes(l)
    const alvo = selecionar || (l.some((x) => x.id === loteId) ? loteId : l[0]?.id || '')
    setLoteId(alvo)
  }

  async function carregarNotas(id = loteId) {
    if (!id) { setNotas([]); return }
    const n = await listarNotas(id)
    setNotas(n)
    setSelecionadas((s) => new Set([...s].filter((x) => n.some((y) => y.id === x && y.estado === 'validada'))))
  }

  useEffect(() => {
    localStorage.setItem('nfse-cliente', clienteId)
    setStatus(null); setLotes([]); setLoteId(''); setNotas([]); setSelecionadas(new Set())
    carregarStatus(clienteId)
  }, [clienteId])
  useEffect(() => { carregarLotes().catch((e) => show(e.message)) }, [clienteId, ambiente])
  useEffect(() => { carregarNotas().catch((e) => show(e.message)) }, [loteId])

  async function acao(fn, msgOk) {
    setOcupado(true)
    try {
      const r = await fn()
      if (msgOk) show(msgOk)
      return r
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  async function importarTexto() {
    const r = await acao(() => chamarNfse('importar', { cliente_id: clienteId, texto }), 'Mensagens importadas')
    if (r) { setTexto(''); await carregarLotes(r.lote_id) }
  }

  async function importarPlanilha(arquivo) {
    if (!arquivo) return
    const r = await acao(async () => chamarNfse('importar', { cliente_id: clienteId, planilha_base64: await arquivoParaBase64(arquivo), nome_arquivo: arquivo.name }), 'Planilha importada')
    if (r) await carregarLotes(r.lote_id)
  }

  async function editar(nota, campo, valor) {
    const atual = { cpf: cpfFmt(nota.cpf), data: dataBR(nota.data), competencia: dataBR(nota.competencia), valor: valorBR(nota.valor) }[campo] ?? (nota[campo] || '')
    if (valor === atual) return
    await acao(() => chamarNfse('editar', { nota_id: nota.id, campos: { [campo]: valor } }))
    await carregarNotas()
  }

  async function aplicarCompetencia(valor) {
    if (!selecionadas.size) { show('Selecione as notas (caixinha à esquerda) antes'); return }
    await acao(() => chamarNfse('competencia', { nota_ids: [...selecionadas], competencia: valor }),
      valor ? `Competência ${valor} aplicada` : 'Competência padrão restaurada')
    await carregarNotas()
  }

  async function emitirSelecionadas() {
    setConfirmar(false)
    const fila = notas.filter((n) => selecionadas.has(n.id) && n.estado === 'validada').map((n) => n.id)
    const conta = { autorizada: 0, rejeitada: 0, indeterminada: 0 }
    setOcupado(true)
    try {
      for (const [i, id] of fila.entries()) {
        setProgresso(`Emitindo ${i + 1} de ${fila.length}…`)
        try {
          const r = await chamarNfse('emitir', { nota_id: id, ambiente })
          conta[r.resultado.estado] = (conta[r.resultado.estado] || 0) + 1
        } catch (e) {
          show(`Emissão interrompida: ${e.message}`)
          break
        }
        await carregarNotas()
        await new Promise((ok) => setTimeout(ok, 1500)) // uma nota por vez, com intervalo
      }
    } finally {
      setOcupado(false)
      setProgresso(`Concluído: ${conta.autorizada} autorizada(s), ${conta.rejeitada} rejeitada(s), ${conta.indeterminada} indeterminada(s)`)
      setSelecionadas(new Set())
      await carregarNotas()
    }
  }

  async function reconsultar(nota) {
    await acao(() => chamarNfse('emitir', { nota_id: nota.id, ambiente }))
    await carregarNotas()
  }

  async function verPrevia(nota) {
    const r = await acao(() => chamarNfse('previa', { nota_id: nota.id }))
    if (r) setPrevia(r)
  }

  const t = totais(notas)
  const visiveis = notas.filter((n) => !filtro || (filtro.startsWith('estado:') ? n.estado === filtro.slice(7) : EDITAVEL(n) && n.status_validacao === filtro))
  const prontas = notas.filter((n) => n.estado === 'validada')
  const sel = notas.filter((n) => selecionadas.has(n.id))
  const totalSel = sel.reduce((s, n) => s + Number(n.valor || 0), 0)
  const conta = (f) => notas.filter(f).length
  const competencias = Object.entries(sel.reduce((m, n) => {
    const c = n.competencia ? dataBR(n.competencia) : status?.empresa?.regra_competencia === 'mes_da_emissao' ? dataBR(hoje()) : dataBR(n.data)
    m[c] = (m[c] || 0) + 1
    return m
  }, {})).map(([c, q]) => `${c} (${q})`).join(', ')

  const inp = (n, campo, valor, largura, extra = {}) => (
    <input key={`${n.id}-${campo}-${valor}`} defaultValue={valor} disabled={!EDITAVEL(n) || ocupado}
      onBlur={(e) => editar(n, campo, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
      style={{ minWidth: largura, padding: '4px 6px', fontSize: 12, background: 'transparent', border: '1px solid transparent' }}
      onFocus={(e) => { e.target.style.borderColor = 'var(--accent)' }} {...extra} />
  )

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSignatureIcon size={18} /> Emitir NFS-e
          </h2>
          <p style={suave}>Emissão pela API da Sefin Nacional com o certificado A1 de cada empresa.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <EmpresaCombobox empresas={empresas} value={clienteId} onChange={setClienteId} placeholder="Escolher empresa..." style={{ flex: 1, minWidth: 260 }} />
        {ambiente && <AmbienteBadge ambiente={ambiente} />}
      </div>

      {!clienteId && <div style={{ ...card, ...suave }}>Escolha a empresa para configurar ou emitir.</div>}
      {clienteId && status && <Configuracao clienteId={clienteId} status={status} onAtualizado={setStatus} />}

      {status?.configurada && (
        <div style={card}>
          <h3 style={titulo}><UploadIcon size={16} /> Importar atendimentos</h3>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6}
            placeholder={'Cole aqui as mensagens do WhatsApp…\n\n[10:03, 13/10/2026] Fulana: Nome do Paciente\n123.456.789-09\nRua Tal 150\n22/01/26\nValor: 900,00\nDescrição do serviço'}
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-accent" disabled={ocupado || !texto.trim()} onClick={importarTexto}>Ler mensagens</button>
            <span style={suave}>ou planilha (data, nome, cpf, endereco, cep, descricao, valor):</span>
            <input type="file" accept=".xlsx,.xls,.csv" style={{ width: 'auto' }} disabled={ocupado}
              onChange={(e) => { importarPlanilha(e.target.files[0]); e.target.value = '' }} />
          </div>
        </div>
      )}

      {status?.configurada && lotes.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <h3 style={{ ...titulo, margin: 0 }}>Lote</h3>
            <select value={loteId} onChange={(e) => setLoteId(e.target.value)} style={{ width: 'auto', minWidth: 280 }}>
              {lotes.map((l) => <option key={l.id} value={l.id}>{new Date(l.criado_em).toLocaleString('pt-BR')} · {l.origem}{l.descricao ? ` · ${l.descricao}` : ''}</option>)}
            </select>
            <button className="btn btn-icon btn-ghost" title="Atualizar" onClick={() => carregarNotas()}><RefreshCwIcon size={16} /></button>
            <span style={suave}>
              {notas.length} registros: {conta((n) => EDITAVEL(n) && n.status_validacao === 'pronto')} prontos,{' '}
              {conta((n) => EDITAVEL(n) && n.status_validacao === 'pendente')} pendentes, {conta((n) => EDITAVEL(n) && n.status_validacao === 'invalido')} inválidos,{' '}
              {conta((n) => n.estado === 'autorizada')} autorizadas{conta((n) => n.estado === 'rejeitada') ? `, ${conta((n) => n.estado === 'rejeitada')} rejeitadas` : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            {[['Serviço', brl(t.servico)], ['Emitido', brl(t.emitido)], ['Faltando', brl(t.faltando)], ['Selecionado', sel.length ? `${sel.length} · ${brl(totalSel)}` : '—']].map(([r, v]) => (
              <div key={r} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={suave}>{r}</div><div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text1)' }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={prontas.length > 0 && prontas.every((n) => selecionadas.has(n.id))}
                onChange={(e) => setSelecionadas(e.target.checked ? new Set(prontas.map((n) => n.id)) : new Set())} />
              selecionar todos os prontos
            </label>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ width: 'auto' }}>
              <option value="">todos</option><option value="pronto">prontos</option><option value="pendente">pendentes</option>
              <option value="invalido">inválidos</option><option value="estado:autorizada">autorizadas</option>
              <option value="estado:rejeitada">rejeitadas</option><option value="estado:indeterminada">indeterminadas</option>
            </select>
            <span style={suave}>Competência das selecionadas:</span>
            <input value={compMassa} onChange={(e) => setCompMassa(e.target.value)} placeholder="mm/aaaa ou dd/mm/aaaa" style={{ width: 150 }} />
            <button className="btn" disabled={ocupado} onClick={() => aplicarCompetencia(compMassa.trim())}>Aplicar</button>
            <button className="btn" disabled={ocupado} onClick={() => aplicarCompetencia('')}>Usar padrão</button>
            <span style={{ fontWeight: 600, fontSize: 12 }}>{progresso}</span>
            <button className="btn btn-accent" style={{ marginLeft: 'auto' }} disabled={ocupado || !sel.length || !podeEmitir}
              title={podeEmitir ? '' : 'Configure o certificado A1 antes'} onClick={() => setConfirmar(true)}>
              <SendIcon size={14} /> Emitir selecionados
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text3)', textAlign: 'left' }}>
                  {['', 'Status', 'Nome', 'CPF', 'Data', 'Competência', 'Valor', 'Descrição', 'Endereço', 'Problemas / resultado', ''].map((h, i) => (
                    <th key={i} style={{ padding: '6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((n) => {
                  const tipo = EDITAVEL(n) ? n.status_validacao : n.estado
                  const fundo = { pronto: 'var(--ok-dim)', pendente: 'var(--warn-dim)', invalido: 'var(--danger-dim)', rejeitada: 'var(--danger-dim)', indeterminada: 'var(--warn-dim)' }[tipo]
                  const padraoComp = status.empresa.regra_competencia === 'mes_da_emissao' ? 'data da emissão' : dataBR(n.data)
                  return (
                    <tr key={n.id} style={{ background: fundo, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }}>
                      <td style={{ padding: 6 }}><input type="checkbox" style={{ width: 'auto' }} disabled={n.estado !== 'validada'} checked={selecionadas.has(n.id)}
                        onChange={(e) => setSelecionadas((s) => { const x = new Set(s); e.target.checked ? x.add(n.id) : x.delete(n.id); return x })} /></td>
                      <td style={{ padding: 6 }}><Pill tipo={tipo}>{tipo.replace('_', ' ')}</Pill></td>
                      <td style={{ padding: 2 }}>{inp(n, 'nome', n.nome, 180)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'cpf', cpfFmt(n.cpf), 120)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'data', dataBR(n.data), 90)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'competencia', dataBR(n.competencia), 90, { placeholder: padraoComp, title: `Vazio = ${padraoComp}. Aceita dd/mm/aaaa ou mm/aaaa` })}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'valor', valorBR(n.valor), 80, { style: { minWidth: 80, padding: '4px 6px', fontSize: 12, textAlign: 'right', background: 'transparent', border: '1px solid transparent' } })}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'descricao', n.descricao, 180)}</td>
                      <td style={{ padding: 2 }}>{inp(n, 'endereco', n.endereco, 180)}</td>
                      <td style={{ padding: 6, minWidth: 220 }}>
                        {n.estado === 'autorizada' && <>
                          <div style={{ color: 'var(--ok)', fontWeight: 700 }}>✔ NFS-e nº {n.numero_nfse || '?'}</div>
                          <div style={suave}>{n.chave_acesso}</div>
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarNfse(clienteId, { id: n.id, numero: n.numero_nfse, chave: n.chave_acesso }, 'pdf', { incluirHomologacao: true }).catch((x) => show(x.message)) }}
                            title="DANFSe (NT 008/2026) gerado a partir do XML autorizado">PDF (DANFSe)</a>{' · '}
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarXml(n.id, 'xml_retorno').catch((x) => show(x.message)) }}>XML NFS-e</a>{' · '}
                          <a href="#" onClick={(e) => { e.preventDefault(); baixarXml(n.id, 'xml_enviado').catch((x) => show(x.message)) }}>XML DPS</a>
                        </>}
                        {n.estado === 'rejeitada' && <>
                          <div style={{ color: 'var(--danger)' }}>✖ {n.mensagem_sefin}</div>
                          {n.copiada_para ? <div style={suave}>Refeita em outra nota (fora dos totais)</div>
                            : <button className="btn" style={{ marginTop: 4 }} disabled={ocupado}
                              onClick={async () => { await acao(() => chamarNfse('copiar', { nota_id: n.id }), 'Cópia criada para corrigir'); await carregarNotas() }}>
                              <CopyIcon size={12} /> Copiar para corrigir</button>}
                        </>}
                        {(n.estado === 'indeterminada' || n.estado === 'enviada') && <>
                          <div style={{ color: 'var(--warn)' }}>? {n.mensagem_sefin || 'Envio sem resposta'}</div>
                          <button className="btn" style={{ marginTop: 4 }} disabled={ocupado} onClick={() => reconsultar(n)}>Reconsultar (e reenviar se não existir)</button>
                        </>}
                        {n.estado === 'numero_reservado' && <div style={suave}>DPS nº {n.n_dps} reservada, ainda não enviada.</div>}
                        {EDITAVEL(n) && <>
                          {n.erros.map((e) => <div key={e} style={{ color: 'var(--danger)' }}>✖ {e}</div>)}
                          {n.pendencias.length > 0 && <div style={{ color: 'var(--warn)' }}>Falta: {n.pendencias.join(', ')}</div>}
                          {n.avisos.map((a) => <div key={a} style={suave}>• {a}</div>)}
                        </>}
                        {n.n_dps && <div style={suave}>DPS série {n.serie} nº {n.n_dps}</div>}
                        {n.texto_original && <details><summary style={{ ...suave, cursor: 'pointer' }}>mensagem {n.autor ? `de ${n.autor}` : ''}</summary>
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, margin: '4px 0 0', maxWidth: 320 }}>{n.texto_original}</pre></details>}
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {n.estado === 'validada' && <button className="btn btn-icon btn-ghost" title="Ver a DPS assinada que seria enviada" onClick={() => verPrevia(n)}><FileCodeIcon size={15} /></button>}
                        {EDITAVEL(n) && <button className="btn btn-icon btn-ghost" title="Remover do lote" disabled={ocupado}
                          onClick={async () => { if (window.confirm('Remover este registro do lote?')) { await acao(() => chamarNfse('excluir', { nota_id: n.id })); await carregarNotas() } }}>
                          <Trash2Icon size={15} /></button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmar && (
        <Modal onClose={() => setConfirmar(false)}>
          <div className="modal-title">Confirmar emissão</div>
          <div style={{ textAlign: 'center', margin: '12px 0' }}><AmbienteBadge ambiente={ambiente} grande /></div>
          {ambiente === 'producao' && <p style={{ color: 'var(--danger)', fontWeight: 600, textAlign: 'center' }}>Notas fiscais reais.</p>}
          <p><b>{sel.length}</b> nota(s), total <b>{brl(totalSel)}</b>.</p>
          <p>Competência: <b>{competencias}</b></p>
          <p style={suave}>{empresas.find((e) => e.id === clienteId)?.nome} · série DPS {status.empresa.serie_dps}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setConfirmar(false)}>Cancelar</button>
            <button className="btn btn-accent" onClick={emitirSelecionadas}>Emitir</button>
          </div>
        </Modal>
      )}

      {previa && (
        <Modal onClose={() => setPrevia(null)}>
          <div className="modal-title">Prévia da DPS — nº {previa.numero_previa} (não reservado)</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, maxHeight: '60vh', overflow: 'auto', background: 'var(--surface2)', padding: 10, borderRadius: 6 }}>
            {previa.xml.replace(/></g, '>\n<')}
          </pre>
          <div style={{ textAlign: 'right', marginTop: 10 }}><button className="btn" onClick={() => setPrevia(null)}>Fechar</button></div>
        </Modal>
      )}
    </div>
  )
}
