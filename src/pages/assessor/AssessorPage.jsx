import { useEffect, useMemo, useState } from 'react'
import { MessageCircleIcon, SparklesIcon, AlertOctagonIcon, AlertTriangleIcon, LightbulbIcon, ExternalLinkIcon, ChevronDownIcon, ChevronRightIcon, ScaleIcon, NewspaperIcon, RouteIcon, ActivityIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useToast } from '../../components/shared'
import { montarAssessor, cardsDoCliente, resumoAnonimo } from '../../lib/assessor'
import { dataBR } from '../../lib/assessor/datas'
import { carregarDadosAssessor, pedirResumoAssessor } from './assessorApi'
import ChatAssessor from './ChatAssessor'

const NIVEL = {
  urgente: { rotulo: 'Urgente', cor: 'var(--danger)', Icone: AlertOctagonIcon },
  atencao: { rotulo: 'Atenção', cor: 'var(--warn)', Icone: AlertTriangleIcon },
  dica: { rotulo: 'Dica', cor: 'var(--accent)', Icone: LightbulbIcon },
}
const ABAS = [
  { id: 'tudo', rotulo: 'Tudo' },
  { id: 'chat', rotulo: 'Pergunte (IA)', Icone: MessageCircleIcon },
  { id: 'reforma', rotulo: 'Reforma Tributária', Icone: ScaleIcon },
  { id: 'uso', rotulo: 'Uso do sistema', Icone: ActivityIcon },
  { id: 'dicas', rotulo: 'Dicas e fluxos', Icone: RouteIcon },
  { id: 'noticias', rotulo: 'Notícias', Icone: NewspaperIcon },
]

// Assessor: lembretes da Reforma por perfil de cliente, feedback de uso a
// partir dos dados reais, dicas/fluxos e notícias curadas. A lógica fica em
// src/lib/assessor (testada em Node); aqui só busca os dados e desenha.
export default function AssessorPage({ onNavigate }) {
  const { show } = useToast()
  const clientes = useStore((s) => s.clientes)
  const tarefas = useStore((s) => s.tarefas)
  const [dados, setDados] = useState(null)
  const [aba, setAba] = useState('tudo')
  const [clienteId, setClienteId] = useState('')
  const [resumo, setResumo] = useState(null)
  const [gerando, setGerando] = useState(false)

  useEffect(() => {
    let vivo = true
    carregarDadosAssessor().then((d) => { if (vivo) setDados(d) })
    return () => { vivo = false }
  }, [])

  const assessor = useMemo(() => dados && montarAssessor({ ...dados, clientes, tarefas }), [dados, clientes, tarefas])

  if (!assessor) return <div className="center"><div className="spinner" /></div>

  const cards = cardsDoCliente(assessor.cards, clienteId)
  const contagem = (n) => cards.filter((c) => c.nivel === n).length
  const visiveis = cards.filter((c) => aba === 'tudo' || c.tipo === aba)

  const gerarResumo = async () => {
    setGerando(true)
    try {
      setResumo(await pedirResumoAssessor(resumoAnonimo(assessor)))
    } catch (e) {
      show(e.message)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Assessor</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>
            {assessor.etapa.titulo} · {['urgente', 'atencao', 'dica'].map((n) => `${contagem(n)} ${NIVEL[n].rotulo.toLowerCase()}`).join(' · ')}
          </div>
        </div>
        <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">Todos os clientes</option>
          {assessor.perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <button className="btn btn-accent" onClick={gerarResumo} disabled={gerando}
          title="Envia só números e títulos dos alertas ao Claude (sem nomes, CPFs ou CNPJs)">
          <SparklesIcon size={15} /> {gerando ? 'Gerando...' : 'Resumo do assessor'}
        </button>
      </div>

      {resumo && (
        <div className="card" style={{ borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <SparklesIcon size={15} /> Prioridades da semana
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.5 }}>{resumo.texto}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>Gerado pelo Claude a partir dos alertas abaixo. Confira antes de agir.</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ABAS.map(({ id, rotulo, Icone }) => (
          <button key={id} className={`btn btn-sm ${aba === id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setAba(id)}>
            {Icone && <Icone size={14} />} {rotulo}
          </button>
        ))}
      </div>

      {aba === 'chat' && <ChatAssessor />}

      {(aba === 'tudo' || aba === 'reforma') && !clienteId && <Cronograma assessor={assessor} />}

      {(aba === 'tudo' || aba === 'reforma' || aba === 'uso') && (
        visiveis.length
          ? <div style={{ display: 'grid', gap: 8 }}>{visiveis.map((c) => <Cartao key={c.id} c={c} onNavigate={onNavigate} />)}</div>
          : <div className="card" style={{ color: 'var(--text2)' }}>Nada pendente aqui{clienteId ? ' para este cliente' : ''}.</div>
      )}

      {(aba === 'tudo' || aba === 'dicas') && <Dicas assessor={assessor} onNavigate={onNavigate} />}
      {(aba === 'tudo' || aba === 'noticias') && <Noticias assessor={assessor} />}
    </div>
  )
}

function Cartao({ c, onNavigate }) {
  const [aberto, setAberto] = useState(false)
  const { rotulo, cor, Icone } = NIVEL[c.nivel]
  const clientes = c.clientes || []
  return (
    <div className="card" style={{ borderLeft: `3px solid ${cor}`, margin: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icone size={18} style={{ color: cor, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{c.titulo}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: cor, textTransform: 'uppercase' }}>{rotulo}</span>
            <span className="badge badge-gray" style={{ fontSize: 10 }}>{c.tipo === 'reforma' ? 'Reforma' : 'Uso'}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4, lineHeight: 1.45 }}>{c.texto}</div>
          {c.mercado && (
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, padding: '6px 8px', background: 'var(--surface2)', borderRadius: 6 }}>
              <b>No mercado:</b> {c.mercado}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 12.5 }}>
            {clientes.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setAberto((a) => !a)}>
                {aberto ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />} {clientes.length} cliente(s)
              </button>
            )}
            {c.acao && onNavigate && <button className="btn btn-sm" onClick={() => onNavigate(c.acao.pagina)}>{c.acao.rotulo}</button>}
            {c.fonte && <a href={c.fonte.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text2)' }}>Fonte: {c.fonte.rotulo} <ExternalLinkIcon size={11} /></a>}
          </div>
          {aberto && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {clientes.map((x) => <span key={x.id} className="chip" style={{ fontSize: 11.5 }}>{x.nome}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Cronograma({ assessor }) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><ScaleIcon size={15} /> Transição da Reforma Tributária</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
        {assessor.cronograma.map((e) => {
          const atual = e.id === assessor.etapa.id
          return (
            <div key={e.id} style={{ padding: 10, borderRadius: 8, border: `1px solid ${atual ? 'var(--accent)' : 'var(--border)'}`, background: atual ? 'var(--surface2)' : 'transparent' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{e.titulo}{atual && <span className="badge badge-ok" style={{ marginLeft: 6, fontSize: 9 }}>agora</span>}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, lineHeight: 1.4 }}>{e.texto}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Dicas({ assessor, onNavigate }) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><RouteIcon size={15} /> Fluxos recomendados</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {assessor.fluxos.map((f) => (
          <div key={f.id} style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{f.titulo}</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
              {f.passos.map((p) => <li key={p}>{p}</li>)}
            </ol>
            {f.acao && onNavigate && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onNavigate(f.acao.pagina)}>{f.acao.rotulo}</button>}
          </div>
        ))}
      </div>
      <div style={{ fontWeight: 600, margin: '14px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}><LightbulbIcon size={15} /> Dicas de uso</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {assessor.dicas.map((d) => (
          <div key={d.id} style={{ fontSize: 13 }}>
            <b>{d.titulo}.</b> <span style={{ color: 'var(--text2)' }}>{d.texto}</span>
            {d.mercado && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>No mercado: {d.mercado}</div>}
            {d.acao && onNavigate && <button className="btn btn-sm btn-ghost" onClick={() => onNavigate(d.acao.pagina)}>{d.acao.rotulo} →</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

function Noticias({ assessor }) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <NewspaperIcon size={15} /> Notícias do setor
        <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>· lista revisada em {dataBR(assessor.atualizadoEm)}</span>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {assessor.noticias.map((n) => (
          <div key={n.id} style={{ fontSize: 13 }}>
            <div><span style={{ color: 'var(--text3)', fontSize: 12 }}>{dataBR(n.data)}</span> · <b>{n.titulo}</b></div>
            <div style={{ color: 'var(--text2)', lineHeight: 1.45 }}>{n.resumo}</div>
            <a href={n.fonte.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--text2)' }}>{n.fonte.rotulo} <ExternalLinkIcon size={11} /></a>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>Fontes de notícia são resumos de terceiros; confira no ato oficial antes de decidir.</div>
    </div>
  )
}
