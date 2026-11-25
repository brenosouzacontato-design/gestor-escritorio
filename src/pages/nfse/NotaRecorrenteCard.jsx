// Uma semana de nota recorrente a emitir, mostrada como a nota que vai sair: tomador, descrição,
// data e valor. "Editar" ajusta só esta nota (o modelo continua igual); "Emitir" pede confirmação
// na própria tela e a nota sai na hora (ação recorrente_emitir em netlify/functions/nfse.js).
// "Sem serviço" tira a semana (ou o mês) de "a emitir" (desfaz no histórico do modelo).
// Modo avulsa: nota extra com os dados do modelo, em qualquer data até hoje, que não conta como a
// nota da semana (ex.: segunda nota na mesma semana).
// Usado na tela Hoje e no painel de recorrentes da tela Emitir NFS-e.
import { useState } from 'react'
import { SendIcon, PencilIcon, CalendarOffIcon, XIcon } from 'lucide-react'
import { chamarNfse, enviarNfseWhatsapp } from './nfseApi'
import ConfirmarEmissao from './ConfirmarEmissao'

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const soDig = (v) => String(v || '').replace(/\D/g, '')
export const docFmt = (d) => {
  const s = soDig(d)
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || ''
}

// "Semana 26/10 a 01/11/2026" ou "Mês 10/2026" (modelo mensal)
export const rotuloPeriodo = (periodicidade, inicio, fim) => (periodicidade === 'mensal'
  ? `Mês ${dataBR(inicio).slice(3)}`
  : `Semana ${dataBR(inicio).slice(0, 5)} a ${dataBR(fim)}`)

// Hoje no fuso local, em AAAA-MM-DD
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const somarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const segundaDa = (iso) => somarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
const ultimoDoMes = (iso) => { const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10) }
// Descrição do modelo para o período (semana ou mês) em que cai a data — igual a recorrentes.descricaoDa
export function descricaoNaData(modelo, data) {
  const mensal = modelo.periodicidade === 'mensal'
  const inicio = mensal ? `${data.slice(0, 7)}-01` : segundaDa(data)
  const fim = mensal ? ultimoDoMes(data) : somarDias(inicio, 6)
  return String(modelo.descricao || '').replace(/\{inicio\}/g, dataBR(inicio)).replace(/\{fim\}/g, dataBR(fim)).replace(/\{mes\}/g, dataBR(inicio).slice(3))
}

// "25/11/2026 às 14:30" (Brasília)
const agendadaBR = (iso) => {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString()
  return `${dataBR(d.slice(0, 10))} às ${d.slice(11, 16)}`
}

const rotulo = { fontSize: 11, color: 'var(--text3)', fontWeight: 600 }
const campo = { width: '100%', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }

// clienteId, empresa (nome, opcional), ambiente, modelo {id, nome, cpf, endereco, valor, periodicidade, descricao?},
// s {inicio, fim, emAndamento, data, descricao, nota}; onPronto({ok, texto}) após cada tentativa;
// onPular(s) opcional ("sem serviço", devolve uma Promise).
// avulsa: nota extra do modelo (s vem só com data e descricao); onFechar fecha o cartão.
export default function NotaRecorrenteCard({ clienteId, empresa, ambiente, modelo, s, onPronto, onPular, avulsa = false, onFechar }) {
  const original = { nome: modelo.nome, cpf: docFmt(modelo.cpf), endereco: modelo.endereco || '', descricao: s.descricao, data: s.data || s.fim }
  const [nota, setNota] = useState(original)
  const [descricaoEditada, setDescricaoEditada] = useState(false)
  const [pulando, setPulando] = useState(false)
  const [valor, setValor] = useState(s.nota?.valor ? valorBR(s.nota.valor) : valorBR(modelo.valor))
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState(null)
  const teste = ambiente !== 'producao'
  const mensal = modelo.periodicidade === 'mensal'
  const periodo = avulsa ? 'Nota avulsa (não conta como a nota da semana)' : rotuloPeriodo(modelo.periodicidade, s.inicio, s.fim)
  const problema = s.nota && (s.nota.estado === 'rejeitada' ? s.nota.mensagem : (s.nota.erros || []).join('; '))
  const dataMin = avulsa ? undefined : s.inicio
  const dataMax = avulsa ? hojeIso() : s.emAndamento ? (s.data || s.fim) : s.fim
  const mudou = (k) => String(nota[k]).trim() !== String(original[k]).trim()
  const ajustada = (avulsa ? ['nome', 'cpf', 'endereco'] : ['nome', 'cpf', 'endereco', 'descricao', 'data']).some(mudou)
  const set = (k) => (e) => {
    const v = e.target.value
    if (k === 'descricao') setDescricaoEditada(true)
    // avulsa: a descrição acompanha o período da data, até a pessoa mexer nela
    if (k === 'data' && avulsa && !descricaoEditada && /^\d{4}-\d{2}-\d{2}$/.test(v) && modelo.descricao) {
      setNota((n) => ({ ...n, data: v, descricao: descricaoNaData(modelo, v) }))
      return
    }
    setNota((n) => ({ ...n, [k]: v }))
  }

  async function semServico() {
    setPulando(true)
    try { await onPular(s) } finally { setPulando(false) }
  }

  function pedirConfirmacao() {
    setMsg(null)
    if (!valor.trim()) { setMsg('Digite o valor da nota'); return }
    if (!nota.nome.trim()) { setMsg('Informe o tomador'); return }
    if (![11, 14].includes(soDig(nota.cpf).length)) { setMsg('CNPJ (14 dígitos) ou CPF (11) do tomador'); return }
    if (!nota.descricao.trim()) { setMsg('Informe a descrição do serviço'); return }
    if (avulsa ? (!nota.data || nota.data > dataMax) : (!nota.data || nota.data < s.inicio || nota.data > dataMax)) {
      setMsg(avulsa ? 'A data do serviço precisa ser até hoje' : `A data precisa estar entre ${dataBR(s.inicio)} e ${dataBR(dataMax)}`)
      return
    }
    setEditando(false)
    setConfirmando(true)
  }

  async function emitir() {
    setEnviando(true)
    setMsg(null)
    const ajustes = {}
    for (const k of ['nome', 'endereco', 'descricao', 'data']) if (mudou(k)) ajustes[k] = nota[k]
    if (mudou('cpf')) ajustes.cpf = soDig(nota.cpf)
    if (!ajustes.data) ajustes.data = nota.data
    try {
      const r = await chamarNfse('recorrente_emitir', avulsa
        ? { cliente_id: clienteId, id: modelo.id, avulsa: true, valor, ambiente, ...ajustes, data: nota.data, descricao: nota.descricao }
        : { cliente_id: clienteId, id: modelo.id, semana: s.inicio, valor, ambiente, ...ajustes })
      if (r.resultado?.estado === 'autorizada') {
        const entrega = ambiente === 'producao' && r.nota?.id ? await enviarNfseWhatsapp(r.nota.id) : null
        onPronto?.({ ok: true, texto: `NFS-e nº ${r.nota?.numero_nfse || ''} emitida${empresa ? ` · ${empresa}` : ''} · ${brl(r.nota?.valor)}${entrega ? ` · ${entrega.texto}` : ''}` })
        return
      }
      const texto = r.resultado?.mensagem || `Situação: ${r.resultado?.estado}. Confira na tela Emitir NFS-e.`
      setMsg(texto)
      onPronto?.({ ok: false, texto })
    } catch (e) {
      setMsg(e.message)
    } finally {
      setEnviando(false)
      setConfirmando(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', margin: '8px 0', background: 'var(--surface)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {empresa && <b>{empresa}</b>}
        <span style={{ color: 'var(--text2)' }}>{empresa ? '· ' : ''}{periodo}</span>
        {s.emAndamento && <span className="badge" style={{ fontSize: 10 }}>{mensal ? 'mês em andamento' : 'semana em andamento'}</span>}
        {onFechar && <button type="button" className="btn btn-icon btn-ghost" style={{ marginLeft: 'auto' }} title="Fechar" disabled={enviando} onClick={onFechar}><XIcon size={14} /></button>}
        {teste && <span className="badge badge-warn" style={{ fontSize: 10 }}>homologação</span>}
        {ajustada && <span className="badge" style={{ fontSize: 10 }}>ajustada só nesta nota</span>}
      </div>

      {s.agendamento && (
        <div style={{ marginTop: 6, fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--accent-dim, var(--surface2))', color: 'var(--accent)' }}>
          ⏰ Emissão agendada para {agendadaBR(s.agendamento.executar_em)} · {brl(s.agendamento.valor)}. Ela sai sozinha
          {' '}(cancele em Emitir NFS-e → Notas recorrentes se for emitir agora).
        </div>
      )}

      {!editando && (
        <div style={{ marginTop: 6, lineHeight: 1.5 }}>
          <div>Tomador: <b>{nota.nome}</b> · {nota.cpf}</div>
          <div style={{ color: 'var(--text2)', fontSize: 12 }}>{nota.descricao}</div>
          <div style={{ color: 'var(--text2)', fontSize: 12 }}>Data do serviço: {dataBR(nota.data)}</div>
        </div>
      )}

      {editando && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
          <label><div style={rotulo}>Tomador</div><input style={campo} value={nota.nome} onChange={set('nome')} /></label>
          <label><div style={rotulo}>CNPJ / CPF</div><input style={campo} value={nota.cpf} onChange={set('cpf')} inputMode="numeric" /></label>
          <label style={{ gridColumn: '1 / -1' }}><div style={rotulo}>Endereço do tomador</div><input style={campo} value={nota.endereco} onChange={set('endereco')} /></label>
          <label style={{ gridColumn: '1 / -1' }}><div style={rotulo}>Descrição do serviço</div>
            <textarea style={{ ...campo, minHeight: 56, resize: 'vertical' }} value={nota.descricao} onChange={set('descricao')} /></label>
          <label><div style={rotulo}>Data do serviço</div>
            <input type="date" style={campo} value={nota.data} min={dataMin} max={dataMax} onChange={set('data')} /></label>
          <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--text3)' }}>
            Os ajustes valem só para esta nota; o modelo continua igual.
            {ajustada && <button type="button" className="btn btn-ghost" style={{ padding: '0 0 0 8px', fontSize: 11 }} onClick={() => setNota(original)}>desfazer ajustes</button>}
          </div>
        </div>
      )}

      {(msg || problema) && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{msg || `Tentativa anterior: ${problema}`}</div>}

      {!confirmando && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Valor R$</span>
          <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" aria-label="Valor da nota"
            onKeyDown={(e) => { if (e.key === 'Enter') pedirConfirmacao() }}
            style={{ width: 120, textAlign: 'right', padding: '6px 8px' }} />
          <button type="button" className="btn btn-accent" disabled={enviando} onClick={pedirConfirmacao}>
            <SendIcon size={14} /> Emitir
          </button>
          <button type="button" className="btn btn-ghost" disabled={enviando} onClick={() => setEditando(!editando)}>
            <PencilIcon size={13} /> {editando ? 'Fechar edição' : 'Editar'}
          </button>
          {onPular && !avulsa && <button type="button" className="btn" style={{ marginLeft: 'auto' }} disabled={enviando || pulando} onClick={semServico}
            title={`Não teve nota ${mensal ? 'neste mês' : 'nesta semana'}: sai de "a emitir" (dá para desfazer no histórico do modelo, na tela Emitir NFS-e)`}>
            <CalendarOffIcon size={13} /> {pulando ? 'Marcando…' : `Sem serviço ${mensal ? 'neste mês' : 'nesta semana'}`}</button>}
        </div>
      )}

      {confirmando && (
        <div style={{ marginTop: 8 }}>
          <ConfirmarEmissao empresa={empresa} tomador={nota.nome} documento={nota.cpf} inicio={s.inicio} fim={s.fim} periodo={periodo} data={nota.data}
            valor={valor} descricao={nota.descricao} ambiente={ambiente} enviando={enviando}
            onConfirmar={emitir} onCancelar={() => setConfirmando(false)} />
        </div>
      )}
    </div>
  )
}
