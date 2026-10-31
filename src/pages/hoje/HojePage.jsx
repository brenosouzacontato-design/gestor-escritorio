// Tela "Hoje" — a primeira coisa que o tablet mostra (start_url do
// gestor.webmanifest). Junta numa tela só o que precisa de você agora:
// tarefas de hoje/atrasadas, obrigações vencendo, agenda do dia, robôs de
// guia esperando captcha/erro e comprovantes a conferir — mais a captura
// rápida pela câmera (vai pra tela Documentos, onde a IA identifica a empresa).
import { useState, useEffect, useMemo } from 'react'
import {
  SunIcon, CameraIcon, CheckIcon, CalendarDaysIcon, ClipboardCheckIcon, BotIcon,
  CircleDollarSignIcon, ChevronRightIcon, PlusIcon, DownloadIcon, LayersIcon, CheckSquareIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { DeptChip, PriDot, fmtDate } from '../../components/shared'
import { listarEventos } from '../agenda/agendaApi'
import { listarParcelamentos } from '../parcelamentos/parcelamentosApi'
import { contarComprovantesPendentes } from '../pagamentos/pagamentosApi'

// datas em 'YYYY-MM-DD' no fuso local (comparar string com string evita o
// problema de new Date('2026-10-30') virar 29/10 às 21h em UTC-3)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DIAS_OBRIGACOES = 7

const STATUS_ROBO = {
  aguardando_captcha:  { label: 'Aguardando captcha', cls: 'badge-warn' },
  erro:                { label: 'Erro na busca',      cls: 'badge-err' },
  nao_permite_emissao: { label: 'Não permite emissão', cls: 'badge-err' },
}

export default function HojePage({ onNavigate, onAddTarefa, onCapturar }) {
  const clientes     = useStore(s => s.clientes)
  const tarefas      = useStore(s => s.tarefas)
  const obrigacoes   = useStore(s => s.obrigacoes || [])
  const toggleTarefa = useStore(s => s.toggleTarefa)

  const hoje = iso(new Date())
  const limite = iso(new Date(Date.now() + DIAS_OBRIGACOES * 864e5))

  // dados que não ficam no store — cada bloco falha sozinho (tabela que
  // ainda não existe num ambiente não derruba a tela)
  const [eventos, setEventos] = useState(null)
  const [robos, setRobos] = useState(null)
  const [comprovantes, setComprovantes] = useState(null)
  useEffect(() => {
    listarEventos({ de: hoje, ate: hoje }).then(l => setEventos((l || []).filter(e => !e.cancelado))).catch(() => setEventos([]))
    listarParcelamentos()
      .then(l => setRobos((l || []).filter(p => p.busca_automatica && STATUS_ROBO[p.ultima_busca_status])))
      .catch(() => setRobos([]))
    contarComprovantesPendentes().then(setComprovantes).catch(() => setComprovantes(0))
  }, [hoje])

  // botão "Instalar app" (o main.jsx guarda o convite do Chrome)
  const [instalavel, setInstalavel] = useState(() => !!window.__convitePwa)
  useEffect(() => {
    const on = () => setInstalavel(true)
    window.addEventListener('gestor-instalavel', on)
    return () => window.removeEventListener('gestor-instalavel', on)
  }, [])
  const instalar = async () => {
    const convite = window.__convitePwa
    if (!convite) return
    convite.prompt()
    await convite.userChoice.catch(() => {})
    window.__convitePwa = null
    setInstalavel(false)
  }

  const tarefasHoje = useMemo(() => tarefas
    .filter(t => !t.concluida && t.vencimento && t.vencimento.slice(0, 10) <= hoje)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento)), [tarefas, hoje])
  const tarefasAlta = useMemo(() => tarefas
    .filter(t => !t.concluida && t.prioridade === 'alta' && !(t.vencimento && t.vencimento.slice(0, 10) <= hoje))
    .slice(0, 5), [tarefas, hoje])

  const nomeCliente = useMemo(() => Object.fromEntries(clientes.map(c => [c.id, c.nome])), [clientes])
  const obrigProximas = useMemo(() => obrigacoes
    .filter(o => (o.status === 'pendente' || o.status === 'vencido') && o.vencimento && o.vencimento.slice(0, 10) <= limite)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento)), [obrigacoes, limite])
  const obrigVencidas = obrigProximas.filter(o => o.vencimento.slice(0, 10) < hoje)
  const obrigAVencer = obrigProximas.filter(o => o.vencimento.slice(0, 10) >= hoje)

  const dataExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const tudoEmDia = tarefasHoje.length === 0 && obrigVencidas.length === 0 && (robos?.length ?? 0) === 0 && !comprovantes

  return (
    <div className="page hoje-page">
      <div className="hoje-topo">
        <div>
          <h2 className="hoje-titulo"><SunIcon size={20} /> Hoje</h2>
          <p className="hoje-data">{dataExtenso}</p>
        </div>
        <div className="hoje-acoes">
          {instalavel && (
            <button type="button" className="btn" onClick={instalar}><DownloadIcon size={16} /> Instalar app</button>
          )}
          <button type="button" className="btn" onClick={() => onAddTarefa()}><PlusIcon size={16} /> Tarefa</button>
          <label className="btn btn-accent">
            <CameraIcon size={16} /> Fotografar
            <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }}
              onChange={e => { const a = Array.from(e.target.files || []); e.target.value = ''; if (a.length) onCapturar(a) }} />
          </label>
        </div>
      </div>

      {/* contadores — tocar leva pra tela de cada assunto */}
      <div className="hoje-contadores">
        <Contador Icon={CheckSquareIcon} n={tarefasHoje.length} label="tarefas p/ hoje" tom={tarefasHoje.length ? 'warn' : 'ok'} onClick={() => onNavigate('tarefas')} />
        <Contador Icon={ClipboardCheckIcon} n={obrigVencidas.length} label="obrig. vencidas" tom={obrigVencidas.length ? 'err' : 'ok'} onClick={() => onNavigate('empresas')} />
        <Contador Icon={BotIcon} n={robos?.length} label="robôs esperando" tom={robos?.length ? 'warn' : 'ok'} onClick={() => onNavigate('parcelamentos')} />
        <Contador Icon={CircleDollarSignIcon} n={comprovantes} label="comprov. a conferir" tom={comprovantes ? 'warn' : 'ok'} onClick={() => onNavigate('pagamentos')} />
      </div>

      {tudoEmDia && (
        <div className="notice notice-ok" style={{ marginBottom: 16 }}><CheckIcon size={16} /> Nada atrasado nem esperando você. Bom trabalho!</div>
      )}

      <div className="hoje-grade">
        <Bloco titulo="Tarefas de hoje e atrasadas" Icon={CheckSquareIcon} qtd={tarefasHoje.length} onVerTudo={() => onNavigate('tarefas')}>
          {tarefasHoje.length === 0 && <Vazio>Nenhuma tarefa vencendo hoje.</Vazio>}
          {tarefasHoje.slice(0, 8).map(t => <LinhaTarefa key={t.id} t={t} hoje={hoje} onToggle={() => toggleTarefa(t.id)} />)}
          {tarefasAlta.length > 0 && <>
            <div className="hoje-subtitulo">Prioridade alta (sem prazo hoje)</div>
            {tarefasAlta.map(t => <LinhaTarefa key={t.id} t={t} hoje={hoje} onToggle={() => toggleTarefa(t.id)} />)}
          </>}
        </Bloco>

        <Bloco titulo={`Obrigações — vencidas e próximos ${DIAS_OBRIGACOES} dias`} Icon={ClipboardCheckIcon} qtd={obrigProximas.length} onVerTudo={() => onNavigate('empresas')}>
          {obrigProximas.length === 0 && <Vazio>Nada vencendo na semana.</Vazio>}
          {[...obrigVencidas, ...obrigAVencer].slice(0, 10).map(o => {
            const venc = o.vencimento.slice(0, 10)
            const atrasada = venc < hoje
            return (
              <button type="button" key={o.id} className="hoje-linha" onClick={() => onNavigate('empresas')}>
                <span className={`hoje-marca ${atrasada ? 'err' : venc === hoje ? 'warn' : ''}`} />
                <span className="hoje-linha-textos">
                  <span className="hoje-linha-nome">{o.tipo} · {nomeCliente[o.cliente_id] || '—'}</span>
                  <span className="hoje-linha-desc">{atrasada ? 'Venceu em ' : venc === hoje ? 'Vence hoje · ' : 'Vence em '}{fmtDate(venc)}</span>
                </span>
                <ChevronRightIcon size={16} color="var(--text3)" />
              </button>
            )
          })}
          {obrigProximas.length > 10 && <div className="hoje-mais">+{obrigProximas.length - 10} no Fechamento</div>}
        </Bloco>

        <Bloco titulo="Agenda de hoje" Icon={CalendarDaysIcon} qtd={eventos?.length} onVerTudo={() => onNavigate('agenda')}>
          {eventos === null && <div className="center"><div className="spinner" /></div>}
          {eventos?.length === 0 && <Vazio>Nenhuma reunião hoje.</Vazio>}
          {eventos?.map(ev => (
            <div key={ev.id} className="hoje-linha estatica">
              <span className="hoje-hora">{ev.hora ? ev.hora.slice(0, 5) : 'Dia'}</span>
              <span className="hoje-linha-textos">
                <span className="hoje-linha-nome">{ev.titulo}</span>
                <span className="hoje-linha-desc">{[ev.clientes?.nome, ev.local].filter(Boolean).join(' · ') || '—'}</span>
              </span>
            </div>
          ))}
        </Bloco>

        <Bloco titulo="Robôs de guia esperando você" Icon={BotIcon} qtd={robos?.length} onVerTudo={() => onNavigate('parcelamentos')}>
          {robos === null && <div className="center"><div className="spinner" /></div>}
          {robos?.length === 0 && <Vazio>Nenhum robô travado.</Vazio>}
          {robos?.map(p => {
            const st = STATUS_ROBO[p.ultima_busca_status]
            return (
              <button type="button" key={p.id} className="hoje-linha" onClick={() => onNavigate('parcelamentos')}>
                <LayersIcon size={16} color="var(--text3)" style={{ flexShrink: 0 }} />
                <span className="hoje-linha-textos">
                  <span className="hoje-linha-nome">{p.clientes?.nome || p.nome_devedor || '—'} · {p.origem}{p.conta ? ` ${p.conta}` : ''}</span>
                  <span className="hoje-linha-desc">{p.ultima_busca_msg || (p.ultima_busca_em ? `Última tentativa ${new Date(p.ultima_busca_em).toLocaleString('pt-BR')}` : '')}</span>
                </span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </button>
            )
          })}
        </Bloco>
      </div>
    </div>
  )
}

function Contador({ Icon, n, label, tom, onClick }) {
  return (
    <button type="button" className={`hoje-contador ${tom}`} onClick={onClick}>
      <Icon size={18} />
      <span className="hoje-contador-n">{n ?? '…'}</span>
      <span className="hoje-contador-label">{label}</span>
    </button>
  )
}

function Bloco({ titulo, Icon, qtd, onVerTudo, children }) {
  return (
    <section className="card hoje-bloco">
      <div className="hoje-bloco-topo">
        <span className="hoje-bloco-titulo"><Icon size={15} /> {titulo}{qtd ? <span className="hoje-bloco-qtd">{qtd}</span> : null}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVerTudo}>Ver tudo <ChevronRightIcon size={14} /></button>
      </div>
      {children}
    </section>
  )
}

function Vazio({ children }) {
  return <p className="hoje-vazio">{children}</p>
}

function LinhaTarefa({ t, hoje, onToggle }) {
  const venc = t.vencimento ? t.vencimento.slice(0, 10) : null
  const atrasada = venc && venc < hoje
  return (
    <div className="hoje-linha estatica">
      <button type="button" className="hoje-check" onClick={onToggle} aria-label={`Concluir ${t.titulo}`}>
        <CheckIcon size={16} />
      </button>
      <span className="hoje-linha-textos">
        <span className="hoje-linha-nome"><PriDot pri={t.prioridade} /> {t.titulo}</span>
        <span className="hoje-linha-desc" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {t.clientes?.nome && <span>{t.clientes.nome}</span>}
          <DeptChip dept={t.departamento} />
          {venc && <span style={{ color: atrasada ? 'var(--danger)' : 'var(--text2)' }}>{atrasada ? '⚠ ' : ''}{venc === hoje ? 'Hoje' : fmtDate(venc)}</span>}
          {t.origem === 'whatsapp' && <span className="badge badge-info" style={{ fontSize: 10 }}>WA</span>}
        </span>
      </span>
    </div>
  )
}
