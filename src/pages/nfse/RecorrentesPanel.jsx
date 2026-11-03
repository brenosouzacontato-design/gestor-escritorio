import { useEffect, useState } from 'react'
import { RepeatIcon, PlusIcon, PencilIcon, Trash2Icon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useToast } from '../../components/shared'
import { chamarNfse } from './nfseApi'
import NotaRecorrenteCard from './NotaRecorrenteCard'

// Notas recorrentes semanais: mesmo tomador (CNPJ ou CPF), mesma descrição e serviço toda semana; só
// o valor muda (ex.: ponto de coleta que emite toda semana para a Shopee). Cada semana (segunda a
// domingo), inclusive a em andamento, aparece "a emitir" como um cartão da nota (NotaRecorrenteCard):
// o escritório confere, ajusta se precisar, digita o valor e a nota é emitida na hora.
// Servidor: ações recorrente* (netlify/functions/nfse.js, lib/nfse/recorrentes.js).

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const suave = { color: 'var(--text3)', fontSize: 12 }
const td = { padding: '6px 8px', borderTop: '1px solid var(--border)', verticalAlign: 'middle' }
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const valorBR = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const curta = (iso) => dataBR(iso).slice(0, 5)
const soDig = (v) => String(v || '').replace(/\D/g, '')
const docFmt = (d) => {
  const s = soDig(d)
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d || ''
}
const VAZIO = { nome: '', cpf: '', endereco: '', cep: '', descricao: 'Serviços prestados no período de {inicio} a {fim}', valor: '', inicio: '' }

export default function RecorrentesPanel({ clienteId, ambiente, onEmitida }) {
  const { show } = useToast()
  const [lista, setLista] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [form, setForm] = useState(null) // modelo sendo criado/editado
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    try {
      const r = await chamarNfse('recorrentes_listar', { cliente_id: clienteId })
      setLista(r.recorrentes)
      setAviso(r.aviso || null)
    } catch (e) { show(e.message) }
  }
  useEffect(() => { setLista(null); setForm(null); carregar() }, [clienteId, ambiente])

  async function salvar() {
    setOcupado(true)
    try {
      await chamarNfse('recorrente_salvar', { cliente_id: clienteId, recorrente: { ...form, cpf: soDig(form.cpf) } })
      setForm(null)
      await carregar()
      show('Modelo salvo')
    } catch (e) { show(e.message) } finally { setOcupado(false) }
  }

  async function excluir(m) {
    try { await chamarNfse('recorrente_excluir', { cliente_id: clienteId, id: m.id }); await carregar() } catch (e) { show(e.message) }
  }

  async function pular(m, s, desfazer = false) {
    try { await chamarNfse('recorrente_pular', { cliente_id: clienteId, id: m.id, semana: s.inicio, desfazer }); await carregar() } catch (e) { show(e.message) }
  }

  // a emissão é feita no cartão (NotaRecorrenteCard); aqui só recarrega depois
  async function emitida({ ok, texto }) {
    if (ok) show(texto)
    await carregar()
    onEmitida?.()
  }

  const aEmitir = (lista || []).reduce((n, m) => n + m.semanas.filter((s) => s.situacao === 'a_emitir').length, 0)

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <RepeatIcon size={16} /><b style={{ fontSize: 14 }}>Notas recorrentes (semanais)</b>
        {aEmitir > 0 && <span style={{ background: 'var(--warn-dim)', color: 'var(--warn)', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{aEmitir} semana(s) a emitir</span>}
        {!form && !aviso && <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setForm({ ...VAZIO })}><PlusIcon size={14} /> Novo modelo</button>}
      </div>
      <p style={{ ...suave, margin: '6px 0 10px' }}>
        Mesmo tomador e mesma descrição toda semana (segunda a domingo); só o valor muda. A semana atual já aparece aqui:
        confira a nota, ajuste se precisar (só aquela nota), digite o valor e emita.
      </p>
      {aviso && <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--warn-dim)', color: 'var(--warn)' }}>{aviso}</div>}

      {form && <FormModelo form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setForm(null)} ocupado={ocupado} />}

      {lista === null && <div style={suave}>Carregando…</div>}
      {lista?.length === 0 && !form && !aviso && <div style={suave}>Nenhum modelo. Use “Novo modelo” para cadastrar (ex.: Shopee, toda semana).</div>}
      {(lista || []).map((m) => (
        <Modelo key={m.id} m={m} ambiente={ambiente} onEditar={() => setForm({ ...VAZIO, ...m, valor: valorBR(m.valor) })}
          onExcluir={() => excluir(m)} onPular={(s, d) => pular(m, s, d)} clienteId={clienteId} onPronto={emitida} />
      ))}
    </div>
  )
}

function FormModelo({ form, setForm, onSalvar, onCancelar, ocupado }) {
  const campo = (k) => ({ value: form[k] ?? '', onChange: (e) => setForm({ ...form, [k]: e.target.value }) })
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'var(--surface2)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div><label className="form-label">Tomador (razão social)</label><input {...campo('nome')} placeholder="Ex.: razão social da Shopee" /></div>
        <div><label className="form-label">CNPJ (ou CPF)</label><input value={docFmt(form.cpf)} onChange={(e) => setForm({ ...form, cpf: soDig(e.target.value).slice(0, 14) })} placeholder="00.000.000/0000-00" /></div>
        <div><label className="form-label">Endereço do tomador</label><input {...campo('endereco')} /></div>
        <div><label className="form-label">CEP</label><input {...campo('cep')} /></div>
        <div><label className="form-label">Primeira semana (qualquer dia dela)</label><input type="date" {...campo('inicio')} /></div>
        <div><label className="form-label">Valor sugerido (opcional)</label><input {...campo('valor')} placeholder="0,00" /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="form-label">Descrição da nota — {'{inicio}'} e {'{fim}'} viram as datas da semana</label>
        <textarea rows={2} {...campo('descricao')} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-accent" disabled={ocupado || !form.nome.trim() || ![11, 14].includes(soDig(form.cpf).length)} onClick={onSalvar}>Salvar modelo</button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
        <span style={{ ...suave, alignSelf: 'center' }}>O código do serviço e a tributação vêm da configuração da empresa (gabarito).</span>
      </div>
    </div>
  )
}

function Modelo({ m, ambiente, clienteId, onEditar, onExcluir, onPular, onPronto }) {
  const [historico, setHistorico] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const pendentes = m.semanas.filter((s) => s.situacao === 'a_emitir').reverse()
  const feitas = m.semanas.filter((s) => s.situacao !== 'a_emitir').reverse()
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b>{m.nome}</b><span style={suave}>{docFmt(m.cpf)} · desde {dataBR(m.inicio)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-icon btn-ghost" title="Editar modelo" onClick={onEditar}><PencilIcon size={13} /></button>
          <button className="btn btn-icon btn-ghost" title="Excluir modelo" onClick={() => setExcluindo(true)}><Trash2Icon size={13} /></button>
        </span>
      </div>
      {excluindo && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, padding: '6px 8px', borderRadius: 6, background: 'var(--warn-dim)', fontSize: 12 }}>
          Excluir o modelo “{m.nome}”? As notas já emitidas continuam.
          <button className="btn btn-sm" onClick={() => { setExcluindo(false); onExcluir() }}>Sim, excluir</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setExcluindo(false)}>Cancelar</button>
        </div>
      )}
      {pendentes.length === 0
        ? <div style={{ ...suave, marginTop: 6 }}>Nenhuma semana a emitir. A próxima aparece na segunda-feira.</div>
        : pendentes.map((s) => (
          <NotaRecorrenteCard key={s.inicio} clienteId={clienteId} ambiente={ambiente} modelo={m} s={s} onPronto={onPronto} onPular={onPular} />
        ))}
      {feitas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ padding: 0, fontSize: 12 }} onClick={() => setHistorico(!historico)}>
            {historico ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />} Semanas anteriores ({feitas.length})
          </button>
          {historico && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 4 }}>
              <tbody>{feitas.map((s) => (
                <tr key={s.inicio}>
                  <td style={td}>{curta(s.inicio)} a {dataBR(s.fim)}</td>
                  <td style={td}>{s.situacao === 'emitida' ? `NFS-e nº ${s.nota?.numero || '?'}` : s.situacao === 'pulada' ? 'Sem serviço' : 'Em emissão — confira no lote'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{s.nota ? brl(s.nota.valor) : ''}</td>
                  <td style={td}>{s.situacao === 'pulada' && <button className="btn btn-ghost" style={{ padding: 0, fontSize: 11 }} onClick={() => onPular(s, true)}>desfazer</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
