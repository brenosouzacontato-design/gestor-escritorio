import { useState, useEffect, useMemo } from 'react'
import { BanknoteIcon, SearchIcon, SendIcon, SettingsIcon, RefreshCwIcon, PencilIcon, InfoIcon, PlusIcon, BarChart3Icon, XIcon, ListChecksIcon } from 'lucide-react'
import { Modal, useToast } from '../../components/shared'
import { useStore } from '../../store'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import {
  listarHonorariosDoMes, gerarHonorariosDoMes, marcarStatusHonorario,
  atualizarHonorario, atualizarConfigCliente, obterConfigPix, salvarConfigPix,
  enviarLembreteAgora, obterPreviaLembrete, criarHonorarioAvulso, listarClientesConfigurados,
  atualizarHonorariosEmLote, listarHonorariosDasCompetencias,
} from './honorariosApi'

function competenciaAtual() {
  const d = new Date()
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
}
// Algumas competências pra trás e pra frente do mês corrente, pro seletor —
// honorário é cobrança do próprio mês (diferente da competência de
// obrigações, que por padrão no resto do app é o mês anterior).
function opcoesCompetencia() {
  const hoje = new Date()
  const opcoes = []
  for (let i = -3; i <= 1; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
    opcoes.push(String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear())
  }
  return opcoes
}
function fmt(v) { return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtData(iso) { return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—' }
function diasAtraso(vencimento) {
  const hoje = new Date(new Date().toDateString())
  const venc = new Date(vencimento + 'T00:00:00')
  return Math.round((hoje - venc) / 86400000)
}

// Carteira do honorário — '' pra cliente sem carteira e pra não cliente
// (avulso sem linha em "clientes").
function carteiraDe(h) { return h.clientes?.carteira || '' }
function nomeCarteira(c) { return c || 'Sem carteira' }

const cabecalho = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }

// Módulo de Honorários — cobrança mensal recorrente por cliente. Uma linha
// em "clientes" guarda o valor/dia padrão (valor_honorario,
// dia_vencimento_honorario, aba "Configurar clientes"), "Gerar {mês}" cria
// a cobrança (tabela honorarios) pra quem tiver valor configurado, e um
// cron diário (honorarios-cron.js) manda lembrete de WhatsApp DIRETO pro
// celular do cliente com a chave PIX quando a cobrança vence e continua
// pendente — só quando o telefone bate com o formato de celular (ver
// netlify/functions/lib/telefone.js); sem isso, fica pra revisão manual
// (botão "Lembrete" nesta tela).
export default function HonorariosPage() {
  const [aba, setAba] = useState('cobrancas') // cobrancas | carteiras | config
  const [competencia, setCompetencia] = useState(competenciaAtual())
  const [honorarios, setHonorarios] = useState(null)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const [carteira, setCarteira] = useState('todas')
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [showEditarLote, setShowEditarLote] = useState(false)
  const clientesStore = useStore((s) => s.clientes)
  const [gerando, setGerando] = useState(false)
  const [showConfigPix, setShowConfigPix] = useState(false)
  const [showNovoAvulso, setShowNovoAvulso] = useState(false)
  const [editando, setEditando] = useState(null)
  const [previaLembrete, setPreviaLembrete] = useState(null) // honorário aberto na prévia
  const { show } = useToast()

  const carregar = () => {
    setErro(null)
    listarHonorariosDoMes(competencia).then(setHonorarios).catch((e) => setErro(e.message))
  }
  useEffect(() => { setHonorarios(null); setSelecionados(new Set()); carregar() }, [competencia])

  const carteiras = useMemo(() =>
    Array.from(new Set(clientesStore.map((c) => c.carteira).filter(Boolean))).sort(),
    [clientesStore]
  )

  // Base dos totais: só o filtro de carteira (status/busca não mexem no "A receber"/"Recebido")
  const daCarteira = useMemo(() => {
    if (!honorarios) return []
    if (carteira === 'todas') return honorarios
    return honorarios.filter((h) => carteiraDe(h) === carteira)
  }, [honorarios, carteira])

  const filtrados = useMemo(() => {
    let lista = daCarteira
    if (statusFiltro !== 'todos') lista = lista.filter((h) => h.status === statusFiltro)
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase()
      lista = lista.filter((h) => (h.clientes?.nome || h.nome_avulso || '').toLowerCase().includes(termo))
    }
    return lista
  }, [daCarteira, busca, statusFiltro])

  // Seleção só vale pro que está visível — o que o filtro esconde não entra na edição em grupo
  const selecionadosVisiveis = filtrados.filter((h) => selecionados.has(h.id))
  const todosMarcados = filtrados.length > 0 && selecionadosVisiveis.length === filtrados.length
  const alternarSelecao = (id) => setSelecionados((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const alternarTodos = () => setSelecionados(todosMarcados ? new Set() : new Set(filtrados.map((h) => h.id)))

  const totalPendente = daCarteira.filter((h) => h.status === 'pendente').reduce((s, h) => s + Number(h.valor), 0)
  const totalPago = daCarteira.filter((h) => h.status === 'pago').reduce((s, h) => s + Number(h.valor), 0)

  const handleGerar = async () => {
    setGerando(true)
    try {
      const n = await gerarHonorariosDoMes(competencia)
      show?.(n > 0 ? `${n} honorário${n !== 1 ? 's' : ''} gerado${n !== 1 ? 's' : ''} para ${competencia}` : `Nada novo pra gerar — confira a aba "Configurar clientes" (precisa de valor mensal definido).`)
      carregar()
    } catch (e) {
      show?.('Erro ao gerar: ' + e.message)
    }
    setGerando(false)
  }

  const alternarStatus = async (h) => {
    const novo = h.status === 'pago' ? 'pendente' : 'pago'
    const dataPagamento = novo === 'pago' ? new Date().toISOString().slice(0, 10) : null
    setHonorarios((prev) => prev.map((x) => (x.id === h.id ? { ...x, status: novo, data_pagamento: dataPagamento } : x)))
    try {
      await marcarStatusHonorario(h.id, novo)
    } catch (e) {
      show?.('Erro ao atualizar: ' + e.message)
      carregar()
    }
  }


  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BanknoteIcon size={18} /> Honorários
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Cobrança mensal por cliente, com lembrete automático de WhatsApp trazendo a chave PIX quando vence.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNovoAvulso(true)}>
            <PlusIcon size={13} /> Novo avulso
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowConfigPix(true)}>
            <SettingsIcon size={13} /> Configurar PIX
          </button>
        </div>
      </div>

      <div className="tabs" style={{ maxWidth: 480, marginBottom: 14 }}>
        <button className={`tab-btn ${aba === 'cobrancas' ? 'active' : ''}`} onClick={() => setAba('cobrancas')}>Cobranças</button>
        <button className={`tab-btn ${aba === 'carteiras' ? 'active' : ''}`} onClick={() => setAba('carteiras')}>
          <BarChart3Icon size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />Por carteira
        </button>
        <button className={`tab-btn ${aba === 'config' ? 'active' : ''}`} onClick={() => setAba('config')}>Configurar clientes</button>
      </div>

      {aba === 'config' && <AbaConfigClientes />}
      {aba === 'carteiras' && <AbaPorCarteira carteiras={carteiras} />}

      {aba === 'cobrancas' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <select value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ padding: '7px 10px', fontSize: 12.5 }}>
              {opcoesCompetencia().map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {carteiras.length > 0 && (
              <select value={carteira} onChange={(e) => setCarteira(e.target.value)} style={{ padding: '7px 10px', fontSize: 12.5, maxWidth: 180 }}>
                <option value="todas">Todas as carteiras</option>
                {carteiras.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="">Sem carteira</option>
              </select>
            )}
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <SearchIcon size={14} color="var(--text3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente..."
                style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12.5 }} />
            </div>
            <div className="tabs" style={{ maxWidth: 260 }}>
              <button className={`tab-btn ${statusFiltro === 'todos' ? 'active' : ''}`} onClick={() => setStatusFiltro('todos')}>Todos</button>
              <button className={`tab-btn ${statusFiltro === 'pendente' ? 'active' : ''}`} onClick={() => setStatusFiltro('pendente')}>Pendentes</button>
              <button className={`tab-btn ${statusFiltro === 'pago' ? 'active' : ''}`} onClick={() => setStatusFiltro('pago')}>Pagos</button>
            </div>
            <button className="btn btn-accent btn-sm" onClick={handleGerar} disabled={gerando}>
              <RefreshCwIcon size={13} /> {gerando ? 'Gerando...' : `Gerar ${competencia}`}
            </button>
          </div>

          {daCarteira.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase' }}>A receber</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--warn)' }}>{fmt(totalPendente)}</div>
              </div>
              <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase' }}>Recebido</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ok)' }}>{fmt(totalPago)}</div>
              </div>
            </div>
          )}

          {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
          {!erro && !honorarios && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>}
          {honorarios && filtrados.length === 0 && (
            <div className="empty">
              <p>💳</p>
              Nenhum honorário para {competencia}. Configure o valor de cada cliente na aba "Configurar clientes" e depois clique em "Gerar {competencia}".
            </div>
          )}

          {selecionadosVisiveis.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 'var(--r-md)', fontSize: 12.5, flexWrap: 'wrap' }}>
              <ListChecksIcon size={15} color="var(--accent)" />
              <span style={{ color: 'var(--text1)', fontWeight: 600 }}>
                {selecionadosVisiveis.length} selecionado{selecionadosVisiveis.length !== 1 ? 's' : ''}
              </span>
              <span style={{ color: 'var(--text3)' }}>· {fmt(selecionadosVisiveis.reduce((s, h) => s + Number(h.valor), 0))}</span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-accent btn-sm" onClick={() => setShowEditarLote(true)}>
                <PencilIcon size={13} /> Editar em grupo
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelecionados(new Set())} title="Limpar seleção">
                <XIcon size={13} />
              </button>
            </div>
          )}

          {honorarios && filtrados.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <th style={{ ...cabecalho, width: 32, paddingRight: 0 }}>
                      <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} title="Selecionar todos" />
                    </th>
                    <th style={cabecalho}>Cliente</th>
                    <th style={cabecalho}>Valor</th>
                    <th style={cabecalho}>Vencimento</th>
                    <th style={cabecalho}>Status</th>
                    <th style={cabecalho}>Recebido em</th>
                    <th style={cabecalho}>Lembrete</th>
                    <th style={cabecalho}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((h) => {
                    const atraso = h.status === 'pendente' ? diasAtraso(h.vencimento) : 0
                    return (
                      <tr key={h.id} style={{ borderTop: '1px solid var(--border)', background: selecionados.has(h.id) ? 'var(--accent-dim)' : undefined }}>
                        <td style={{ padding: '8px 0 8px 12px' }}>
                          <input type="checkbox" checked={selecionados.has(h.id)} onChange={() => alternarSelecao(h.id)} />
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {h.clientes?.nome || h.nome_avulso}
                          {carteira === 'todas' && h.clientes?.carteira && (
                            <span style={{ marginLeft: 6, background: 'rgba(59,102,246,.12)', color: 'var(--accent)', borderRadius: 99, padding: '0 6px', fontSize: 10, fontWeight: 600 }}>{h.clientes.carteira}</span>
                          )}
                          {h.tipo === 'avulso' && (
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                              <span className="badge badge-gray" style={{ fontSize: 9 }}>Avulso</span>
                              {!h.clientes && <span className="badge badge-gray" style={{ fontSize: 9 }}>Não cliente</span>}
                              {h.descricao}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{fmt(h.valor)}</td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: atraso > 0 ? 'var(--danger)' : 'var(--text2)' }}>
                          {fmtData(h.vencimento)}{atraso > 0 ? ` · ${atraso}d atraso` : ''}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <button onClick={() => alternarStatus(h)}
                            className={`badge ${h.status === 'pago' ? 'badge-ok' : 'badge-warn'}`} style={{ cursor: 'pointer', border: 'none' }}>
                            {h.status === 'pago' ? 'Pago' : 'Pendente'}
                          </button>
                        </td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                          {h.status === 'pago' ? fmtData(h.data_pagamento) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                          {h.lembrete_enviado_em ? `Enviado ${fmtData(h.lembrete_enviado_em.slice(0, 10))}` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditando(h)} title="Editar valor/vencimento/recebimento">
                            <PencilIcon size={13} />
                          </button>
                          {h.status === 'pendente' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => setPreviaLembrete(h)} title="Conferir e enviar lembrete">
                              <SendIcon size={13} /> Lembrete
                            </button>
                          )}
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

      {showConfigPix && <ModalConfigPix onClose={() => setShowConfigPix(false)} />}
      {editando && (
        <ModalEditarHonorario honorario={editando} onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar() }} />
      )}
      {showEditarLote && (
        <ModalEditarLote honorarios={selecionadosVisiveis} onClose={() => setShowEditarLote(false)}
          onSaved={() => { setShowEditarLote(false); setSelecionados(new Set()); carregar() }} />
      )}
      {showNovoAvulso && (
        <ModalNovoAvulso onClose={() => setShowNovoAvulso(false)}
          onSalvo={() => { setShowNovoAvulso(false); carregar() }} />
      )}
      {previaLembrete && (
        <ModalPreviaLembrete honorario={previaLembrete} onClose={() => setPreviaLembrete(null)}
          onEnviado={() => { setPreviaLembrete(null); carregar() }} />
      )}
    </div>
  )
}

// ── Aba Configurar clientes ──────────────────────────────────────────────────
// Valor mensal + dia de vencimento por cliente (usados por "Gerar {mês}") —
// autosave ao sair do campo, mesmo padrão já usado em Lançamentos a
// identificar. Telefone aparece só pra conferência (é o que decide se o
// lembrete automático consegue ser enviado).
function AbaConfigClientes() {
  const [clientes, setClientes] = useState(null)
  const [erro, setErro] = useState(null)
  const { show } = useToast()

  useEffect(() => {
    listarClientesConfigurados().then(setClientes).catch((e) => setErro(e.message))
  }, [])

  const salvar = async (cliente, campo, valor) => {
    const atualizado = { ...cliente, [campo]: valor }
    setClientes((prev) => prev.map((c) => (c.id === cliente.id ? atualizado : c)))
    try {
      await atualizarConfigCliente(cliente.id, {
        valorHonorario: campo === 'valor_honorario' ? valor : atualizado.valor_honorario,
        diaVencimento: campo === 'dia_vencimento_honorario' ? valor : atualizado.dia_vencimento_honorario,
      })
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
  }

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!clientes) return <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: 'var(--surface2)' }}>
            <th style={cabecalho}>Cliente</th>
            <th style={cabecalho}>Telefone</th>
            <th style={cabecalho}>Valor mensal</th>
            <th style={cabecalho}>Dia de vencimento</th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px', color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap' }}>{c.nome}</td>
              <td style={{ padding: '8px 12px', color: c.telefone ? 'var(--text2)' : 'var(--text3)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                {c.telefone || 'sem telefone (edite em Clientes)'}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <input type="number" step="0.01" defaultValue={c.valor_honorario ?? ''} placeholder="0,00"
                  onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== c.valor_honorario) salvar(c, 'valor_honorario', v) }}
                  style={{ width: 100, fontSize: 12.5, padding: '4px 6px' }} />
              </td>
              <td style={{ padding: '8px 12px' }}>
                <input type="number" min="1" max="28" defaultValue={c.dia_vencimento_honorario ?? ''} placeholder="10"
                  onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== c.dia_vencimento_honorario) salvar(c, 'dia_vencimento_honorario', v) }}
                  style={{ width: 70, fontSize: 12.5, padding: '4px 6px' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Modal configuração da chave PIX ──────────────────────────────────────────
function ModalConfigPix({ onClose }) {
  const [chavePix, setChavePix] = useState('')
  const [favorecido, setFavorecido] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const { show } = useToast()

  useEffect(() => {
    obterConfigPix()
      .then((cfg) => { setChavePix(cfg.chavePix); setFavorecido(cfg.favorecido) })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [])

  const salvar = async () => {
    setSalvando(true)
    try {
      await salvarConfigPix({ chavePix: chavePix.trim(), favorecido: favorecido.trim() })
      show?.('Chave PIX salva')
      onClose()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSalvando(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SettingsIcon size={16} /> Chave PIX dos honorários
      </p>
      {carregando ? <p style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando...</p> : (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>Vai junto na mensagem de lembrete enviada ao cliente quando o honorário vence.</span>
          </div>
          <div className="form-field">
            <label className="form-label">Chave PIX</label>
            <input value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="CNPJ, e-mail, telefone ou chave aleatória" />
          </div>
          <div className="form-field">
            <label className="form-label">Nome do favorecido (opcional)</label>
            <input value={favorecido} onChange={(e) => setFavorecido(e.target.value)} placeholder="Nome do escritório" />
          </div>
          <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      )}
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>Fechar</button>
    </Modal>
  )
}

// ── Modal editar valor/vencimento de uma cobrança já gerada ─────────────────
function ModalEditarHonorario({ honorario, onClose, onSaved }) {
  const [valor, setValor] = useState(String(honorario.valor))
  const [vencimento, setVencimento] = useState(honorario.vencimento)
  const [dataPagamento, setDataPagamento] = useState(honorario.data_pagamento || '')
  const [salvando, setSalvando] = useState(false)
  const { show } = useToast()
  const pago = honorario.status === 'pago'

  const salvar = async () => {
    setSalvando(true)
    try {
      await atualizarHonorario(honorario.id, { valor: Number(valor), vencimento, dataPagamento: pago ? dataPagamento : undefined })
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSalvando(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Editar honorário — {(honorario.clientes?.nome || honorario.nome_avulso)}</p>
      <div className="form-field">
        <label className="form-label">Valor</label>
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <div className="form-field">
        <label className="form-label">Vencimento</label>
        <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </div>
      {pago && (
        <div className="form-field">
          <label className="form-label">Data de recebimento</label>
          <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
        </div>
      )}
      <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando...' : 'Salvar'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  )
}

// ── Modal novo serviço avulso ────────────────────────────────────────────────
// Aceita tanto cliente já cadastrado quanto "não cliente" (alguém sem linha
// em "clientes" — ex: abertura de empresa nova que ainda não virou cliente
// recorrente) — nesse caso pede nome (obrigatório) e telefone (opcional, só
// necessário se quiser poder mandar o lembrete de WhatsApp depois).
function ModalNovoAvulso({ onClose, onSalvo }) {
  const clientes = useStore((s) => s.clientes)
  const [quemE, setQuemE] = useState('cliente') // 'cliente' | 'nao_cliente'
  const [clienteId, setClienteId] = useState('')
  const [nomeAvulso, setNomeAvulso] = useState('')
  const [telefoneAvulso, setTelefoneAvulso] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(() => new Date().toISOString().slice(0, 10))
  const [salvando, setSalvando] = useState(false)
  const { show } = useToast()

  const salvar = async () => {
    if (quemE === 'cliente' && !clienteId) { show?.('Selecione o cliente.'); return }
    if (quemE === 'nao_cliente' && !nomeAvulso.trim()) { show?.('Preencha o nome.'); return }
    if (!descricao.trim() || !valor) { show?.('Preencha descrição e valor.'); return }
    setSalvando(true)
    try {
      await criarHonorarioAvulso({
        clienteId: quemE === 'cliente' ? clienteId : null,
        nomeAvulso: quemE === 'nao_cliente' ? nomeAvulso.trim() : null,
        telefoneAvulso: quemE === 'nao_cliente' ? telefoneAvulso.trim() : null,
        descricao: descricao.trim(), valor: Number(valor), vencimento,
      })
      show?.('Serviço avulso lançado')
      onSalvo()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSalvando(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Novo serviço avulso</p>
      <div className="notice notice-info">
        <InfoIcon size={14} />
        <span>Cobrança pontual (ex: abertura de empresa, alteração contratual) — não entra na mensalidade recorrente.</span>
      </div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab-btn ${quemE === 'cliente' ? 'active' : ''}`} onClick={() => setQuemE('cliente')}>Cliente cadastrado</button>
        <button className={`tab-btn ${quemE === 'nao_cliente' ? 'active' : ''}`} onClick={() => setQuemE('nao_cliente')}>Não cliente</button>
      </div>
      {quemE === 'cliente' ? (
        <div className="form-field">
          <label className="form-label">Cliente</label>
          <EmpresaCombobox empresas={clientes} value={clienteId} onChange={setClienteId} />
        </div>
      ) : (
        <>
          <div className="form-field">
            <label className="form-label">Nome</label>
            <input value={nomeAvulso} onChange={(e) => setNomeAvulso(e.target.value)} placeholder="Nome de quem tá sendo cobrado" />
          </div>
          <div className="form-field">
            <label className="form-label">Telefone (opcional)</label>
            <input value={telefoneAvulso} onChange={(e) => setTelefoneAvulso(e.target.value)} placeholder="(00) 00000-0000 — só se quiser poder mandar lembrete" />
          </div>
        </>
      )}
      <div className="form-field">
        <label className="form-label">Descrição do serviço</label>
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Alteração contratual" />
      </div>
      <div className="form-field">
        <label className="form-label">Valor</label>
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
      </div>
      <div className="form-field">
        <label className="form-label">Vencimento</label>
        <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </div>
      <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando...' : 'Lançar cobrança'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  )
}

// ── Modal prévia/edição do lembrete antes de enviar ──────────────────────────
// Busca o texto composto automaticamente (mesmo template do envio de
// verdade — lib/honorariosLembrete.js), deixa editar à vontade antes de
// confirmar. Sem isso, o lembrete manual saía direto sem ninguém conferir.
function ModalPreviaLembrete({ honorario, onClose, onEnviado }) {
  const [carregando, setCarregando] = useState(true)
  const [erroPrevia, setErroPrevia] = useState(null)
  const [numero, setNumero] = useState(null)
  const [textoEditado, setTextoEditado] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultadoEnvio, setResultadoEnvio] = useState(null) // { respostaEvolution } — fica visível pra conferir se a Evolution confirmou entrega de verdade
  const { show } = useToast()

  useEffect(() => {
    obterPreviaLembrete(honorario.id)
      .then(({ texto, numero, motivoBloqueio }) => {
        if (motivoBloqueio) setErroPrevia(motivoBloqueio)
        else { setNumero(numero); setTextoEditado(texto) }
      })
      .catch((e) => setErroPrevia(e.message))
      .finally(() => setCarregando(false))
  }, [honorario.id])

  const enviar = async () => {
    setEnviando(true)
    try {
      const resultado = await enviarLembreteAgora(honorario.id, textoEditado)
      show?.(`Lembrete enviado pra ${(honorario.clientes?.nome || honorario.nome_avulso)}`)
      setResultadoEnvio(resultado)
    } catch (e) {
      show?.('Não enviou: ' + e.message)
    }
    setEnviando(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Lembrete — {(honorario.clientes?.nome || honorario.nome_avulso)}</p>
      {carregando ? <p style={{ fontSize: 12, color: 'var(--text3)' }}>Montando prévia...</p> : erroPrevia ? (
        <div className="notice" style={{ background: 'var(--danger-dim)', color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <InfoIcon size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{erroPrevia}</span>
        </div>
      ) : resultadoEnvio ? (
        <>
          <div className="notice notice-info">
            <InfoIcon size={14} />
            <span>A Evolution API confirmou o recebimento da chamada. Confira no WhatsApp de {(honorario.clientes?.nome || honorario.nome_avulso)} ({numero}) se a mensagem chegou de verdade — esse app não tem confirmação de entrega automática.</span>
          </div>
          {resultadoEnvio.respostaEvolution && (
            <div className="form-field">
              <label className="form-label">Resposta da Evolution API (pra investigar se não chegar)</label>
              <textarea readOnly value={resultadoEnvio.respostaEvolution} rows={5}
                style={{ fontFamily: 'monospace', fontSize: 11, background: 'var(--surface2)' }} />
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Vai pro WhatsApp {numero} — confira e edite se quiser antes de mandar:</div>
          <div className="form-field">
            <textarea value={textoEditado} onChange={(e) => setTextoEditado(e.target.value)} rows={8}
              style={{ fontFamily: 'inherit', fontSize: 12.5 }} />
          </div>
          <button className="btn btn-accent" style={{ width: '100%' }} onClick={enviar} disabled={enviando || !textoEditado.trim()}>
            <SendIcon size={13} /> {enviando ? 'Enviando...' : 'Enviar'}
          </button>
        </>
      )}
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }}
        onClick={() => (resultadoEnvio ? onEnviado() : onClose())}>
        {resultadoEnvio ? 'Fechar' : erroPrevia ? 'Fechar' : 'Cancelar'}
      </button>
    </Modal>
  )
}

// ── Modal edição em grupo ───────────────────────────────────────────────────
// Cada campo só é aplicado se marcado — o que ficar desmarcado continua como
// está em cada cobrança. Data de recebimento implica status "Pago".
function ModalEditarLote({ honorarios, onClose, onSaved }) {
  const hoje = new Date().toISOString().slice(0, 10)
  const [usar, setUsar] = useState({ dataPagamento: true, status: false, vencimento: false, valor: false })
  const [status, setStatus] = useState('pago')
  const [dataPagamento, setDataPagamento] = useState(hoje)
  const [vencimento, setVencimento] = useState(hoje)
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const { show } = useToast()

  const marcar = (campo) => setUsar((u) => ({ ...u, [campo]: !u[campo] }))
  const algumCampo = Object.values(usar).some(Boolean)

  const salvar = async () => {
    const campos = {}
    if (usar.dataPagamento) {
      if (!dataPagamento) { show?.('Informe a data de recebimento.'); return }
      campos.status = 'pago'
      campos.data_pagamento = dataPagamento
    } else if (usar.status) {
      campos.status = status
    }
    if (usar.vencimento) {
      if (!vencimento) { show?.('Informe o vencimento.'); return }
      campos.vencimento = vencimento
    }
    if (usar.valor) {
      if (valor === '' || Number.isNaN(Number(valor))) { show?.('Informe o valor.'); return }
      campos.valor = Number(valor)
    }
    setSalvando(true)
    try {
      await atualizarHonorariosEmLote(honorarios.map((h) => h.id), campos)
      show?.(`${honorarios.length} honorário${honorarios.length !== 1 ? 's' : ''} atualizado${honorarios.length !== 1 ? 's' : ''}`)
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSalvando(false)
  }

  const rotulo = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text1)', cursor: 'pointer', marginBottom: 6 }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Editar em grupo — {honorarios.length} honorário{honorarios.length !== 1 ? 's' : ''}</p>
      <div className="notice notice-info">
        <InfoIcon size={14} />
        <span>Marque só o que quer alterar — o resto continua como está em cada cobrança.</span>
      </div>

      <div className="form-field">
        <label style={rotulo}>
          <input type="checkbox" checked={usar.dataPagamento} onChange={() => marcar('dataPagamento')} /> Data de recebimento
        </label>
        <input type="date" value={dataPagamento} disabled={!usar.dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
        {usar.dataPagamento && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Marca todos como pagos nessa data.</div>}
      </div>

      <div className="form-field" style={{ opacity: usar.dataPagamento ? 0.5 : 1 }}>
        <label style={rotulo}>
          <input type="checkbox" checked={usar.status && !usar.dataPagamento} disabled={usar.dataPagamento} onChange={() => marcar('status')} /> Status
        </label>
        <select value={status} disabled={!usar.status || usar.dataPagamento} onChange={(e) => setStatus(e.target.value)}>
          <option value="pago">Pago (recebido hoje, se ainda não tiver data)</option>
          <option value="pendente">Pendente (limpa a data de recebimento)</option>
        </select>
      </div>

      <div className="form-field">
        <label style={rotulo}>
          <input type="checkbox" checked={usar.vencimento} onChange={() => marcar('vencimento')} /> Vencimento
        </label>
        <input type="date" value={vencimento} disabled={!usar.vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </div>

      <div className="form-field">
        <label style={rotulo}>
          <input type="checkbox" checked={usar.valor} onChange={() => marcar('valor')} /> Valor
        </label>
        <input type="number" step="0.01" value={valor} placeholder="0,00" disabled={!usar.valor} onChange={(e) => setValor(e.target.value)} />
      </div>

      <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando || !algumCampo}>
        {salvando ? 'Salvando...' : `Aplicar em ${honorarios.length}`}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  )
}

// ── Aba Por carteira ─────────────────────────────────────────────────────────
// Recebido x a receber agrupado pela carteira do cliente, nos últimos N meses
// (por competência da cobrança). Gráficos em HTML/CSS puro — o app não tem
// biblioteca de gráfico e não precisa de uma pra barras.
function ultimasCompetencias(n) {
  const hoje = new Date()
  const lista = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    lista.push(String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear())
  }
  return lista
}
function fmtCurto(v) {
  const n = Number(v || 0)
  if (n >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'
  return 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
function somar(lista) {
  let recebido = 0, pendente = 0
  for (const h of lista) {
    if (h.status === 'pago') recebido += Number(h.valor)
    else pendente += Number(h.valor)
  }
  return { recebido, pendente, total: recebido + pendente }
}

const COR_RECEBIDO = 'var(--ok)'
const COR_PENDENTE = 'var(--warn)'

function Legenda() {
  const item = (cor, texto) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: cor }} />{texto}
    </span>
  )
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text2)' }}>
      {item(COR_RECEBIDO, 'Recebido')}{item(COR_PENDENTE, 'A receber')}
    </div>
  )
}

function AbaPorCarteira({ carteiras }) {
  const [meses, setMeses] = useState(6)
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)
  const [carteiraEvolucao, setCarteiraEvolucao] = useState('todas')
  const [dica, setDica] = useState(null) // { x, y, linhas }
  const competencias = useMemo(() => ultimasCompetencias(meses), [meses])

  useEffect(() => {
    setDados(null); setErro(null)
    listarHonorariosDasCompetencias(competencias).then(setDados).catch((e) => setErro(e.message))
  }, [competencias])

  const porCarteira = useMemo(() => {
    if (!dados) return []
    const grupos = new Map()
    for (const h of dados) {
      const c = carteiraDe(h)
      if (!grupos.has(c)) grupos.set(c, [])
      grupos.get(c).push(h)
    }
    return Array.from(grupos, ([c, lista]) => ({
      carteira: c,
      clientes: new Set(lista.map((h) => h.cliente_id || h.id)).size,
      ...somar(lista),
    })).sort((a, b) => b.total - a.total)
  }, [dados])

  const porMes = useMemo(() => {
    if (!dados) return []
    const filtrados = carteiraEvolucao === 'todas' ? dados : dados.filter((h) => carteiraDe(h) === carteiraEvolucao)
    return competencias.map((comp) => ({ competencia: comp, ...somar(filtrados.filter((h) => h.competencia === comp)) }))
  }, [dados, competencias, carteiraEvolucao])

  const geral = useMemo(() => somar(dados || []), [dados])

  if (erro) return <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>
  if (!dados) return <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>

  const maxCarteira = Math.max(1, ...porCarteira.map((c) => c.total))
  const maxMes = Math.max(1, ...porMes.map((m) => m.total))
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const mostrarDica = (e, linhas) => setDica({ x: e.clientX, y: e.clientY, linhas })
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '14px 16px', marginBottom: 14 }
  const kpi = (rotulo, valor, cor) => (
    <div style={{ flex: 1, minWidth: 140, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase' }}>{rotulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: cor || 'var(--text1)' }}>{valor}</div>
    </div>
  )

  return (
    <div onMouseLeave={() => setDica(null)}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>Período:</span>
        <div className="tabs" style={{ width: 300 }}>
          {[3, 6, 12].map((n) => (
            <button key={n} className={`tab-btn ${meses === n ? 'active' : ''}`} onClick={() => setMeses(n)}>{n} meses</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{competencias[0]} a {competencias[competencias.length - 1]} · por competência</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {kpi('Faturado', fmt(geral.total))}
        {kpi('Recebido', fmt(geral.recebido), 'var(--ok)')}
        {kpi('A receber', fmt(geral.pendente), 'var(--warn)')}
        {kpi('% recebido', pct(geral.recebido, geral.total) + '%')}
      </div>

      {dados.length === 0 ? (
        <div className="empty"><p>📊</p>Nenhum honorário gerado nesse período.</div>
      ) : (
        <>
          {/* Recebido x a receber por carteira */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>Recebimentos por carteira</span>
              <Legenda />
            </div>
            {porCarteira.map((c) => (
              <div key={c.carteira || '_'} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 120, flexShrink: 0, fontSize: 12, color: c.carteira ? 'var(--text1)' : 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nomeCarteira(c.carteira)}>
                  {nomeCarteira(c.carteira)}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 2, height: 18 }}
                  onMouseMove={(e) => mostrarDica(e, [nomeCarteira(c.carteira), `Recebido: ${fmt(c.recebido)}`, `A receber: ${fmt(c.pendente)}`, `${pct(c.recebido, c.total)}% recebido · ${c.clientes} cliente${c.clientes !== 1 ? 's' : ''}`])}
                  onMouseLeave={() => setDica(null)}>
                  {c.recebido > 0 && <div style={{ width: `${(c.recebido / maxCarteira) * 100}%`, background: COR_RECEBIDO, borderRadius: c.pendente > 0 ? '4px 0 0 4px' : 4 }} />}
                  {c.pendente > 0 && <div style={{ width: `${(c.pendente / maxCarteira) * 100}%`, background: COR_PENDENTE, borderRadius: c.recebido > 0 ? '0 4px 4px 0' : 4 }} />}
                </div>
                <div style={{ width: 120, flexShrink: 0, textAlign: 'right', fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {fmtCurto(c.total)} · <strong style={{ color: 'var(--text1)' }}>{pct(c.recebido, c.total)}%</strong>
                </div>
              </div>
            ))}
          </div>

          {/* Evolução mensal */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', whiteSpace: 'nowrap' }}>Evolução mês a mês</span>
                <select value={carteiraEvolucao} onChange={(e) => setCarteiraEvolucao(e.target.value)} style={{ padding: '4px 8px', fontSize: 12 }}>
                  <option value="todas">Todas as carteiras</option>
                  {carteiras.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="">Sem carteira</option>
                </select>
              </div>
              <Legenda />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, borderBottom: '1px solid var(--border)', paddingTop: 18 }}>
              {porMes.map((m) => (
                <div key={m.competencia} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', cursor: 'default' }}
                  onMouseMove={(e) => mostrarDica(e, [m.competencia, `Recebido: ${fmt(m.recebido)}`, `A receber: ${fmt(m.pendente)}`, `${pct(m.recebido, m.total)}% recebido`])}
                  onMouseLeave={() => setDica(null)}>
                  {m.total > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, whiteSpace: 'nowrap' }}>{fmtCurto(m.total)}</div>}
                  <div style={{ width: '100%', maxWidth: 44, display: 'flex', flexDirection: 'column', gap: m.recebido > 0 && m.pendente > 0 ? 2 : 0, height: `${(m.total / maxMes) * 100}%`, minHeight: m.total > 0 ? 3 : 0 }}>
                    {m.pendente > 0 && <div style={{ flex: m.pendente, background: COR_PENDENTE, borderRadius: '4px 4px 0 0' }} />}
                    {m.recebido > 0 && <div style={{ flex: m.recebido, background: COR_RECEBIDO, borderRadius: m.pendente > 0 ? 0 : '4px 4px 0 0' }} />}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {porMes.map((m) => (
                <div key={m.competencia} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10.5, color: 'var(--text3)' }}>{m.competencia.slice(0, 2)}/{m.competencia.slice(5)}</div>
              ))}
            </div>
          </div>

          {/* Tabela */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={cabecalho}>Carteira</th>
                  <th style={{ ...cabecalho, textAlign: 'right' }}>Clientes</th>
                  <th style={{ ...cabecalho, textAlign: 'right' }}>Faturado</th>
                  <th style={{ ...cabecalho, textAlign: 'right' }}>Recebido</th>
                  <th style={{ ...cabecalho, textAlign: 'right' }}>A receber</th>
                  <th style={{ ...cabecalho, textAlign: 'right' }}>% recebido</th>
                </tr>
              </thead>
              <tbody>
                {porCarteira.map((c) => (
                  <tr key={c.carteira || '_'} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: c.carteira ? 'var(--text1)' : 'var(--text3)', fontWeight: 500 }}>{nomeCarteira(c.carteira)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text2)' }}>{c.clientes}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(c.total)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--ok)' }}>{fmt(c.recebido)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: c.pendente > 0 ? 'var(--warn)' : 'var(--text3)' }}>{fmt(c.pendente)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{pct(c.recebido, c.total)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dica && (
        <div style={{ position: 'fixed', left: dica.x + 12, top: dica.y + 12, zIndex: 2000, pointerEvents: 'none', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)', padding: '7px 10px', fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
          {dica.linhas.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700, color: 'var(--text1)', marginBottom: 2 } : undefined}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
