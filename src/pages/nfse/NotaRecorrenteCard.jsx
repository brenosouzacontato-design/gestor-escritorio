// Uma semana de nota recorrente a emitir, mostrada como a nota que vai sair: tomador, descrição,
// data e valor. "Editar" ajusta só esta nota (o modelo continua igual); "Emitir" pede confirmação
// na própria tela e a nota sai na hora (ação recorrente_emitir em netlify/functions/nfse.js).
// Usado na tela Hoje e no painel de recorrentes da tela Emitir NFS-e.
import { useState } from 'react'
import { SendIcon, PencilIcon } from 'lucide-react'
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

const rotulo = { fontSize: 11, color: 'var(--text3)', fontWeight: 600 }
const campo = { width: '100%', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' }

// clienteId, empresa (nome, opcional), ambiente, modelo {id, nome, cpf, endereco, valor},
// s {inicio, fim, emAndamento, data, descricao, nota}; onPronto({ok, texto}) após cada tentativa;
// onPular(s) opcional ("sem serviço").
export default function NotaRecorrenteCard({ clienteId, empresa, ambiente, modelo, s, onPronto, onPular }) {
  const original = { nome: modelo.nome, cpf: docFmt(modelo.cpf), endereco: modelo.endereco || '', descricao: s.descricao, data: s.data || s.fim }
  const [nota, setNota] = useState(original)
  const [valor, setValor] = useState(s.nota?.valor ? valorBR(s.nota.valor) : valorBR(modelo.valor))
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState(null)
  const teste = ambiente !== 'producao'
  const problema = s.nota && (s.nota.estado === 'rejeitada' ? s.nota.mensagem : (s.nota.erros || []).join('; '))
  const dataMax = s.emAndamento ? (s.data || s.fim) : s.fim
  const mudou = (k) => String(nota[k]).trim() !== String(original[k]).trim()
  const ajustada = ['nome', 'cpf', 'endereco', 'descricao', 'data'].some(mudou)
  const set = (k) => (e) => setNota((n) => ({ ...n, [k]: e.target.value }))

  function pedirConfirmacao() {
    setMsg(null)
    if (!valor.trim()) { setMsg('Digite o valor da nota'); return }
    if (!nota.nome.trim()) { setMsg('Informe o tomador'); return }
    if (![11, 14].includes(soDig(nota.cpf).length)) { setMsg('CNPJ (14 dígitos) ou CPF (11) do tomador'); return }
    if (!nota.descricao.trim()) { setMsg('Informe a descrição do serviço'); return }
    if (!nota.data || nota.data < s.inicio || nota.data > dataMax) { setMsg(`A data precisa estar entre ${dataBR(s.inicio)} e ${dataBR(dataMax)}`); return }
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
      const r = await chamarNfse('recorrente_emitir', { cliente_id: clienteId, id: modelo.id, semana: s.inicio, valor, ambiente, ...ajustes })
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
        <span style={{ color: 'var(--text2)' }}>{empresa ? '· ' : ''}Semana {dataBR(s.inicio).slice(0, 5)} a {dataBR(s.fim)}</span>
        {s.emAndamento && <span className="badge" style={{ fontSize: 10 }}>semana em andamento</span>}
        {teste && <span className="badge badge-warn" style={{ fontSize: 10 }}>homologação</span>}
        {ajustada && <span className="badge" style={{ fontSize: 10 }}>ajustada só nesta nota</span>}
      </div>

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
            <input type="date" style={campo} value={nota.data} min={s.inicio} max={dataMax} onChange={set('data')} /></label>
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
          {onPular && <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} disabled={enviando} onClick={() => onPular(s)} title="Não teve serviço nesta semana">sem serviço</button>}
        </div>
      )}

      {confirmando && (
        <div style={{ marginTop: 8 }}>
          <ConfirmarEmissao empresa={empresa} tomador={nota.nome} documento={nota.cpf} inicio={s.inicio} fim={s.fim} data={nota.data}
            valor={valor} descricao={nota.descricao} ambiente={ambiente} enviando={enviando}
            onConfirmar={emitir} onCancelar={() => setConfirmando(false)} />
        </div>
      )}
    </div>
  )
}
