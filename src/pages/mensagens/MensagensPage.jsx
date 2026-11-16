// Central de Mensagens — mensagens padronizadas para os clientes pelo WhatsApp.
//   - Aprovar: tudo o que foi programado (na central ou pela cobrança
//     automática de honorários) espera aqui; nada sai sem aprovação.
//   - Nova mensagem: escolhe um modelo (ou escreve), os clientes, e envia
//     agora ou programa (programada vai para a aprovação).
//   - Programadas: aprovadas com horário marcado, ainda não enviadas.
//   - Histórico: enviadas, com erro e descartadas.
//   - Modelos: os padrões (cobrança de honorários e outros) e os do escritório.
// Dados: mensagensApi.js; variáveis e modelos padrão: src/lib/mensagens.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MessagesSquareIcon, SendIcon, CheckIcon, XIcon, PencilIcon, ClockIcon, PlusIcon,
  RotateCcwIcon, Trash2Icon, Loader2Icon, CheckCircle2Icon, PhoneOffIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast, Modal } from '../../components/shared'
import { MODELOS_PADRAO, VARIAVEIS, valoresDoCliente, montarTexto, celularWhatsapp, nomeCurto } from '../../lib/mensagens'
import {
  listarModelos, salvarModelo, excluirModelo, dadosVariaveis, listarFila, criarMensagens, aprovar, editarTexto,
  descartar, voltarParaAprovacao, atualizarTelefone, faltaSchema,
} from './mensagensApi'

const MSG_SCHEMA = 'A Central de Mensagens ainda não está no banco: rode supabase-schema-central-mensagens.sql no Supabase.'
const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '')
const ORIGEM = { 'honorarios-cron': 'Cobrança automática', central: 'Central' }

export default function MensagensPage({ onAguardandoMudou }) {
  const [aba, setAba] = useState('aprovar')
  const [aguardando, setAguardando] = useState(null)
  const [versao, setVersao] = useState(0)
  const [erroSchema, setErroSchema] = useState(false)
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    listarFila(['aguardando_aprovacao'])
      .then((l) => { setAguardando(l); setErroSchema(false); onAguardandoMudou?.(l.length) })
      .catch((e) => { setAguardando([]); if (faltaSchema(e)) setErroSchema(true) })
  }, [versao])

  const abas = [
    ['aprovar', `Aprovar${aguardando?.length ? ` (${aguardando.length})` : ''}`],
    ['nova', 'Nova mensagem'],
    ['programadas', 'Programadas'],
    ['historico', 'Histórico'],
    ['modelos', 'Modelos'],
  ]
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <MessagesSquareIcon size={18} />
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Central de Mensagens</h2>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text3)', margin: '0 0 14px' }}>
        Mensagens padronizadas para os clientes pelo WhatsApp. Tudo o que é programado, inclusive a cobrança automática de honorários, só sai depois de aprovado aqui.
      </p>
      {erroSchema && <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--danger)', fontSize: 13 }}>{MSG_SCHEMA}</div>}
      <div className="tabs" style={{ maxWidth: 680, marginBottom: 14 }}>
        {abas.map(([id, rot]) => <button key={id} className={`tab-btn ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>{rot}</button>)}
      </div>
      {aba === 'aprovar' && <AbaAprovar lista={aguardando} onMudou={recarregar} />}
      {aba === 'nova' && <AbaNova onCriadas={(enviouAgora) => { recarregar(); setAba(enviouAgora ? 'historico' : 'aprovar') }} />}
      {aba === 'programadas' && <AbaLista key={`p${versao}`} status={['aprovada', 'enviando']} programadas onMudou={recarregar} />}
      {aba === 'historico' && <AbaLista key={`h${versao}`} status={['enviada', 'erro', 'descartada']} onMudou={recarregar} />}
      {aba === 'modelos' && <AbaModelos />}
    </div>
  )
}

// ── Aprovar ─────────────────────────────────────────────────────────────────
function AbaAprovar({ lista, onMudou }) {
  const { show } = useToast()
  const [sel, setSel] = useState(() => new Set())
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { setSel(new Set((lista || []).map((m) => m.id))) }, [lista])
  if (lista === null) return <Carregando />
  if (!lista.length) return <Vazio texto="Nenhuma mensagem esperando aprovação." />

  const alternar = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const aprovarSel = async () => {
    const ids = [...sel]
    if (!ids.length) return
    setOcupado(true)
    try {
      // celular corrigido no cadastro depois que a mensagem entrou na fila
      for (const m of lista.filter((x) => sel.has(x.id) && !x.telefone)) {
        const cel = celularWhatsapp(m.clientes?.telefone)
        if (cel) await atualizarTelefone(m.id, cel)
      }
      const r = await aprovar(ids)
      show(`${r.enviadas} enviada(s)${r.agendadas ? `, ${r.agendadas} programada(s)` : ''}${r.erros?.length ? `, ${r.erros.length} com erro (veja o Histórico)` : ''}`)
    } catch (e) { show(e.message) }
    setOcupado(false)
    onMudou()
  }
  const descartarSel = async () => {
    const ids = [...sel]
    if (!ids.length || !window.confirm(`Descartar ${ids.length} mensagem(ns)? Elas não serão enviadas.`)) return
    setOcupado(true)
    try { await descartar(ids); show('Mensagens descartadas') } catch (e) { show(e.message) }
    setOcupado(false)
    onMudou()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
          <input type="checkbox" checked={sel.size === lista.length} onChange={(e) => setSel(e.target.checked ? new Set(lista.map((m) => m.id)) : new Set())} />
          {sel.size} de {lista.length} selecionada(s)
        </label>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" disabled={!sel.size || ocupado} onClick={descartarSel}><XIcon size={13} /> Descartar</button>
        <button className="btn btn-accent btn-sm" disabled={!sel.size || ocupado} onClick={aprovarSel}>
          {ocupado ? <Loader2Icon size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <CheckIcon size={13} />} Aprovar e enviar
        </button>
      </div>
      {lista.map((m) => <CartaoMensagem key={m.id} m={m} marcada={sel.has(m.id)} onMarcar={() => alternar(m.id)} editavel onMudou={onMudou} />)}
    </div>
  )
}

function CartaoMensagem({ m, marcada, onMarcar, editavel = false, onMudou, acoes = null }) {
  const { show } = useToast()
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(m.texto)
  useEffect(() => setTexto(m.texto), [m.texto])
  const celCadastro = celularWhatsapp(m.clientes?.telefone)
  const semCelular = !m.telefone && !celCadastro
  const salvar = async () => {
    try { await editarTexto(m.id, texto); setEditando(false); show('Texto salvo'); onMudou?.() } catch (e) { show(e.message) }
  }
  const STATUS = {
    aguardando_aprovacao: ['Aguardando aprovação', 'badge-warn'], aprovada: ['Aprovada', 'badge-info'], enviando: ['Enviando', 'badge-info'],
    enviada: ['Enviada', 'badge-ok'], erro: ['Erro', 'badge-err'], descartada: ['Descartada', 'badge-gray'],
  }
  const [rot, cls] = STATUS[m.status] || ['', '']
  return (
    <div className="card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {onMarcar && <input type="checkbox" checked={marcada} onChange={onMarcar} style={{ marginTop: 3 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <b style={{ fontSize: 13 }}>{nomeCurto(m.clientes?.nome || m.destino_nome) || 'Sem empresa'}</b>
          <span className={`badge ${cls}`}>{rot}</span>
          <span className="badge badge-gray">{ORIGEM[m.origem] || m.origem}</span>
          {m.mensagens_modelos?.nome && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{m.mensagens_modelos.nome}</span>}
          {m.agendada_para && <span style={{ fontSize: 11, color: 'var(--accent)', display: 'inline-flex', gap: 3, alignItems: 'center' }}><ClockIcon size={11} /> {fmtDataHora(m.agendada_para)}</span>}
          {semCelular && <span style={{ fontSize: 11, color: 'var(--danger)', display: 'inline-flex', gap: 3, alignItems: 'center' }}><PhoneOffIcon size={11} /> sem celular válido no cadastro</span>}
          <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
            {m.status === 'enviada' ? `Enviada ${fmtDataHora(m.enviado_em)}` : `Criada ${fmtDataHora(m.criado_em)}${m.criado_por ? ` · ${m.criado_por}` : ''}`}
          </span>
        </div>
        {editando ? (
          <>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={Math.min(12, texto.split('\n').length + 1)} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setTexto(m.texto); setEditando(false) }}>Cancelar</button>
              <button className="btn btn-accent btn-sm" onClick={salvar}>Salvar texto</button>
            </div>
          </>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--surface2)', borderRadius: 'var(--r-sm)', padding: '8px 10px', color: 'var(--text1)' }}>{m.texto}</div>
        )}
        {m.erro && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{m.erro}</div>}
        {m.aprovado_por && m.status !== 'aguardando_aprovacao' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Aprovada por {m.aprovado_por} {fmtDataHora(m.aprovado_em)}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {editavel && !editando && <button className="btn btn-ghost btn-sm" onClick={() => setEditando(true)} title="Editar o texto antes de aprovar"><PencilIcon size={13} /></button>}
        {acoes}
      </div>
    </div>
  )
}

// ── Programadas / Histórico ─────────────────────────────────────────────────
function AbaLista({ status, programadas = false, onMudou }) {
  const { show } = useToast()
  const [lista, setLista] = useState(null)
  const [filtro, setFiltro] = useState('todas')
  const carregar = () => listarFila(status).then(setLista).catch((e) => { setLista([]); show(faltaSchema(e) ? MSG_SCHEMA : e.message) })
  useEffect(() => { carregar() }, [])
  if (lista === null) return <Carregando />
  const visiveis = lista.filter((m) => filtro === 'todas' || m.status === filtro)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!programadas && (
        <div style={{ display: 'flex', gap: 6 }}>
          {[['todas', 'Todas'], ['enviada', 'Enviadas'], ['erro', 'Com erro'], ['descartada', 'Descartadas']].map(([id, rot]) => (
            <button key={id} className={`btn btn-sm ${filtro === id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setFiltro(id)}>
              {rot}{id !== 'todas' ? ` (${lista.filter((m) => m.status === id).length})` : ''}
            </button>
          ))}
        </div>
      )}
      {!visiveis.length && <Vazio texto={programadas ? 'Nenhuma mensagem aprovada esperando o horário.' : 'Nada por aqui ainda.'} />}
      {visiveis.map((m) => (
        <CartaoMensagem key={m.id} m={m} onMudou={() => { carregar(); onMudou() }} acoes={
          m.status === 'erro' ? (
            <button className="btn btn-ghost btn-sm" title="Voltar para a aprovação (dá para corrigir antes)"
              onClick={async () => {
                try { await voltarParaAprovacao(m.id, m.telefone || celularWhatsapp(m.clientes?.telefone) || null); show('Voltou para a aprovação'); carregar(); onMudou() } catch (e) { show(e.message) }
              }}><RotateCcwIcon size={13} /></button>
          ) : m.status === 'aprovada' ? (
            <button className="btn btn-ghost btn-sm" title="Cancelar o envio programado"
              onClick={async () => {
                if (!window.confirm('Cancelar esta mensagem programada?')) return
                try { await descartar([m.id]); show('Envio cancelado'); carregar(); onMudou() } catch (e) { show(e.message) }
              }}><XIcon size={13} /></button>
          ) : null
        } />
      ))}
    </div>
  )
}

// ── Nova mensagem ───────────────────────────────────────────────────────────
function AbaNova({ onCriadas }) {
  const { show } = useToast()
  const clientes = useStore((s) => s.clientes)
  const competencia = useStore((s) => s.competenciaSelecionada)
  const [modelos, setModelos] = useState(null)
  const [modeloId, setModeloId] = useState('')
  const [texto, setTexto] = useState('')
  const [dados, setDados] = useState({ pix: {}, honorarioDe: {} })
  const [busca, setBusca] = useState('')
  const [carteira, setCarteira] = useState('todas')
  const [soHonorario, setSoHonorario] = useState(false)
  const [sel, setSel] = useState(() => new Set())
  const [previaDe, setPreviaDe] = useState('')
  const [agendar, setAgendar] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const areaRef = useRef(null)

  useEffect(() => {
    listarModelos().then((l) => setModelos(l.filter((m) => m.ativo))).catch((e) => { setModelos([]); show(faltaSchema(e) ? MSG_SCHEMA : e.message) })
    dadosVariaveis().then(setDados).catch(() => {})
  }, [])
  const escolherModelo = (id) => {
    setModeloId(id)
    const m = modelos?.find((x) => x.id === id)
    if (m) setTexto(m.texto)
  }
  const inserirVariavel = (v) => {
    const el = areaRef.current
    const ini = el?.selectionStart ?? texto.length
    const fim = el?.selectionEnd ?? texto.length
    setTexto(texto.slice(0, ini) + `{${v}}` + texto.slice(fim))
    setTimeout(() => { el?.focus(); el?.setSelectionRange(ini + v.length + 2, ini + v.length + 2) }, 0)
  }

  const ativos = useMemo(() => clientes.filter((c) => c.ativo !== false).sort((a, b) => nomeCurto(a.nome).localeCompare(nomeCurto(b.nome))), [clientes])
  const carteiras = useMemo(() => [...new Set(ativos.map((c) => c.carteira).filter(Boolean))].sort(), [ativos])
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return ativos.filter((c) => (carteira === 'todas' || (c.carteira || '') === carteira)
      && (!soHonorario || dados.honorarioDe[c.id])
      && (!t || `${c.nome} ${c.cnpj || ''}`.toLowerCase().includes(t)))
  }, [ativos, busca, carteira, soHonorario, dados])

  const valoresDe = (c) => valoresDoCliente(c, { competencia, honorario: dados.honorarioDe[c.id], pix: dados.pix })
  const selecionados = ativos.filter((c) => sel.has(c.id))
  const montadas = selecionados.map((c) => ({ c, cel: celularWhatsapp(c.telefone), ...montarTexto(texto, valoresDe(c)) }))
  const semCelular = montadas.filter((m) => !m.cel)
  const comFalta = montadas.filter((m) => m.faltando.length)
  const previaCliente = selecionados.find((c) => c.id === previaDe) || selecionados[0] || null
  const previa = previaCliente ? montarTexto(texto, valoresDe(previaCliente)) : null

  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((c) => sel.has(c.id))
  const marcarVisiveis = (sim) => setSel((s) => { const n = new Set(s); visiveis.forEach((c) => (sim ? n.add(c.id) : n.delete(c.id))); return n })

  const criar = async (enviarAgora) => {
    if (!texto.trim() || !montadas.length) return
    const enviaveis = montadas.filter((m) => m.cel && m.texto)
    if (enviarAgora) {
      if (!enviaveis.length) { show('Nenhum cliente selecionado tem celular válido.'); return }
      if (!window.confirm(`Enviar agora ${enviaveis.length} mensagem(ns) pelo WhatsApp?${semCelular.length ? `\n${semCelular.length} sem celular válido ficam de fora.` : ''}${comFalta.length ? `\n${comFalta.length} com variável sem valor (o trecho fica em branco).` : ''}`)) return
    }
    const lista = (enviarAgora ? enviaveis : montadas).map((m) => ({
      cliente_id: m.c.id, destino_nome: m.c.nome, telefone: m.cel, texto: m.texto, modelo_id: modeloId || null,
    }))
    setOcupado(true)
    try {
      const r = await criarMensagens(lista, { enviarAgora, agendadaPara: agendar ? new Date(agendar).toISOString() : null })
      show(enviarAgora
        ? `${r.enviadas} enviada(s)${r.erros?.length ? `, ${r.erros.length} com erro (veja o Histórico)` : ''}`
        : `${r.criadas} mensagem(ns) programada(s) — aguardando aprovação`)
      setSel(new Set())
      onCriadas(enviarAgora)
    } catch (e) { show(faltaSchema(e) ? MSG_SCHEMA : e.message) }
    setOcupado(false)
  }

  const porCategoria = useMemo(() => {
    const g = {}
    for (const m of modelos || []) (g[m.categoria] ||= []).push(m)
    return Object.entries(g)
  }, [modelos])

  return (
    <div className="mensagens-nova">
      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Rotulo>1. Mensagem</Rotulo>
        <select value={modeloId} onChange={(e) => escolherModelo(e.target.value)}>
          <option value="">— Escolher um modelo (ou escreva abaixo) —</option>
          {porCategoria.map(([cat, ms]) => (
            <optgroup key={cat} label={cat}>{ms.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</optgroup>
          ))}
        </select>
        <textarea ref={areaRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={9}
          placeholder="Escreva a mensagem. Use variáveis como {nome} para personalizar por cliente."
          style={{ width: '100%', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        <Variaveis onInserir={inserirVariavel} />
        {previa && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Rotulo>Prévia para</Rotulo>
              <select value={previaCliente.id} onChange={(e) => setPreviaDe(e.target.value)} style={{ fontSize: 12, maxWidth: 260 }}>
                {selecionados.map((c) => <option key={c.id} value={c.id}>{nomeCurto(c.nome)}</option>)}
              </select>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, background: 'var(--ok-dim)', borderRadius: 10, padding: '10px 12px' }}>{previa.texto}</div>
            {previa.faltando.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 4 }}>Sem valor para: {previa.faltando.map((v) => `{${v}}`).join(', ')}</div>}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <Rotulo>2. Clientes ({sel.size} selecionado{sel.size !== 1 ? 's' : ''})</Rotulo>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou CNPJ" style={{ flex: '1 1 160px' }} />
          {carteiras.length > 0 && (
            <select value={carteira} onChange={(e) => setCarteira(e.target.value)} style={{ maxWidth: 160 }}>
              <option value="todas">Todas as carteiras</option>
              {carteiras.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 12.5, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={todosVisiveisMarcados} onChange={(e) => marcarVisiveis(e.target.checked)} /> Marcar os {visiveis.length} da lista
          </label>
          <label style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <input type="checkbox" checked={soHonorario} onChange={(e) => setSoHonorario(e.target.checked)} /> Só com honorário em aberto
          </label>
          {sel.size > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>Limpar seleção</button>}
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          {visiveis.map((c) => {
            const cel = celularWhatsapp(c.telefone)
            const h = dados.honorarioDe[c.id]
            return (
              <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5 }}>
                <input type="checkbox" checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(c.nome)}</span>
                {h && <span className="badge badge-warn" title={`Honorário ${h.competencia} em aberto`}>honorário</span>}
                {cel ? <span style={{ fontSize: 11, color: 'var(--text3)' }}>{c.telefone}</span>
                  : <span style={{ fontSize: 11, color: 'var(--danger)', display: 'inline-flex', gap: 3, alignItems: 'center' }}><PhoneOffIcon size={11} /> sem celular</span>}
              </label>
            )
          })}
          {!visiveis.length && <div style={{ padding: 12, fontSize: 12.5, color: 'var(--text3)' }}>Nenhum cliente com esse filtro.</div>}
        </div>
      </div>

      <div className="card" style={{ padding: 14, gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', fontSize: 12.5, color: 'var(--text2)' }}>
          {montadas.length === 0 ? 'Escolha a mensagem e os clientes.' : (
            <>
              <b>{montadas.length}</b> mensagem(ns).
              {semCelular.length > 0 && <span style={{ color: 'var(--danger)' }}> {semCelular.length} sem celular válido.</span>}
              {comFalta.length > 0 && <span style={{ color: 'var(--warn)' }}> {comFalta.length} com variável sem valor.</span>}
            </>
          )}
        </div>
        <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
          Programar para (opcional)
          <input type="datetime-local" value={agendar} onChange={(e) => setAgendar(e.target.value)} />
        </label>
        <button className="btn btn-sm" disabled={ocupado || !montadas.length || !texto.trim()} onClick={() => criar(false)}
          title="Fica em Aprovar até alguém aprovar; com horário, sai nesse horário depois de aprovada">
          <ClockIcon size={13} /> Programar (vai para aprovação)
        </button>
        <button className="btn btn-accent btn-sm" disabled={ocupado || !montadas.length || !texto.trim() || !!agendar} onClick={() => criar(true)}
          title={agendar ? 'Com horário marcado, use Programar' : 'Envia agora para os selecionados com celular válido'}>
          {ocupado ? <Loader2Icon size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <SendIcon size={13} />} Enviar agora
        </button>
      </div>
    </div>
  )
}

// ── Modelos ─────────────────────────────────────────────────────────────────
function AbaModelos() {
  const { show } = useToast()
  const [modelos, setModelos] = useState(null)
  const [editando, setEditando] = useState(null) // modelo (ou {} para novo)
  const carregar = () => listarModelos().then(setModelos).catch((e) => { setModelos([]); show(faltaSchema(e) ? MSG_SCHEMA : e.message) })
  useEffect(() => { carregar() }, [])
  if (modelos === null) return <Carregando />
  const porCategoria = {}
  for (const m of modelos) (porCategoria[m.categoria] ||= []).push(m)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><button className="btn btn-accent btn-sm" onClick={() => setEditando({ categoria: 'Avisos', texto: '', nome: '', ativo: true })}><PlusIcon size={13} /> Novo modelo</button></div>
      {Object.entries(porCategoria).map(([cat, ms]) => (
        <div key={cat}>
          <Rotulo>{cat}</Rotulo>
          <div className="mensagens-modelos">
            {ms.map((m) => (
              <div key={m.id} className="card" style={{ padding: 12, opacity: m.ativo ? 1 : 0.55, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <b style={{ fontSize: 13, flex: 1 }}>{m.nome}</b>
                  {m.chave && <span className="badge badge-gray">padrão</span>}
                  {!m.ativo && <span className="badge badge-warn">desativado</span>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditando(m)} title="Personalizar"><PencilIcon size={13} /></button>
                </div>
                {m.chave === 'cobranca_honorario' && <div style={{ fontSize: 11, color: 'var(--accent)' }}>Usado na cobrança automática de honorários</div>}
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text2)', maxHeight: 130, overflow: 'hidden' }}>{m.texto}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {editando && <ModalModelo modelo={editando} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />}
    </div>
  )
}

function ModalModelo({ modelo, onClose, onSalvo }) {
  const { show } = useToast()
  const [nome, setNome] = useState(modelo.nome || '')
  const [categoria, setCategoria] = useState(modelo.categoria || 'Avisos')
  const [texto, setTexto] = useState(modelo.texto || '')
  const [ativo, setAtivo] = useState(modelo.ativo !== false)
  const [salvando, setSalvando] = useState(false)
  const areaRef = useRef(null)
  const padrao = modelo.chave && MODELOS_PADRAO.find((p) => p.chave === modelo.chave)
  const exemplo = montarTexto(texto, valoresDoCliente({ nome: 'EMPRESA EXEMPLO LTDA', cnpj: '00.000.000/0001-00', socio_nome: 'Maria' }, {
    competencia: '10/2026', honorario: { competencia: '10/2026', valor: 350, vencimento: '2026-11-10' }, pix: { chave: 'contato@escritorio.com.br', favorecido: 'Escritório Contábil' },
  }))
  const inserir = (v) => {
    const el = areaRef.current
    const ini = el?.selectionStart ?? texto.length
    setTexto(texto.slice(0, ini) + `{${v}}` + texto.slice(el?.selectionEnd ?? ini))
  }
  const salvar = async () => {
    if (!nome.trim() || !texto.trim()) { show('Preencha o nome e o texto.'); return }
    setSalvando(true)
    try { await salvarModelo({ id: modelo.id, nome, categoria, texto, ativo }); show('Modelo salvo'); onSalvo() }
    catch (e) { show(e.message); setSalvando(false) }
  }
  const excluir = async () => {
    if (!window.confirm(`Excluir o modelo "${modelo.nome}"?`)) return
    try { await excluirModelo(modelo.id); show('Modelo excluído'); onSalvo() } catch (e) { show(e.message) }
  }
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, width: 'min(640px, calc(100vw - 40px))' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{modelo.id ? 'Personalizar modelo' : 'Novo modelo'}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do modelo" style={{ flex: 2 }} />
          <input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Categoria" style={{ flex: 1 }} list="mensagens-categorias" />
          <datalist id="mensagens-categorias">{['Honorários', 'Documentos', 'Impostos', 'Avisos'].map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <textarea ref={areaRef} value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} style={{ width: '100%', fontSize: 13, fontFamily: 'inherit' }} />
        <Variaveis onInserir={inserir} />
        <div>
          <Rotulo>Como fica (exemplo)</Rotulo>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, background: 'var(--ok-dim)', borderRadius: 10, padding: '8px 10px' }}>{exemplo.texto}</div>
        </div>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo (aparece na hora de enviar)
        </label>
        {modelo.chave === 'cobranca_honorario' && !ativo && <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>Desativado, a cobrança automática volta a usar o texto padrão.</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {padrao && <button className="btn btn-ghost btn-sm" onClick={() => { setTexto(padrao.texto); setNome(padrao.nome) }}><RotateCcwIcon size={13} /> Restaurar padrão</button>}
          {modelo.id && !modelo.chave && <button className="btn btn-ghost btn-sm" onClick={excluir}><Trash2Icon size={13} /> Excluir</button>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent btn-sm" disabled={salvando} onClick={salvar}><CheckCircle2Icon size={13} /> Salvar</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Pedaços ─────────────────────────────────────────────────────────────────
function Variaveis({ onInserir }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>Inserir:</span>
      {VARIAVEIS.map((v) => (
        <button key={v.id} type="button" className="btn btn-ghost btn-sm" style={{ padding: '1px 7px', fontSize: 11 }} title={v.desc} onClick={() => onInserir(v.id)}>{`{${v.id}}`}</button>
      ))}
    </div>
  )
}
const Rotulo = ({ children }) => <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</div>
const Carregando = () => <div style={{ padding: 30, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
const Vazio = ({ texto }) => (
  <div style={{ padding: 30, textAlign: 'center', color: 'var(--text3)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
    <CheckCircle2Icon size={28} color="var(--ok)" />{texto}
  </div>
)
