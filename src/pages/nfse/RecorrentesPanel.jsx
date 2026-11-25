import { useEffect, useState } from 'react'
import { RepeatIcon, PlusIcon, PencilIcon, Trash2Icon, ChevronDownIcon, ChevronRightIcon, FilePlusIcon, AlarmClockIcon } from 'lucide-react'
import { useToast } from '../../components/shared'
import { chamarNfse } from './nfseApi'
import NotaRecorrenteCard, { descricaoNaData } from './NotaRecorrenteCard'
import AgendarEmissao, { ListaAgendamentos } from './AgendarEmissao'

// Notas recorrentes semanais ou mensais: mesmo tomador (CNPJ ou CPF), mesma descrição e serviço todo
// período; só o valor muda (ex.: ponto de coleta que emite toda semana para a Shopee; contrato faturado
// todo mês). Cada período (semana de segunda a domingo, ou mês do dia 1º ao último), inclusive o em
// andamento, aparece "a emitir" como um cartão da nota (NotaRecorrenteCard):
// o escritório confere, ajusta se precisar, digita o valor e a nota é emitida na hora.
// "Sem serviço" tira o período de "a emitir"; "Nota avulsa" emite uma nota extra com os dados do
// modelo, em qualquer data, sem contar como a nota do período.
// "Agendar" marca dia e hora para a nota sair sozinha (robô nfse-agendamentos-cron) e ir no WhatsApp
// da empresa (AgendarEmissao.jsx); também dá para agendar pelo grupo Documentos ("agendar nfse ...").
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
const VAZIO = { nome: '', cpf: '', endereco: '', cep: '', descricao: 'Serviços prestados no período de {inicio} a {fim}', valor: '', inicio: '', periodicidade: 'semanal' }
const mesBR = (iso) => dataBR(iso).slice(3)

export default function RecorrentesPanel({ clienteId, ambiente, onEmitida }) {
  const { show } = useToast()
  const [lista, setLista] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [avisoAgendamento, setAvisoAgendamento] = useState(null)
  const [form, setForm] = useState(null) // modelo sendo criado/editado
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    try {
      const r = await chamarNfse('recorrentes_listar', { cliente_id: clienteId })
      setLista(r.recorrentes)
      setAviso(r.aviso || null)
      setAvisoAgendamento(r.aviso_agendamento || null)
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
    try {
      await chamarNfse('recorrente_pular', { cliente_id: clienteId, id: m.id, semana: s.inicio, desfazer })
      await carregar()
      const periodo = m.periodicidade === 'mensal' ? 'Mês' : 'Semana'
      show(desfazer ? `${periodo} voltou para "a emitir"` : `${periodo} marcada sem serviço (desfaz em "${m.periodicidade === 'mensal' ? 'Meses' : 'Semanas'} anteriores")`)
    } catch (e) { show(e.message) }
  }

  // a emissão é feita no cartão (NotaRecorrenteCard); aqui só recarrega depois
  async function emitida({ ok, texto }) {
    if (ok) show(texto)
    await carregar()
    onEmitida?.()
  }

  const aEmitir = (lista || []).reduce((n, m) => n + m.semanas.filter((s) => s.situacao === 'a_emitir').length, 0)
  const periodicidades = new Set((lista || []).map((m) => m.periodicidade))
  const titulo = periodicidades.size === 1 ? (periodicidades.has('mensal') ? ' (mensais)' : ' (semanais)') : ''

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <RepeatIcon size={16} /><b style={{ fontSize: 14 }}>Notas recorrentes{titulo}</b>
        {aEmitir > 0 && <span style={{ background: 'var(--warn-dim)', color: 'var(--warn)', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{aEmitir} nota(s) a emitir</span>}
        {!form && !aviso && <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setForm({ ...VAZIO })}><PlusIcon size={14} /> Novo modelo</button>}
      </div>
      <p style={{ ...suave, margin: '6px 0 10px' }}>
        Mesmo tomador e mesma descrição toda semana (segunda a domingo) ou todo mês; só o valor muda. O período atual já aparece aqui:
        confira a nota, ajuste se precisar (só aquela nota), digite o valor e emita.
      </p>
      {aviso && <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, background: 'var(--warn-dim)', color: 'var(--warn)' }}>{aviso}</div>}

      {form && <FormModelo form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setForm(null)} ocupado={ocupado} />}

      {lista === null && <div style={suave}>Carregando…</div>}
      {lista?.length === 0 && !form && !aviso && <div style={suave}>Nenhum modelo. Use “Novo modelo” para cadastrar (ex.: Shopee, toda semana; contrato de serviço, todo mês).</div>}
      {(lista || []).map((m) => (
        <Modelo key={m.id} m={m} ambiente={ambiente} onEditar={() => setForm({ ...VAZIO, ...m, valor: valorBR(m.valor) })}
          onExcluir={() => excluir(m)} onPular={(s, d) => pular(m, s, d)} clienteId={clienteId} onPronto={emitida}
          avisoAgendamento={avisoAgendamento} onAgendado={async (texto) => { if (texto) show(texto); await carregar() }} onErro={show} />
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
        <div><label className="form-label">Periodicidade</label>
          <select {...campo('periodicidade')}><option value="semanal">Semanal (segunda a domingo)</option><option value="mensal">Mensal (dia 1º ao último dia)</option></select></div>
        <div><label className="form-label">{form.periodicidade === 'mensal' ? 'Primeiro mês (qualquer dia dele)' : 'Primeira semana (qualquer dia dela)'}</label><input type="date" {...campo('inicio')} /></div>
        <div><label className="form-label">Valor sugerido (opcional)</label><input {...campo('valor')} placeholder="0,00" /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label className="form-label">Descrição da nota — {'{inicio}'} e {'{fim}'} viram as datas {form.periodicidade === 'mensal' ? <>do mês e {'{mes}'} vira MM/AAAA</> : 'da semana'}</label>
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

// Hoje no fuso local, em AAAA-MM-DD
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function Modelo({ m, ambiente, clienteId, onEditar, onExcluir, onPular, onPronto, avisoAgendamento, onAgendado, onErro }) {
  const [historico, setHistorico] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [avulsa, setAvulsa] = useState(null) // { data, descricao } da nota avulsa aberta
  const [agendando, setAgendando] = useState(false)
  const mensal = m.periodicidade === 'mensal'
  const pendentes = m.semanas.filter((s) => s.situacao === 'a_emitir').reverse()
  const feitas = m.semanas.filter((s) => s.situacao !== 'a_emitir').reverse()
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b>{m.nome}</b><span style={suave}>{docFmt(m.cpf)} · {mensal ? 'mensal' : 'semanal'} · desde {mensal ? mesBR(m.inicio) : dataBR(m.inicio)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" title="Emitir uma nota extra com os dados deste modelo (não conta como a nota da semana)"
            onClick={() => { const data = hojeIso(); setAvulsa(avulsa ? null : { data, descricao: descricaoNaData(m, data) }) }}>
            <FilePlusIcon size={13} /> Nota avulsa</button>
          <button className="btn btn-ghost btn-sm" disabled={!m.ativo}
            title={avisoAgendamento || 'Marcar dia e hora para a nota sair sozinha e ir no WhatsApp da empresa'}
            onClick={() => { if (avisoAgendamento) onErro?.(avisoAgendamento); else setAgendando(!agendando) }}>
            <AlarmClockIcon size={13} /> Agendar</button>
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
      {avulsa && (
        <NotaRecorrenteCard key={`avulsa-${avulsa.data}`} avulsa clienteId={clienteId} ambiente={ambiente} modelo={m} s={avulsa}
          onFechar={() => setAvulsa(null)}
          onPronto={(r) => { if (r.ok) setAvulsa(null); onPronto(r) }} />
      )}
      {agendando && (
        <AgendarEmissao clienteId={clienteId} ambiente={ambiente} modelo={m} onFechar={() => setAgendando(false)}
          onPronto={(texto) => { setAgendando(false); onAgendado?.(texto) }} />
      )}
      <ListaAgendamentos clienteId={clienteId} lista={m.agendamentos} onMudou={() => onAgendado?.('Agendamento cancelado')} onErro={onErro} />
      {pendentes.length === 0
        ? <div style={{ ...suave, marginTop: 6 }}>{mensal ? 'Nenhum mês a emitir. O próximo aparece no dia 1º.' : 'Nenhuma semana a emitir. A próxima aparece na segunda-feira.'}</div>
        : pendentes.map((s) => (
          <NotaRecorrenteCard key={s.inicio} clienteId={clienteId} ambiente={ambiente} modelo={m} s={s} onPronto={onPronto} onPular={onPular} />
        ))}
      {feitas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ padding: 0, fontSize: 12 }} onClick={() => setHistorico(!historico)}>
            {historico ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />} {mensal ? 'Meses anteriores' : 'Semanas anteriores'} ({feitas.length})
          </button>
          {historico && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 4 }}>
              <tbody>{feitas.map((s) => (
                <tr key={s.inicio}>
                  <td style={td}>{mensal ? mesBR(s.inicio) : `${curta(s.inicio)} a ${dataBR(s.fim)}`}</td>
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
