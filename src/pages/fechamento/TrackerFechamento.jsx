import { useEffect, useMemo, useState } from 'react'
import {
  CheckIcon, UserIcon, GripVerticalIcon, AlertTriangleIcon, HourglassIcon, CheckSquareIcon, BriefcaseIcon,
  PackageCheckIcon, InboxIcon, CircleDashedIcon, SendIcon, EyeIcon,
} from 'lucide-react'
import TrilhaProgresso, { COR_ROXO } from '../../components/TrilhaProgresso'
import { trilhaEmpresa, guiasPorEmpresa, contagemEtapas, ETAPAS_TRILHA } from '../../lib/trilhaFechamento'
import { listarGuias } from '../entregas/entregasApi'

// Visualização "Tracker" do Fechamento (Empresas.jsx): cada empresa numa
// trilha de 6 etapas (src/lib/trilhaFechamento.js), das obrigações geradas
// até o cliente abrir a guia. Faz tudo o que a Lista faz — arrastar entre
// A fazer / Em andamento / Concluído (mesmos handlers), marcar aguardando
// cliente e concluído, selos, clique abre o modal da empresa e o módulo abre
// o modal já filtrado nele. As guias vêm da Central de Entregas.

const REGIME = {
  SN: { label: 'SN', titulo: 'Simples Nacional', cor: '#2563EB' },
  LP: { label: 'LP', titulo: 'Lucro Presumido', cor: '#7C3AED' },
  LR: { label: 'LR', titulo: 'Lucro Real', cor: '#C2410C' },
}
const COR_ETAPA = ['var(--text3)', 'var(--warn)', COR_ROXO, 'var(--ok)', 'var(--ok)', '#2563EB']
const COLUNAS = '22px minmax(220px, 1.1fr) minmax(330px, 2fr) 150px 120px 64px'

function Selo({ Icon, cor, bg, title, children }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px', color: cor, background: bg, whiteSpace: 'nowrap' }}>
      {Icon && <Icon size={10} />}{children}
    </span>
  )
}

export default function TrackerFechamento({
  rows, obrigacoes, tarefas, compSel, departamentos, cores, avatarCores,
  statusGeral, faseEmpresa, onAbrir, onMudarEntrega, onMudarStatusGeral,
  arrastandoId, setArrastandoId, onDropCard, onDropNaColuna, renderCadastro,
}) {
  const { S_COLOR, S_BG } = cores
  const [guias, setGuias] = useState([])
  const [erroGuias, setErroGuias] = useState(null)
  const [filtro, setFiltro] = useState('todas')

  useEffect(() => {
    let vivo = true
    setGuias([])
    listarGuias(compSel)
      .then((g) => { if (vivo) { setGuias(g); setErroGuias(null) } })
      .catch((e) => { if (vivo) setErroGuias(e.message) })
    return () => { vivo = false }
  }, [compSel])

  const porEmpresa = useMemo(() => guiasPorEmpresa(guias), [guias])
  const hoje = new Date(new Date().toDateString())

  const itens = useMemo(() => rows.map(({ c, deptData }) => {
    const obs = obrigacoes.filter((o) => o.cliente_id === c.id && o.competencia === compSel)
    const status = statusGeral(c.id)
    const trilha = trilhaEmpresa({
      obrigacoes: obs, guias: porEmpresa[c.id] || [],
      marcadoConcluido: status === 'entregue', aguardando: status === 'aguardando_cliente',
    })
    const tasksPend = tarefas.filter((t) => t.cliente_id === c.id && !t.concluida)
    const tasksAtrasadas = tasksPend.filter((t) => t.vencimento && new Date(t.vencimento + 'T00:00:00') < hoje).length
    const vencendo = Object.values(deptData || {}).some((d) => d.s === 'venc_breve')
    const proxVenc = obs.filter((o) => o.status === 'pendente' && o.vencimento).map((o) => o.vencimento).sort()[0] || null
    const pct = trilha.total > 0 ? Math.round((trilha.feitas / trilha.total) * 100) : 0
    return { c, deptData, trilha, status, fase: faseEmpresa(c.id), tasksPend: tasksPend.length, tasksAtrasadas, vencendo, proxVenc, pct }
  }), [rows, obrigacoes, tarefas, compSel, porEmpresa, statusGeral, faseEmpresa])

  const FILTROS = [
    { id: 'todas', label: 'Todas', cor: 'var(--text1)', teste: () => true },
    { id: 'vencidas', label: 'Com vencidas', cor: 'var(--danger)', teste: (r) => r.trilha.vencidas > 0 && r.trilha.etapa < 3 },
    { id: 'andamento', label: 'Em andamento', cor: 'var(--warn)', teste: (r) => r.trilha.etapa <= 1 && !r.trilha.vazia },
    { id: 'aguardando', label: 'Aguardando cliente', cor: COR_ROXO, teste: (r) => r.trilha.etapa === 2 },
    { id: 'concluido', label: 'Falta entregar', cor: 'var(--ok)', teste: (r) => r.trilha.etapa === 3 },
    { id: 'entregue', label: 'Entregues', cor: 'var(--ok)', teste: (r) => r.trilha.etapa >= 4 },
    { id: 'abriu', label: 'Cliente abriu', cor: '#2563EB', teste: (r) => r.trilha.etapa === 5 },
  ]
  const filtroAtivo = FILTROS.find((f) => f.id === filtro) || FILTROS[0]
  const visiveis = itens.filter(filtroAtivo.teste)
  const contagem = contagemEtapas(itens.map((r) => r.trilha))
  const entregues = contagem[4] + contagem[5]
  const pctEntregue = itens.length ? Math.round((entregues / itens.length) * 100) : 0

  const secoes = [
    { id: 'a_fazer', label: 'A fazer', Icon: CircleDashedIcon, cor: 'var(--text3)', bg: 'var(--surface2)' },
    { id: 'em_andamento', label: 'Em andamento', Icon: HourglassIcon, cor: 'var(--warn)', bg: 'var(--warn-dim)' },
    { id: 'concluido', label: 'Concluído e entrega', Icon: PackageCheckIcon, cor: 'var(--ok)', bg: 'var(--ok-dim)' },
  ].map((s) => ({ ...s, itens: visiveis.filter((r) => r.fase === s.id) }))

  const HEAD = { fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.4 }

  if (rows.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Nenhuma empresa encontrada</div>

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 980 }}>

        {/* Resumo: % entregue, barra por etapa e filtros */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PackageCheckIcon size={15} color="var(--ok)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text1)' }}>Entregas de {compSel}</span>
            <div style={{ flex: 1, height: 8, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden', display: 'flex' }}>
              {contagem.map((q, i) => q > 0 && (
                <span key={i} title={`${ETAPAS_TRILHA[i].rotulo}: ${q}`}
                  style={{ height: '100%', width: `${(q / itens.length) * 100}%`, background: i === 0 ? 'var(--border2)' : COR_ETAPA[i], opacity: i === 4 ? 0.75 : 1 }} />
              ))}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ok)' }}>{pctEntregue}%</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{entregues}/{itens.length} entregues</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {FILTROS.map((f) => {
              const qtd = itens.filter(f.teste).length
              const ativo = filtroAtivo.id === f.id
              return (
                <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={ativo}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 99, padding: '4px 10px',
                    color: ativo ? '#fff' : f.cor, background: ativo ? f.cor : 'var(--surface2)', border: `1px solid ${ativo ? f.cor : 'transparent'}`, opacity: qtd === 0 && !ativo ? 0.5 : 1 }}>
                  {f.label}
                  <span style={{ fontSize: 10, fontWeight: 800, borderRadius: 99, padding: '0 6px', minWidth: 18, textAlign: 'center',
                    background: ativo ? 'rgba(255,255,255,.25)' : 'var(--surface)', color: ativo ? '#fff' : f.cor }}>{qtd}</span>
                </button>
              )
            })}
            {erroGuias && <span style={{ fontSize: 10.5, color: 'var(--text3)' }} title={erroGuias}>Guias indisponíveis: as etapas de entrega usam só a marcação manual.</span>}
          </div>
        </div>

        {secoes.map((secao) => (
          <div key={secao.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDropNaColuna(secao.id) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 24, height: 24, borderRadius: 7, background: secao.bg, color: secao.cor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <secao.Icon size={13} />
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)' }}>{secao.label}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: secao.cor, background: secao.bg, borderRadius: 99, padding: '1px 8px' }}>{secao.itens.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLUNAS, gap: 12, padding: '0 12px' }}>
                <span /><span style={HEAD}>Empresa</span><span style={HEAD}>Progresso do mês</span>
                <span style={HEAD}>Módulos</span><span style={HEAD}>Obrigações</span><span style={{ ...HEAD, textAlign: 'right' }}>Ações</span>
              </div>
              {secao.itens.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--text3)', fontSize: 12, padding: '14px 0',
                  border: '1px dashed var(--border)', borderRadius: 'var(--r-md)' }}>
                  <InboxIcon size={18} />
                  {filtroAtivo.id === 'todas' ? 'Arraste uma empresa pra cá' : 'Nenhuma empresa com esse filtro'}
                </div>
              )}
              {secao.itens.map((r) => (
                <LinhaTracker key={r.c.id} r={r} departamentos={departamentos} S_COLOR={S_COLOR} S_BG={S_BG} avatarCores={avatarCores}
                  hoje={hoje} arrastando={arrastandoId === r.c.id} secaoId={secao.id}
                  onAbrir={onAbrir} onMudarEntrega={onMudarEntrega} onMudarStatusGeral={onMudarStatusGeral}
                  setArrastandoId={setArrastandoId} onDropCard={onDropCard} renderCadastro={renderCadastro} />
              ))}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--text3)' }}>
          <span><b style={{ color: 'var(--text2)' }}>Arrastar</b> uma empresa para outro grupo muda a fase, como na Lista.</span>
          <span><b style={{ color: 'var(--text2)' }}>Guias entregues</b> e <b style={{ color: 'var(--text2)' }}>Cliente abriu</b> vêm da Central de Entregas.</span>
        </div>
      </div>
    </div>
  )
}

function LinhaTracker({ r, departamentos, S_COLOR, S_BG, avatarCores, hoje, arrastando, secaoId, onAbrir, onMudarEntrega, onMudarStatusGeral, setArrastandoId, onDropCard, renderCadastro }) {
  const { c, deptData, trilha, status, tasksPend, tasksAtrasadas, vencendo, proxVenc, pct } = r
  const entregue = status === 'entregue'
  const aguardando = status === 'aguardando_cliente'
  const corLinha = trilha.vencidas > 0 && trilha.etapa < 3 ? 'var(--danger)' : aguardando ? COR_ROXO
    : trilha.etapa >= 3 ? 'var(--ok)' : vencendo ? S_COLOR.venc_breve : trilha.etapa === 1 ? 'var(--warn)' : 'var(--border2)'
  let h = 0
  for (const ch of c.nome || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [avBg, avTc] = avatarCores[h % avatarCores.length]
  const palavras = c.nome.split(' ').filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
  const iniciais = (palavras.length ? palavras : [c.nome]).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const regime = REGIME[c.regime === 'Lucro Presumido' ? 'LP' : c.regime === 'Lucro Real' ? 'LR' : 'SN']
  const diasProx = proxVenc ? Math.round((new Date(proxVenc + 'T00:00:00') - hoje) / 86400000) : null
  const corPct = trilha.vencidas > 0 ? 'var(--danger)' : pct === 100 ? 'var(--ok)' : 'var(--warn)'

  return (
    <div onClick={() => onAbrir(c, null)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(c, null) }}
      draggable
      onDragStart={(e) => { e.stopPropagation(); setArrastandoId(c.id) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropCard(c.id, secaoId) }}
      onDragEnd={() => setArrastandoId(null)}
      style={{ display: 'grid', gridTemplateColumns: COLUNAS, gap: 12, alignItems: 'center', cursor: 'pointer',
        background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${corLinha}`, borderRadius: 'var(--r-md)',
        padding: '10px 12px', opacity: arrastando ? 0.4 : 1, transition: 'opacity .1s' }}>
      <span style={{ display: 'flex', justifyContent: 'center' }} title="Arrastar pra reordenar ou mudar de grupo">
        <GripVerticalIcon size={14} color="var(--text3)" style={{ cursor: 'grab' }} />
      </span>

      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: avBg, color: avTc, fontSize: 11, fontWeight: 800, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{iniciais}</span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span title={c.nome} style={{ minWidth: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
            <span title={regime.titulo} style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, borderRadius: 4, padding: '1px 5px', color: regime.cor, background: `color-mix(in srgb, ${regime.cor}, transparent 86%)` }}>{regime.label}</span>
            {renderCadastro?.(c)}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {trilha.vencidas > 0 && trilha.etapa < 3 && <Selo Icon={AlertTriangleIcon} cor={S_COLOR.danger} bg={S_BG.danger}>{trilha.vencidas} vencida{trilha.vencidas !== 1 ? 's' : ''}</Selo>}
            {vencendo && trilha.etapa < 3 && <Selo Icon={HourglassIcon} cor={S_COLOR.venc_breve} bg={S_BG.venc_breve}>vence em breve</Selo>}
            {aguardando && <Selo Icon={UserIcon} cor={COR_ROXO} bg="rgba(124,58,237,.12)">aguardando cliente</Selo>}
            {tasksPend > 0 && (
              <Selo Icon={CheckSquareIcon} cor={tasksAtrasadas > 0 ? 'var(--danger)' : 'var(--info)'} bg={tasksAtrasadas > 0 ? 'var(--danger-dim)' : 'var(--info-dim)'}
                title={`${tasksPend} tarefa${tasksPend !== 1 ? 's' : ''} pendente${tasksPend !== 1 ? 's' : ''} — não contam no fechamento`}>
                {tasksPend} tarefa{tasksPend !== 1 ? 's' : ''}
              </Selo>
            )}
            {trilha.guiasFalhas > 0 && <Selo Icon={SendIcon} cor="var(--danger)" bg="var(--danger-dim)" title="Envio pela Central de Entregas falhou">{trilha.guiasFalhas} envio falhou</Selo>}
            {trilha.guiasAbertas > 0 && <Selo Icon={EyeIcon} cor="#2563EB" bg="rgba(37,99,235,.12)">abriu {trilha.guiasAbertas} guia{trilha.guiasAbertas !== 1 ? 's' : ''}</Selo>}
            {c.carteira && <Selo Icon={BriefcaseIcon} cor="var(--text3)" bg="var(--surface2)">{c.carteira}</Selo>}
          </span>
        </span>
      </span>

      <TrilhaProgresso trilha={trilha} />

      <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {departamentos.map((d) => {
          const dd = deptData?.[d.id] || { s: 'empty' }
          const vazio = dd.s === 'empty'
          return (
            <button key={d.id} type="button" onClick={(e) => { e.stopPropagation(); onAbrir(c, d) }}
              title={`${d.nome}: ${dd.val ?? '—'} — abrir só esse módulo`}
              style={{ display: 'flex', alignItems: 'center', gap: 3, height: 22, padding: '0 6px', borderRadius: 6, cursor: 'pointer',
                fontSize: 10, fontWeight: 700, opacity: vazio ? 0.45 : 1, background: S_BG[dd.s] || 'var(--surface2)', color: S_COLOR[dd.s] || 'var(--text3)',
                border: `1px solid ${vazio ? 'var(--border)' : `color-mix(in srgb, ${S_COLOR[dd.s]}, transparent 65%)`}` }}>
              <span style={{ fontSize: 11 }}>{d.icone || '📋'}</span>
              {!vazio && <span>{dd.s === 'na' ? 'N/A' : `${dd.pct}%`}</span>}
            </button>
          )
        })}
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 5 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{trilha.total > 0 ? `${trilha.feitas}/${trilha.total}` : 'sem obrig.'}</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: corPct }}>{trilha.total > 0 ? `${pct}%` : '—'}</span>
        </span>
        <span style={{ height: 5, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: corPct, borderRadius: 99 }} />
        </span>
        {diasProx != null && (
          <span style={{ fontSize: 10, color: diasProx < 0 ? S_COLOR.danger : diasProx <= 3 ? S_COLOR.venc_breve : 'var(--text3)' }}>
            {diasProx < 0 ? `venceu há ${-diasProx}d` : diasProx === 0 ? 'vence hoje' : `próx. em ${diasProx}d`}
          </span>
        )}
      </span>

      <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {!entregue && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMudarStatusGeral(c.id, aguardando ? 'a_entregar' : 'aguardando_cliente') }}
            title={aguardando ? 'Não está mais aguardando o cliente' : 'Marcar como aguardando cliente'} aria-pressed={aguardando}
            style={{ width: 28, height: 28, borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${aguardando ? COR_ROXO : 'var(--border)'}`, background: aguardando ? 'rgba(124,58,237,.12)' : 'var(--surface2)', color: aguardando ? COR_ROXO : 'var(--text3)' }}>
            <UserIcon size={13} />
          </button>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); onMudarEntrega(c.id, !entregue) }}
          title={entregue ? 'Voltar para em andamento' : 'Marcar como concluído'} aria-pressed={entregue}
          style={{ width: 28, height: 28, borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${entregue ? 'var(--ok)' : 'var(--border)'}`, background: entregue ? 'var(--ok)' : 'var(--surface2)', color: entregue ? '#fff' : 'var(--text3)' }}>
          <CheckIcon size={13} strokeWidth={3} />
        </button>
      </span>
    </div>
  )
}

