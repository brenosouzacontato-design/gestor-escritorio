// Agendamentos NFS-e (Documentos → Notas fiscais): todas as emissões agendadas, de todas as empresas —
// notas recorrentes (Emitir NFS-e) e modelos MEI (NFS-e MEI), feitas pelo gestor ou pelo WhatsApp.
// Mostra o que vai sair, o resultado dos já executados e deixa cancelar o que ainda não saiu.
// Servidor: nfse.js → agendamentos_todos; cancelar: nfse.js (agendamento_cancelar) ou nfse-mei.js
// (cancelar_agendamento), conforme o tipo. Regras em netlify/functions/lib/nfse/agendamentos.js.
import { useEffect, useMemo, useState } from 'react'
import { AlarmClockIcon, RefreshCwIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../components/shared'
import { chamarNfse } from './nfseApi'
import { quandoBR } from './AgendarEmissao'

async function chamarMei(acao, dados) {
  const { data } = await supabase.auth.getSession()
  const token = data.session && data.session.access_token
  if (!token) throw new Error('Sessão expirada. Entre de novo no gestor.')
  const r = await fetch('/.netlify/functions/nfse-mei', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ acao, ...dados }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`)
  return corpo
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 14 }
const suave = { color: 'var(--text3)', fontSize: 12 }
const td = { padding: '7px 8px', borderTop: '1px solid var(--border)', verticalAlign: 'top', fontSize: 12 }
const th = { ...td, borderTop: 'none', textAlign: 'left', color: 'var(--text3)', fontWeight: 600, fontSize: 11 }
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')

const SITUACAO = {
  agendada: ['Agendada', 'var(--accent)'],
  processando: ['Emitindo…', 'var(--warn)'],
  emitida: ['Saiu', 'var(--ok, #16a34a)'],
  erro: ['Não saiu', 'var(--danger)'],
  cancelada: ['Cancelada', 'var(--text3)'],
}
const FILTROS = [
  ['pendentes', 'A sair', (a) => ['agendada', 'processando'].includes(a.situacao)],
  ['feitos', 'Executados', (a) => ['emitida', 'erro'].includes(a.situacao)],
  ['erros', 'Não saíram', (a) => a.situacao === 'erro'],
  ['todos', 'Todos', () => true],
]
const tipoTexto = (a) => (a.tipo === 'mei' ? 'MEI' : a.tipo === 'avulsa' ? 'Avulsa' : 'Recorrente')

export default function NfseAgendamentosPage() {
  const { show } = useToast()
  const [lista, setLista] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [filtro, setFiltro] = useState('pendentes')
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [cancelando, setCancelando] = useState(null)

  async function carregar() {
    setCarregando(true)
    try {
      const r = await chamarNfse('agendamentos_todos', { dias })
      setLista(r.agendamentos || []); setAviso(r.aviso || null)
    } catch (e) { show(e.message) } finally { setCarregando(false) }
  }
  useEffect(() => { carregar() }, [dias])

  async function cancelar(a) {
    if (!window.confirm(`Cancelar a emissão agendada para ${quandoBR(a.executar_em)} (${a.empresa_nome} → ${a.tomador_nome}, ${brl(a.valor)})?`)) return
    setCancelando(a.id)
    try {
      if (a.tipo === 'mei') await chamarMei('cancelar_agendamento', { cliente_id: a.cliente_id, id: a.id })
      else await chamarNfse('agendamento_cancelar', { cliente_id: a.cliente_id, id: a.id })
      show('Agendamento cancelado'); await carregar()
    } catch (e) { show(e.message) } finally { setCancelando(null) }
  }

  const contagem = useMemo(() => Object.fromEntries(FILTROS.map(([id, , f]) => [id, (lista || []).filter(f).length])), [lista])
  const visiveis = useMemo(() => {
    const f = (FILTROS.find(([id]) => id === filtro) || FILTROS[0])[2]
    const t = busca.trim().toLowerCase()
    const l = (lista || []).filter(f).filter((a) => !t || `${a.empresa_nome} ${a.tomador_nome} ${a.descricao || ''}`.toLowerCase().includes(t))
    // a sair: o próximo primeiro; executados: o mais recente primeiro
    return filtro === 'pendentes' ? l : [...l].reverse()
  }, [lista, filtro, busca])

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <AlarmClockIcon size={20} />
        <h2 style={{ margin: 0, fontSize: 20 }}>Agendamentos NFS-e</h2>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} disabled={carregando} onClick={carregar}><RefreshCwIcon size={14} /> Atualizar</button>
      </div>
      <p style={{ ...suave, marginTop: 0 }}>
        Emissões agendadas de todas as empresas: notas recorrentes (Emitir NFS-e) e modelos MEI (NFS-e MEI), feitas pelo gestor ou pelo WhatsApp.
        O robô confere a cada 5 minutos. Para agendar, use o botão Agendar no modelo ou o grupo ANALISTA JR.
      </p>
      {aviso && <div style={{ ...card, color: 'var(--warn)' }}>⚠️ {aviso}</div>}

      <div style={card}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          {FILTROS.map(([id, rotulo]) => (
            <button key={id} className={`btn ${filtro === id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setFiltro(id)}>
              {rotulo}{lista ? ` (${contagem[id]})` : ''}
            </button>
          ))}
          <input style={{ marginLeft: 'auto', width: 240 }} placeholder="Buscar empresa, tomador ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} title="Até quando mostrar os já executados ou cancelados">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Último ano</option>
          </select>
        </div>

        {!lista ? <div style={suave}>Carregando…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Emitir em</th><th style={th}>Empresa</th><th style={th}>Tomador / modelo</th><th style={th}>Tipo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={th}>Serviço / competência</th><th style={th}>Situação</th><th style={th} />
                </tr>
              </thead>
              <tbody>
                {visiveis.length === 0 && (
                  <tr><td colSpan={8} style={{ ...td, ...suave, textAlign: 'center', padding: 16 }}>Nenhum agendamento aqui.</td></tr>
                )}
                {visiveis.map((a) => {
                  const [txt, cor] = SITUACAO[a.situacao] || [a.situacao, 'var(--text3)']
                  return (
                    <tr key={a.id}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}><b>{quandoBR(a.executar_em)}</b></td>
                      <td style={td}>{a.empresa_nome}</td>
                      <td style={td}>
                        {a.tomador_nome}
                        {a.descricao && <div style={suave}>📝 {a.descricao.slice(0, 120)}</div>}
                      </td>
                      <td style={td}>
                        {tipoTexto(a)}
                        {a.ambiente !== 'producao' && <div style={{ ...suave, color: 'var(--warn)' }}>homologação</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{brl(a.valor)}</td>
                      <td style={td}>{dataBR(a.data_servico)}</td>
                      <td style={td}>
                        <span style={{ color: cor, fontWeight: 600 }}>{txt}</span>
                        {a.situacao !== 'agendada' && (a.mensagem || a.envio) && <div style={{ ...suave, maxWidth: 320 }}>{[a.mensagem, a.envio].filter(Boolean).join(' · ')}</div>}
                        {a.criado_por && <div style={suave}>por {a.criado_por}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {a.situacao === 'agendada' && (
                          <button className="btn btn-ghost btn-sm" disabled={cancelando === a.id} onClick={() => cancelar(a)}>
                            {cancelando === a.id ? 'Cancelando…' : 'Cancelar'}
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
      </div>
    </div>
  )
}
