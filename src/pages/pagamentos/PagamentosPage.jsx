import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CircleDollarSignIcon, FileTextIcon, CheckCircle2Icon, XCircleIcon, Undo2Icon, PlusIcon,
  Loader2Icon, AlertTriangleIcon, RotateCcwIcon, SparklesIcon, HandIcon, ReceiptIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { useToast, Modal } from '../../components/shared'
import EmpresaCombobox from '../../components/EmpresaCombobox'
import { abrirLinkAssinado } from '../documentos/documentosApi'
import {
  listarComprovantes, listarGuiasPendentes, darBaixaComComprovante, descartarComprovante, reabrirComprovante,
  darBaixaManual, listarBaixas, desfazerBaixa, valorCompativel, faltaSchema,
} from './pagamentosApi'

// Tela Pagamentos — baixa das guias de imposto anexadas.
//   - A conferir: comprovantes que chegaram pelo grupo "Pagamentos" do
//     WhatsApp e a IA não conseguiu baixar sozinha. Mostra o que foi lido do
//     comprovante; com a empresa escolhida (ou já identificada), só as guias
//     anexadas dela ainda sem pagamento aparecem pra baixa.
//   - Baixas feitas: histórico (automática, por comprovante ou manual com
//     justificativa), com "Desfazer".
//   - Descartados: arquivos que não eram comprovante, com o motivo.
//   - Baixa manual: guia paga sem comprovante na fila — justificativa obrigatória.
// Dados: pagamentosApi.js; fila alimentada por netlify/functions/lib/comprovantePagamento.js.

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const fmtData = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—')
const fmtDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const hojeIso = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD no fuso local

const MSG_SCHEMA = 'Falta criar a fila de comprovantes no banco — rode supabase-schema-comprovantes-pagamento.sql no SQL Editor do Supabase.'

export default function PagamentosPage() {
  const clientes = useStore((s) => s.clientes)
  const empresas = useMemo(() => clientes.filter((c) => c.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome)), [clientes])
  const [aba, setAba] = useState('conferir')
  const [pendentes, setPendentes] = useState(null)
  const [erroSchema, setErroSchema] = useState(false)
  const [baixaManualAberta, setBaixaManualAberta] = useState(false)
  const [versao, setVersao] = useState(0) // força recarregar as abas depois de uma ação

  const recarregarPendentes = useCallback(() => {
    listarComprovantes('pendente')
      .then((d) => { setPendentes(d); setErroSchema(false) })
      .catch((e) => { setPendentes([]); if (faltaSchema(e)) setErroSchema(true) })
  }, [])
  useEffect(() => { recarregarPendentes() }, [recarregarPendentes, versao])

  const atualizar = () => setVersao((v) => v + 1)

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CircleDollarSignIcon size={18} /> Pagamentos
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Comprovantes do grupo "Pagamentos" do WhatsApp e baixa das guias anexadas.
          </p>
        </div>
        <button className="btn btn-accent" onClick={() => setBaixaManualAberta(true)}>
          <PlusIcon size={14} /> Baixa manual
        </button>
      </div>

      {erroSchema && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--warn-dim)', color: 'var(--warn)', fontSize: 12.5, marginBottom: 14 }}>
          <AlertTriangleIcon size={15} /> {MSG_SCHEMA}
        </div>
      )}

      <div className="tabs" style={{ maxWidth: 520 }}>
        <button className={`tab-btn ${aba === 'conferir' ? 'active' : ''}`} onClick={() => setAba('conferir')}>
          A conferir{pendentes?.length ? ` (${pendentes.length})` : ''}
        </button>
        <button className={`tab-btn ${aba === 'baixas' ? 'active' : ''}`} onClick={() => setAba('baixas')}>Baixas feitas</button>
        <button className={`tab-btn ${aba === 'descartados' ? 'active' : ''}`} onClick={() => setAba('descartados')}>Descartados</button>
      </div>

      {aba === 'conferir' && (
        pendentes === null ? <Carregando />
          : pendentes.length === 0 ? (
            <div className="empty"><p>✅</p>Nenhum comprovante esperando conferência.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendentes.map((c) => <CartaoComprovante key={c.id} c={c} empresas={empresas} onResolvido={atualizar} />)}
            </div>
          )
      )}
      {aba === 'baixas' && <AbaBaixas key={versao} onAlterado={atualizar} />}
      {aba === 'descartados' && <AbaDescartados key={versao} onAlterado={atualizar} />}

      {baixaManualAberta && (
        <ModalBaixaManual empresas={empresas} onClose={() => setBaixaManualAberta(false)} onSalvo={() => { setBaixaManualAberta(false); atualizar() }} />
      )}
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}

function Carregando() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text3)', fontSize: 13, padding: 20 }}>
      <Loader2Icon size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Carregando...
    </div>
  )
}

function Rotulo({ children }) {
  return <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>{children}</div>
}

function Info({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Rotulo>{label}</Rotulo>
      <div style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 600, overflowWrap: 'anywhere' }}>{children || '—'}</div>
    </div>
  )
}

// Guias anexadas ainda sem pagamento da empresa, pra escolher em qual dar baixa.
function useGuiasPendentes(clienteId) {
  const [guias, setGuias] = useState(null)
  useEffect(() => {
    if (!clienteId) { setGuias([]); return }
    setGuias(null)
    let vivo = true
    listarGuiasPendentes(clienteId).then((g) => vivo && setGuias(g)).catch(() => vivo && setGuias([]))
    return () => { vivo = false }
  }, [clienteId])
  return guias
}

function ListaGuias({ guias, selecionada, onSelecionar, sugeridaId, valorPago, clienteId }) {
  if (!clienteId) return <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>Selecione a empresa para ver as guias pendentes de pagamento.</div>
  if (guias === null) return <Carregando />
  if (guias.length === 0) {
    return <div style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>Nenhuma guia anexada pendente de pagamento para essa empresa.</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {guias.map((g) => {
        const ativa = selecionada === g.id
        const confere = valorPago != null && g.valor != null ? valorCompativel(valorPago, g.valor) : null
        return (
          <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer',
            borderRadius: 'var(--r-md)', border: `1px solid ${ativa ? 'var(--accent)' : 'var(--border)'}`, background: ativa ? 'var(--accent-dim)' : 'var(--bg)' }}>
            <input type="radio" checked={ativa} onChange={() => onSelecionar(g.id)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>
                {g.titulo}{g.competencia && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{g.competencia}</span>}
                {g.id === sugeridaId && <span className="badge badge-ok" style={{ marginLeft: 8, fontSize: 9.5 }}><SparklesIcon size={9} /> sugerida</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>Vencimento {fmtData(g.vencimento)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text1)' }}>{g.valor != null ? fmt(g.valor) : 'sem valor'}</div>
              {confere != null && (
                <div style={{ fontSize: 10, fontWeight: 700, color: confere ? 'var(--ok)' : 'var(--danger)' }}>{confere ? 'valor confere' : 'valor diferente'}</div>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" title="Abrir a guia" onClick={(e) => { e.preventDefault(); abrirLinkAssinado(g.storagePath).catch(() => {}) }}>
              <FileTextIcon size={13} />
            </button>
          </label>
        )
      })}
    </div>
  )
}

// ── Cartão de um comprovante da fila ────────────────────────────────────────
function CartaoComprovante({ c, empresas, onResolvido }) {
  const { show } = useToast()
  const [clienteId, setClienteId] = useState(c.cliente_id || '')
  const guias = useGuiasPendentes(clienteId)
  const [guiaId, setGuiaId] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [descartando, setDescartando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)

  // pré-seleciona a guia sugerida pela IA quando ela está na lista da empresa
  useEffect(() => {
    if (guias && c.guia_sugerida_id && guias.some((g) => g.id === c.guia_sugerida_id)) setGuiaId(c.guia_sugerida_id)
    else setGuiaId('')
  }, [guias, c.guia_sugerida_id])

  const guia = guias?.find((g) => g.id === guiaId)
  const valorPago = c.valor_pago != null ? Number(c.valor_pago) : null
  const divergente = guia && valorPago != null && guia.valor != null && !valorCompativel(valorPago, guia.valor)
  const podeBaixar = guia && (!divergente || justificativa.trim()) && !salvando

  const baixar = async () => {
    setSalvando(true)
    try {
      await darBaixaComComprovante(c, guiaId, { justificativa: justificativa.trim() || null, clienteId })
      show?.(`Baixa feita: ${guia.titulo}${guia.competencia ? ` ${guia.competencia}` : ''}`)
      onResolvido()
    } catch (e) {
      show?.(faltaSchema(e) ? MSG_SCHEMA : `Não foi possível dar a baixa: ${e.message}`)
      setSalvando(false)
    }
  }
  const descartar = async () => {
    setSalvando(true)
    try {
      await descartarComprovante(c.id, motivo.trim())
      show?.('Comprovante descartado')
      onResolvido()
    } catch (e) {
      show?.(`Não foi possível descartar: ${e.message}`)
      setSalvando(false)
    }
  }

  const empresaIdentificada = c.cliente_id && empresas.find((e) => e.id === c.cliente_id)

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <ReceiptIcon size={16} color="var(--text3)" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.descricao || c.nome_arquivo}
        </span>
        {c.eh_comprovante === false && <span className="badge badge-warn">não parece comprovante</span>}
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          Recebido {fmtDataHora(c.criado_em)}{c.remetente ? ` · ${c.remetente}` : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => abrirLinkAssinado(c.storage_path).catch(() => {})}>
          <FileTextIcon size={13} /> Ver comprovante
        </button>
      </div>

      {/* informações básicas lidas do comprovante */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, padding: 12, borderRadius: 'var(--r-md)', background: 'var(--surface2)', marginBottom: 12 }}>
        <Info label="Valor pago">{fmt(c.valor_pago)}</Info>
        <Info label="Data do pagamento">{fmtData(c.data_pagamento)}</Info>
        <Info label="Pagador">{[c.pagador_nome, c.pagador_documento].filter(Boolean).join(' · ')}</Info>
        <Info label="Descrição">{c.descricao}</Info>
        <Info label="Banco">{c.banco}</Info>
      </div>
      {c.observacao_ia && <div style={{ fontSize: 11.5, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 12 }}>IA: "{c.observacao_ia}"</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: 14 }} className="pagamentos-grid">
        <div>
          <Rotulo>Empresa</Rotulo>
          <EmpresaCombobox empresas={empresas} value={clienteId} onChange={setClienteId} placeholder="Selecionar empresa..." />
          <div style={{ fontSize: 11, marginTop: 4, color: empresaIdentificada ? 'var(--ok)' : 'var(--warn)' }}>
            {empresaIdentificada ? (clienteId === c.cliente_id ? 'Identificada pelo comprovante' : 'Alterada manualmente') : 'Não identificada — selecione a empresa'}
          </div>
        </div>
        <div>
          <Rotulo>Guias anexadas pendentes de pagamento</Rotulo>
          <ListaGuias guias={guias} selecionada={guiaId} onSelecionar={setGuiaId} sugeridaId={c.guia_sugerida_id} valorPago={valorPago} clienteId={clienteId} />
        </div>
      </div>

      {guia && (
        <div style={{ marginTop: 12 }}>
          <Rotulo>Justificativa {divergente ? '(obrigatória — valor pago diferente do valor da guia)' : '(opcional)'}</Rotulo>
          <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={2} style={{ width: '100%', fontSize: 12.5 }}
            placeholder={divergente ? 'Ex: pago com multa e juros após o vencimento; pagamento parcial...' : ''} />
        </div>
      )}

      {descartando ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do descarte (ex: não é comprovante, duplicado)" style={{ flex: 1, minWidth: 220, fontSize: 12.5 }} autoFocus />
          <button className="btn btn-danger btn-sm" disabled={!motivo.trim() || salvando} onClick={descartar}>Confirmar descarte</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setDescartando(false)}>Cancelar</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDescartando(true)} disabled={salvando}><XCircleIcon size={13} /> Descartar</button>
          <button className="btn btn-accent btn-sm" onClick={baixar} disabled={!podeBaixar}>
            {salvando ? <Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <CheckCircle2Icon size={13} />} Dar baixa
          </button>
        </div>
      )}
      <style>{'@media (max-width: 720px) { .pagamentos-grid { grid-template-columns: 1fr !important; } }'}</style>
    </div>
  )
}

// ── Baixas feitas ───────────────────────────────────────────────────────────
function AbaBaixas({ onAlterado }) {
  const { show } = useToast()
  const [baixas, setBaixas] = useState(null)
  const [busca, setBusca] = useState('')
  useEffect(() => { listarBaixas().then(setBaixas).catch(() => setBaixas([])) }, [])

  const desfazer = async (b) => {
    if (!window.confirm(`Desfazer a baixa de ${b.titulo}${b.competencia ? ` ${b.competencia}` : ''} — ${b.clienteNome}?\nA guia volta a ficar em aberto${b.manual ? '' : ' e o comprovante volta para "A conferir"'}.`)) return
    try {
      await desfazerBaixa(b.id)
      show?.('Baixa desfeita')
      onAlterado()
    } catch (e) {
      show?.(`Não foi possível desfazer: ${e.message}`)
    }
  }

  if (baixas === null) return <Carregando />
  const termo = busca.trim().toLowerCase()
  const lista = termo ? baixas.filter((b) => `${b.clienteNome} ${b.titulo} ${b.competencia || ''}`.toLowerCase().includes(termo)) : baixas
  return (
    <>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por empresa ou guia..." style={{ width: '100%', maxWidth: 360, marginBottom: 12, fontSize: 12.5 }} />
      {lista.length === 0 ? <div className="empty"><p>🧾</p>Nenhuma baixa encontrada.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map((b) => {
            const automatica = b.por === 'automática (IA)'
            const tipo = b.manual ? { label: 'Manual', cls: 'badge-warn', Icon: HandIcon }
              : automatica ? { label: 'Automática (IA)', cls: 'badge-ok', Icon: SparklesIcon }
                : { label: 'Comprovante', cls: 'badge-info', Icon: ReceiptIcon }
            return (
              <div key={b.id} className="card" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>
                    {b.titulo}{b.competencia && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{b.competencia}</span>}
                    <span className={`badge ${tipo.cls}`} style={{ marginLeft: 8, fontSize: 9.5 }}><tipo.Icon size={9} /> {tipo.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>{b.clienteNome}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    Pago em {fmtData(b.pagoEm?.slice(0, 10))}{b.por ? ` · baixa por ${b.por}` : ''}{b.registradaEm ? ` em ${fmtDataHora(b.registradaEm)}` : ''}
                  </div>
                  {b.justificativa && <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4, fontStyle: 'italic' }}>Justificativa: "{b.justificativa}"</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)' }}>{fmt(b.valorPago ?? b.valorGuia)}</div>
                  {b.valorPago != null && b.valorGuia != null && Math.abs(b.valorPago - b.valorGuia) > 0.05 && (
                    <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>guia {fmt(b.valorGuia)}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {b.comprovantePath && (
                    <button className="btn btn-ghost btn-sm" onClick={() => abrirLinkAssinado(b.comprovantePath).catch(() => {})}><FileTextIcon size={13} /> Comprovante</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => desfazer(b)}><Undo2Icon size={13} /> Desfazer</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ── Descartados ─────────────────────────────────────────────────────────────
function AbaDescartados({ onAlterado }) {
  const { show } = useToast()
  const [itens, setItens] = useState(null)
  useEffect(() => { listarComprovantes('descartado').then(setItens).catch(() => setItens([])) }, [])
  if (itens === null) return <Carregando />
  if (itens.length === 0) return <div className="empty"><p>🗂️</p>Nenhum comprovante descartado.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {itens.map((c) => (
        <div key={c.id} className="card" style={{ padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>{c.descricao || c.nome_arquivo}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {[c.pagador_nome, fmt(c.valor_pago), c.data_pagamento && fmtData(c.data_pagamento)].filter(Boolean).join(' · ')}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 4 }}>
              Motivo: "{c.motivo_descarte}" — {c.resolvido_por} em {fmtDataHora(c.resolvido_em)}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => abrirLinkAssinado(c.storage_path).catch(() => {})}><FileTextIcon size={13} /> Ver</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => {
            try { await reabrirComprovante(c.id); show?.('Comprovante voltou para "A conferir"'); onAlterado() } catch (e) { show?.(e.message) }
          }}><RotateCcwIcon size={13} /> Reabrir</button>
        </div>
      ))}
    </div>
  )
}

// ── Baixa manual ────────────────────────────────────────────────────────────
function ModalBaixaManual({ empresas, onClose, onSalvo }) {
  const { show } = useToast()
  const [clienteId, setClienteId] = useState('')
  const guias = useGuiasPendentes(clienteId)
  const [guiaId, setGuiaId] = useState('')
  const [dataPagamento, setDataPagamento] = useState(hojeIso())
  const [valorPago, setValorPago] = useState('')
  const [justificativa, setJustificativa] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { setGuiaId('') }, [clienteId])
  const guia = guias?.find((g) => g.id === guiaId)
  useEffect(() => { setValorPago(guia?.valor != null ? String(guia.valor.toFixed(2)).replace('.', ',') : '') }, [guiaId]) // eslint-disable-line react-hooks/exhaustive-deps

  const valorNumero = valorPago.trim() ? Number(valorPago.replace(/\./g, '').replace(',', '.')) : null
  const valido = guia && justificativa.trim() && dataPagamento && (valorNumero == null || Number.isFinite(valorNumero))

  const salvar = async () => {
    setSalvando(true)
    try {
      await darBaixaManual({ guiaId, dataPagamento, valorPago: valorNumero, justificativa, arquivo })
      show?.(`Baixa manual registrada: ${guia.titulo}${guia.competencia ? ` ${guia.competencia}` : ''}`)
      onSalvo()
    } catch (e) {
      show?.(faltaSchema(e) ? MSG_SCHEMA : `Não foi possível dar a baixa: ${e.message}`)
      setSalvando(false)
    }
  }

  return (
    <Modal onClose={onClose}>
        <p className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><HandIcon size={16} /> Baixa manual de guia</p>
        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
          Para quando o pagamento foi confirmado sem comprovante na fila. A justificativa fica registrada no histórico.
        </p>

        <div className="form-field">
          <label className="form-label">Empresa</label>
          <EmpresaCombobox empresas={empresas} value={clienteId} onChange={setClienteId} placeholder="Selecionar empresa..." />
        </div>
        <div className="form-field">
          <label className="form-label">Guia anexada pendente de pagamento</label>
          <ListaGuias guias={guias} selecionada={guiaId} onSelecionar={setGuiaId} valorPago={null} clienteId={clienteId} />
        </div>
        {guia && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-field">
                <label className="form-label">Data do pagamento</label>
                <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">Valor pago (opcional)</label>
                <input value={valorPago} onChange={(e) => setValorPago(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
            </div>
            <div className="form-field">
              <label className="form-label">Justificativa (obrigatória)</label>
              <textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={3}
                placeholder="Ex: cliente confirmou o pagamento por telefone; pago via débito automático; conferido no e-CAC..." />
            </div>
            <div className="form-field">
              <label className="form-label">Comprovante (opcional)</label>
              <input type="file" accept=".pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent" onClick={salvar} disabled={!valido || salvando}>
            {salvando ? 'Salvando...' : 'Dar baixa'}
          </button>
        </div>
    </Modal>
  )
}
