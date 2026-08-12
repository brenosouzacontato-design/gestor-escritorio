import { useState, useEffect, useMemo } from 'react'
import { BanknoteIcon, SearchIcon, SendIcon, SettingsIcon, RefreshCwIcon, PencilIcon, InfoIcon } from 'lucide-react'
import { Modal, useToast } from '../../components/shared'
import {
  listarHonorariosDoMes, gerarHonorariosDoMes, marcarStatusHonorario,
  atualizarHonorario, atualizarConfigCliente, obterConfigPix, salvarConfigPix,
  enviarLembreteAgora, listarClientesConfigurados,
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
  const [aba, setAba] = useState('cobrancas') // cobrancas | config
  const [competencia, setCompetencia] = useState(competenciaAtual())
  const [honorarios, setHonorarios] = useState(null)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('todos')
  const [gerando, setGerando] = useState(false)
  const [enviandoId, setEnviandoId] = useState(null)
  const [showConfigPix, setShowConfigPix] = useState(false)
  const [editando, setEditando] = useState(null)
  const { show } = useToast()

  const carregar = () => {
    setErro(null)
    listarHonorariosDoMes(competencia).then(setHonorarios).catch((e) => setErro(e.message))
  }
  useEffect(() => { setHonorarios(null); carregar() }, [competencia])

  const filtrados = useMemo(() => {
    if (!honorarios) return []
    let lista = honorarios
    if (statusFiltro !== 'todos') lista = lista.filter((h) => h.status === statusFiltro)
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase()
      lista = lista.filter((h) => h.clientes?.nome?.toLowerCase().includes(termo))
    }
    return lista
  }, [honorarios, busca, statusFiltro])

  const totalPendente = (honorarios || []).filter((h) => h.status === 'pendente').reduce((s, h) => s + Number(h.valor), 0)
  const totalPago = (honorarios || []).filter((h) => h.status === 'pago').reduce((s, h) => s + Number(h.valor), 0)

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
    setHonorarios((prev) => prev.map((x) => (x.id === h.id ? { ...x, status: novo } : x)))
    try {
      await marcarStatusHonorario(h.id, novo)
    } catch (e) {
      show?.('Erro ao atualizar: ' + e.message)
      carregar()
    }
  }

  const handleEnviarLembrete = async (h) => {
    setEnviandoId(h.id)
    try {
      await enviarLembreteAgora(h.id)
      show?.(`Lembrete enviado pra ${h.clientes?.nome}`)
      carregar()
    } catch (e) {
      show?.('Não enviou: ' + e.message)
    }
    setEnviandoId(null)
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
        <button className="btn btn-ghost btn-sm" onClick={() => setShowConfigPix(true)}>
          <SettingsIcon size={13} /> Configurar PIX
        </button>
      </div>

      <div className="tabs" style={{ maxWidth: 340, marginBottom: 14 }}>
        <button className={`tab-btn ${aba === 'cobrancas' ? 'active' : ''}`} onClick={() => setAba('cobrancas')}>Cobranças</button>
        <button className={`tab-btn ${aba === 'config' ? 'active' : ''}`} onClick={() => setAba('config')}>Configurar clientes</button>
      </div>

      {aba === 'config' && <AbaConfigClientes />}

      {aba === 'cobrancas' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            <select value={competencia} onChange={(e) => setCompetencia(e.target.value)} style={{ padding: '7px 10px', fontSize: 12.5 }}>
              {opcoesCompetencia().map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
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

          {honorarios && honorarios.length > 0 && (
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

          {honorarios && filtrados.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    <th style={cabecalho}>Cliente</th>
                    <th style={cabecalho}>Valor</th>
                    <th style={cabecalho}>Vencimento</th>
                    <th style={cabecalho}>Status</th>
                    <th style={cabecalho}>Lembrete</th>
                    <th style={cabecalho}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((h) => {
                    const atraso = h.status === 'pendente' ? diasAtraso(h.vencimento) : 0
                    return (
                      <tr key={h.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 12px', color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h.clientes?.nome}</td>
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
                        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                          {h.lembrete_enviado_em ? `Enviado ${fmtData(h.lembrete_enviado_em.slice(0, 10))}` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditando(h)} title="Editar valor/vencimento">
                            <PencilIcon size={13} />
                          </button>
                          {h.status === 'pendente' && (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleEnviarLembrete(h)} disabled={enviandoId === h.id} title="Enviar lembrete agora">
                              <SendIcon size={13} /> {enviandoId === h.id ? 'Enviando...' : 'Lembrete'}
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
  const [salvando, setSalvando] = useState(false)
  const { show } = useToast()

  const salvar = async () => {
    setSalvando(true)
    try {
      await atualizarHonorario(honorario.id, { valor: Number(valor), vencimento })
      onSaved()
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
    }
    setSalvando(false)
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Editar honorário — {honorario.clientes?.nome}</p>
      <div className="form-field">
        <label className="form-label">Valor</label>
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
      </div>
      <div className="form-field">
        <label className="form-label">Vencimento</label>
        <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
      </div>
      <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando...' : 'Salvar'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  )
}
