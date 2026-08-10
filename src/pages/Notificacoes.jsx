import { useState, useEffect, useMemo } from 'react'
import { BellIcon, SearchIcon, CheckIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon, ClipboardListIcon, CheckSquareIcon } from 'lucide-react'
import { useToast } from '../components/shared'
import { listarTodosLembretes, atualizarLembrete, marcarLembreteEnviado, excluirLembrete } from './andamento/lembretesApi'

const COLUNAS = [
  { id: 'clienteNome', label: 'Cliente' },
  { id: 'itemTitulo', label: 'Item' },
  { id: 'dataHora', label: 'Data/Hora' },
  { id: 'enviado', label: 'Status' },
]

function paraInputDatetime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtDataHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// Lista tipo "Microsoft Lists" com todos os lembretes (WhatsApp) de todos
// os clientes numa tabela só — hoje a única forma de ver/editar um lembrete
// era abrindo a obrigação/tarefa específica dentro do modal de Empresas,
// um de cada vez. Aqui dá pra editar data/hora e mensagem, marcar
// enviado/pendente e excluir direto na linha, sem sair da tela.
export default function Notificacoes() {
  const [lembretes, setLembretes] = useState(null) // null = carregando
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [statusFiltro, setStatusFiltro] = useState('todos') // todos | pendente | enviado
  const [ordenacao, setOrdenacao] = useState({ campo: 'dataHora', dir: 'desc' })
  const { show } = useToast()

  const carregar = () => {
    listarTodosLembretes().then(setLembretes).catch((e) => setErro(e.message))
  }
  useEffect(() => { carregar() }, [])

  const filtrados = useMemo(() => {
    if (!lembretes) return []
    let lista = lembretes
    if (statusFiltro !== 'todos') lista = lista.filter((l) => (statusFiltro === 'enviado' ? l.enviado : !l.enviado))
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase()
      lista = lista.filter((l) => l.clienteNome.toLowerCase().includes(termo) || l.itemTitulo.toLowerCase().includes(termo))
    }
    const { campo, dir } = ordenacao
    const mult = dir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      const va = a[campo], vb = b[campo]
      if (campo === 'enviado') return (va === vb ? 0 : va ? 1 : -1) * mult
      return String(va ?? '').localeCompare(String(vb ?? '')) * mult
    })
  }, [lembretes, busca, statusFiltro, ordenacao])

  const alternarOrdenacao = (campo) => {
    setOrdenacao((o) => (o.campo === campo ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' }))
  }

  const salvarCampo = async (id, campo, valor) => {
    const alvo = lembretes.find((l) => l.id === id)
    if (!alvo) return
    const novo = { dataHora: alvo.dataHora, mensagem: alvo.mensagem, [campo]: valor }
    setLembretes((prev) => prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)))
    try {
      await atualizarLembrete(id, novo)
    } catch (e) {
      show?.('Erro ao salvar: ' + e.message)
      carregar()
    }
  }

  const alternarEnviado = async (l) => {
    setLembretes((prev) => prev.map((x) => (x.id === l.id ? { ...x, enviado: !l.enviado } : x)))
    try {
      await marcarLembreteEnviado(l.id, !l.enviado)
    } catch (e) {
      show?.('Erro ao atualizar status: ' + e.message)
      carregar()
    }
  }

  const excluir = async (l) => {
    if (!window.confirm(`Excluir o lembrete de "${l.itemTitulo}"?`)) return
    setLembretes((prev) => prev.filter((x) => x.id !== l.id))
    try {
      await excluirLembrete(l.id)
      show?.('Lembrete excluído')
    } catch (e) {
      show?.('Erro ao excluir: ' + e.message)
      carregar()
    }
  }

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BellIcon size={18} /> Notificações
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Todos os lembretes (WhatsApp) de obrigações e tarefas, de todos os clientes, num lugar só.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <SearchIcon size={14} color="var(--text3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por cliente ou item..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12.5 }} />
        </div>
        <div className="tabs" style={{ maxWidth: 300 }}>
          <button className={`tab-btn ${statusFiltro === 'todos' ? 'active' : ''}`} onClick={() => setStatusFiltro('todos')}>Todos</button>
          <button className={`tab-btn ${statusFiltro === 'pendente' ? 'active' : ''}`} onClick={() => setStatusFiltro('pendente')}>Pendentes</button>
          <button className={`tab-btn ${statusFiltro === 'enviado' ? 'active' : ''}`} onClick={() => setStatusFiltro('enviado')}>Enviados</button>
        </div>
      </div>

      {erro && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{erro}</p>}
      {!erro && !lembretes && <p style={{ color: 'var(--text3)', fontSize: 13 }}>Carregando...</p>}
      {lembretes && filtrados.length === 0 && (
        <div className="empty">
          <p>🔔</p>
          Nenhum lembrete encontrado.
        </div>
      )}

      {lembretes && filtrados.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {COLUNAS.map((c) => (
                  <th key={c.id} onClick={() => alternarOrdenacao(c.id)}
                    style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '.03em', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {c.label}
                      {ordenacao.campo === c.id && (ordenacao.dir === 'asc' ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                    </span>
                  </th>
                ))}
                <th style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>Mensagem</th>
                <th style={{ padding: '9px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--text1)', fontWeight: 500, whiteSpace: 'nowrap' }}>{l.clienteNome}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text2)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {l.tipo === 'obrigacao' ? <ClipboardListIcon size={12} color="var(--text3)" /> : <CheckSquareIcon size={12} color="var(--text3)" />}
                      {l.itemTitulo}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <input type="datetime-local" defaultValue={paraInputDatetime(l.dataHora)}
                      onBlur={(e) => { if (e.target.value) salvarCampo(l.id, 'dataHora', new Date(e.target.value).toISOString()) }}
                      style={{ fontSize: 12, padding: '4px 6px', border: '1px solid transparent', background: 'transparent' }}
                      onFocus={(e) => { e.target.style.border = '1px solid var(--border)'; e.target.style.background = 'var(--bg)' }} />
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button onClick={() => alternarEnviado(l)}
                      className={`badge ${l.enviado ? 'badge-ok' : 'badge-warn'}`} style={{ cursor: 'pointer', border: 'none' }}
                      title={l.enviado ? 'Marcar como pendente' : 'Marcar como enviado'}>
                      {l.enviado ? 'Enviado' : 'Pendente'}
                    </button>
                  </td>
                  <td style={{ padding: '8px 12px', minWidth: 160 }}>
                    <input type="text" defaultValue={l.mensagem || ''} placeholder="Mensagem padrão"
                      onBlur={(e) => salvarCampo(l.id, 'mensagem', e.target.value)}
                      style={{ width: '100%', fontSize: 12, padding: '4px 6px', border: '1px solid transparent', background: 'transparent' }}
                      onFocus={(e) => { e.target.style.border = '1px solid var(--border)'; e.target.style.background = 'var(--bg)' }} />
                  </td>
                  <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => alternarEnviado(l)} title={l.enviado ? 'Marcar como pendente' : 'Marcar como enviado'}>
                      <CheckIcon size={13} />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => excluir(l)} title="Excluir">
                      <Trash2Icon size={13} color="var(--danger)" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
