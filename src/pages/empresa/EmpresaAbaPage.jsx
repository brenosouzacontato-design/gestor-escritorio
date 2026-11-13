// Aba da empresa: abre uma empresa numa aba própria (id 'empresa:<cliente_id>'
// no App.jsx) e junta nela os módulos que já existem, filtrados por ela. No
// topo, o que falta para fechar a competência — a aba serve de lembrete das
// empresas que o escritório pretende fechar (continua lá depois de recarregar).
// Nada de lógica nova de dados: cada módulo é a tela de sempre com `clienteFixo`.
import { useEffect, useMemo, useState } from 'react'
import {
  ListChecksIcon, MonitorIcon, SettingsIcon, SendIcon, FileSignatureIcon, LayersIcon, BanknoteIcon, CalculatorIcon,
  ClipboardCheckIcon, CheckSquareIcon, PaperclipIcon, CircleDollarSignIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon,
  CheckCircle2Icon, AlertCircleIcon, StickyNoteIcon, XIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { supabase } from '../../lib/supabase'
import { trilhaEmpresa } from '../../lib/trilhaFechamento'
import TrilhaProgresso from '../../components/TrilhaProgresso'
import { ClienteDetalhe } from '../Clientes'
import PainelCompartilhadoPage from '../painel/PainelCompartilhadoPage'
import CentralEntregasPage from '../entregas/CentralEntregasPage'
import NfseEmissaoPage from '../nfse/NfseEmissaoPage'
import ParcelamentosPage from '../parcelamentos/ParcelamentosPage'
import HonorariosPage from '../honorarios/HonorariosPage'
import ContabilPage from '../contabil/ContabilPage'
import { listarGuias, situacaoGuia } from '../entregas/entregasApi'
import { listarNfsePendentes } from '../painel/nfsePainelApi'

const MODULOS = [
  { id: 'resumo', rotulo: 'Para fechar', Icon: ListChecksIcon },
  { id: 'painel', rotulo: 'Painel do cliente', Icon: MonitorIcon },
  { id: 'cadastro', rotulo: 'Cadastro e obrigações', Icon: SettingsIcon },
  { id: 'entregas', rotulo: 'Entregas', Icon: SendIcon },
  { id: 'nfse', rotulo: 'NFS-e', Icon: FileSignatureIcon },
  { id: 'parcelamentos', rotulo: 'Parcelamentos', Icon: LayersIcon },
  { id: 'honorarios', rotulo: 'Honorários', Icon: BanknoteIcon },
  { id: 'financeiro', rotulo: 'Financeiro', Icon: CalculatorIcon },
]

const chaveAba = (clienteId) => `gestor-aba-empresa:${clienteId}`
function lerAba(clienteId) {
  try { return JSON.parse(localStorage.getItem(chaveAba(clienteId)) || '{}') || {} } catch { return {} }
}
function salvarAba(clienteId, dados) {
  try { localStorage.setItem(chaveAba(clienteId), JSON.stringify(dados)) } catch { /* sem localStorage */ }
}

// '04/2026' ± n meses
function somarMes(comp, n) {
  const [m, a] = String(comp).split('/').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '')
const feita = (o) => o.status === 'concluido' || o.status === 'nao_aplica'

export default function EmpresaAbaPage({ clienteId, onNavigate, onAddTarefa, onAbrirFechamento, onAbrirTarefas, onFecharAba }) {
  const clientes = useStore((s) => s.clientes)
  const carregandoStore = useStore((s) => s.loading)
  const tarefas = useStore((s) => s.tarefas)
  const fechamentos = useStore((s) => s.fechamentos)
  const obrigacoes = useStore((s) => s.obrigacoes || [])
  const competencia = useStore((s) => s.competenciaSelecionada)
  const setCompetencia = useStore((s) => s.setCompetenciaSelecionada)
  const cliente = clientes.find((c) => c.id === clienteId)

  const salvo = useMemo(() => lerAba(clienteId), [clienteId])
  const [modulo, setModulo] = useState(MODULOS.some((m) => m.id === salvo.modulo) ? salvo.modulo : 'resumo')
  const [lembrete, setLembrete] = useState(salvo.lembrete || '')
  // módulos já abertos continuam montados (não perdem filtro nem formulário)
  const [visitados, setVisitados] = useState(() => new Set([modulo]))
  useEffect(() => { setVisitados((v) => (v.has(modulo) ? v : new Set(v).add(modulo))) }, [modulo])
  useEffect(() => { salvarAba(clienteId, { modulo, lembrete }) }, [clienteId, modulo, lembrete])

  // ---- o que falta para fechar a competência ----
  const obsComp = useMemo(() => obrigacoes.filter((o) => o.cliente_id === clienteId && o.competencia === competencia), [obrigacoes, clienteId, competencia])
  const obsAbertas = useMemo(() => obsComp.filter((o) => !feita(o))
    .sort((a, b) => String(a.vencimento || '9').localeCompare(String(b.vencimento || '9'))), [obsComp])
  const tarefasAbertas = useMemo(() => tarefas.filter((t) => t.cliente_id === clienteId && !t.concluida), [tarefas, clienteId])

  const [guias, setGuias] = useState(null) // null = carregando
  const [statusManual, setStatusManual] = useState({ entregue: false, aguardando: false })
  const [nfsePend, setNfsePend] = useState(null)
  useEffect(() => {
    let ativo = true
    setGuias(null)
    listarGuias(competencia)
      .then((l) => ativo && setGuias(l.filter((g) => g.cliente_id === clienteId)))
      .catch(() => ativo && setGuias([]))
    supabase.from('cliente_entrega_competencia').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle()
      .then(({ data }) => ativo && setStatusManual({ entregue: !!data?.entregue, aguardando: !!data?.aguardando_cliente && !data?.entregue }))
    return () => { ativo = false }
  }, [clienteId, competencia])
  useEffect(() => {
    let ativo = true
    listarNfsePendentes(clienteId).then((n) => ativo && setNfsePend(n)).catch(() => ativo && setNfsePend([]))
    return () => { ativo = false }
  }, [clienteId])

  const guiasPendentes = (guias || []).filter((g) => ['a_entregar', 'falhou'].includes(situacaoGuia(g)))
  const guiasSemAbrir = (guias || []).filter((g) => ['entregue', 'vista'].includes(situacaoGuia(g)))
  const trilha = trilhaEmpresa({ obrigacoes: obsComp, guias: guias || [], marcadoConcluido: statusManual.entregue, aguardando: statusManual.aguardando })
  const totalFalta = obsAbertas.length + guiasPendentes.length + tarefasAbertas.length + (nfsePend?.length || 0)
  const qtdModulo = { resumo: totalFalta, entregas: guiasPendentes.length, nfse: nfsePend?.length || 0 }

  if (!cliente) {
    if (carregandoStore || !clientes.length) return <div className="center"><div className="spinner" /></div>
    return (
      <div className="page">
        <div className="empty-state" style={{ padding: 30, textAlign: 'center' }}>
          <p>Essa empresa não está mais na lista de clientes.</p>
          <button className="btn" onClick={onFecharAba}><XIcon size={14} /> Fechar a aba</button>
        </div>
      </div>
    )
  }

  const atalho = (Icon, rotulo, onClick, title) => (
    <button type="button" className="btn btn-sm" onClick={onClick} title={title}><Icon size={14} /> {rotulo}</button>
  )

  const renderModulo = (id) => {
    switch (id) {
      case 'resumo': return (
        <Resumo {...{ cliente, competencia, trilha, obsAbertas, obsComp, guias, guiasPendentes, guiasSemAbrir, tarefasAbertas, nfsePend, totalFalta, lembrete, setLembrete, setModulo }}
          onAbrirFechamento={() => onAbrirFechamento(clienteId)} onAbrirTarefas={() => onAbrirTarefas(clienteId)} />
      )
      case 'painel': return <PainelCompartilhadoPage key={competencia} clienteId={clienteId} competencia={competencia} admin />
      case 'cadastro': return (
        <ClienteDetalhe cliente={cliente} tarefas={tarefas.filter((t) => t.cliente_id === clienteId)}
          fechamentos={fechamentos.filter((f) => f.cliente_id === clienteId)} onAddTarefa={() => onAddTarefa(clienteId)} />
      )
      case 'entregas': return <CentralEntregasPage clienteFixo={clienteId} />
      case 'nfse': return <NfseEmissaoPage clienteFixo={clienteId} />
      case 'parcelamentos': return <ParcelamentosPage clienteFixo={clienteId} />
      case 'honorarios': return <HonorariosPage clienteFixo={clienteId} />
      case 'financeiro': return <ContabilPage clienteFixo={clienteId} />
      default: return null
    }
  }

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cliente.nome}</h2>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            {[cliente.cnpj || cliente.cpf, cliente.regime, cliente.carteira].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Competência (vale para o app todo, como no Painel)">
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setCompetencia(somarMes(competencia, -1))} aria-label="Competência anterior"><ChevronLeftIcon size={16} /></button>
          <span style={{ fontWeight: 700, fontSize: 13, minWidth: 64, textAlign: 'center' }}>{competencia}</span>
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setCompetencia(somarMes(competencia, 1))} aria-label="Próxima competência"><ChevronRightIcon size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {atalho(ClipboardCheckIcon, 'Fechamento', () => onAbrirFechamento(clienteId), 'Abrir a empresa no Fechamento (obrigações do mês)')}
          {atalho(CheckSquareIcon, 'Tarefas', () => onAbrirTarefas(clienteId), 'Tarefas desta empresa')}
          {atalho(PaperclipIcon, 'Documentos', () => onNavigate('documentos'), 'Arquivos recebidos')}
          {atalho(CircleDollarSignIcon, 'Pagamentos', () => onNavigate('pagamentos'), 'Guias e comprovantes')}
          <button type="button" className="btn btn-sm btn-accent" onClick={() => onAddTarefa(clienteId)}><PlusIcon size={14} /> Tarefa</button>
        </div>
      </div>

      <div className="empresa-aba-modulos" role="tablist" aria-label="Módulos da empresa">
        {MODULOS.map(({ id, rotulo, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={modulo === id} data-ativo={modulo === id}
            className="empresa-aba-modulo" onClick={() => setModulo(id)}>
            <Icon size={14} /> {rotulo}
            {qtdModulo[id] > 0 && <span className={`empresa-aba-qtd ${id === 'resumo' && trilha.vencidas ? 'err' : ''}`}>{qtdModulo[id]}</span>}
          </button>
        ))}
      </div>

      {MODULOS.filter((m) => visitados.has(m.id) || m.id === modulo).map((m) => (
        <div key={m.id} className="empresa-aba-conteudo" style={{ display: m.id === modulo ? 'block' : 'none' }}>{renderModulo(m.id)}</div>
      ))}
    </div>
  )
}

function Resumo({ cliente, competencia, trilha, obsAbertas, obsComp, guias, guiasPendentes, guiasSemAbrir, tarefasAbertas, nfsePend,
  totalFalta, lembrete, setLembrete, setModulo, onAbrirFechamento, onAbrirTarefas }) {
  const carregando = guias === null || nfsePend === null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="empresa-aba-bloco">
        <h4><StickyNoteIcon size={14} /> O que pretendo fazer nesta empresa</h4>
        <textarea value={lembrete} onChange={(e) => setLembrete(e.target.value)} rows={2}
          placeholder="Lembrete desta aba (fica salvo neste navegador). Ex.: fechar o mês, conferir o DAS, cobrar o extrato…"
          style={{ width: '100%', resize: 'vertical', fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)', color: 'var(--text1)', fontFamily: 'inherit' }} />
      </div>

      <div className="empresa-aba-bloco">
        <h4 style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ListChecksIcon size={14} /> Fechamento de {competencia}</span>
          {carregando
            ? <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500 }}>carregando…</span>
            : totalFalta === 0
              ? <span style={{ fontSize: 12, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2Icon size={14} /> Nada pendente</span>
              : <span style={{ fontSize: 12, color: trilha.vencidas ? 'var(--danger)' : 'var(--warn)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircleIcon size={14} /> {totalFalta} pendência{totalFalta !== 1 ? 's' : ''}
                </span>}
        </h4>
        <TrilhaProgresso trilha={trilha} />
        {trilha.vazia && <p style={{ fontSize: 12, color: 'var(--text3)', margin: '8px 0 0' }}>Sem obrigações geradas para {competencia}.</p>}
      </div>

      <div className="empresa-aba-falta">
        <Bloco Icon={ClipboardCheckIcon} titulo={`Obrigações abertas (${obsAbertas.length}/${obsComp.length})`} vazio="Todas concluídas ou sem obrigação."
          itens={obsAbertas} onClick={onAbrirFechamento} acao="Fechamento"
          linha={(o) => (<>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.titulo || o.tipo}</span>
            {o.vencimento && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>vence {dataBR(o.vencimento)}</span>}
            <span className={`badge ${o.status === 'vencido' ? 'badge-err' : 'badge-warn'}`}>{o.status === 'vencido' ? 'Vencida' : 'Pendente'}</span>
          </>)} />
        <Bloco Icon={SendIcon} titulo={`Guias para entregar (${guiasPendentes.length})`} carregando={guias === null}
          vazio={guias?.length ? 'Todas as guias foram entregues.' : 'Nenhuma guia anexada na competência.'}
          itens={guiasPendentes} onClick={() => setModulo('entregas')} acao="Abrir Entregas"
          rodape={guiasSemAbrir.length > 0 ? `${guiasSemAbrir.length} entregue${guiasSemAbrir.length !== 1 ? 's' : ''} e ainda sem o cliente abrir` : null}
          linha={(g) => (<>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.titulo || g.obrigacoes?.titulo || 'Guia'}</span>
            <span className={`badge ${situacaoGuia(g) === 'falhou' ? 'badge-err' : 'badge-warn'}`}>{situacaoGuia(g) === 'falhou' ? 'Falhou' : 'A entregar'}</span>
          </>)} />
        <Bloco Icon={CheckSquareIcon} titulo={`Tarefas abertas (${tarefasAbertas.length})`} vazio="Nenhuma tarefa aberta."
          itens={tarefasAbertas} onClick={onAbrirTarefas} acao="Abrir Tarefas"
          linha={(t) => (<>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo}</span>
            {t.vencimento && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{dataBR(t.vencimento)}</span>}
          </>)} />
        <Bloco Icon={FileSignatureIcon} titulo={`NFS-e a emitir (${nfsePend?.length || 0})`} carregando={nfsePend === null} vazio="Nenhuma nota esperando emissão."
          itens={nfsePend || []} onClick={() => setModulo('nfse')} acao="Abrir NFS-e"
          linha={(n) => (<>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nome || n.descricao || 'Nota'}</span>
            {n.valor != null && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{Number(n.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>}
            <span className={`badge ${n.pronta ? 'badge-ok' : 'badge-warn'}`}>{n.pronta ? 'Pronta' : 'Falta info'}</span>
          </>)} />
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: 0 }}>
        Os módulos acima (painel, cadastro, entregas, NFS-e, parcelamentos, honorários e financeiro) já abrem só com {cliente.nome.replace(/^[\d./-]+\s+/, '')}.
      </p>
    </div>
  )
}

const MAX_LINHAS = 8

function Bloco({ Icon, titulo, itens, linha, vazio, onClick, acao, carregando = false, rodape = null }) {
  return (
    <div className="empresa-aba-bloco">
      <h4 style={{ justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon size={14} /> {titulo}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClick}>{acao}</button>
      </h4>
      {carregando
        ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Carregando…</p>
        : itens.length === 0
          ? <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>{vazio}</p>
          : itens.slice(0, MAX_LINHAS).map((it, i) => (
            <button key={it.id || i} type="button" className="empresa-aba-linha" onClick={onClick}>{linha(it)}</button>
          ))}
      {!carregando && itens.length > MAX_LINHAS && <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: '4px 0 0' }}>+ {itens.length - MAX_LINHAS} mais</p>}
      {!carregando && rodape && <p style={{ fontSize: 11.5, color: 'var(--text3)', margin: '6px 0 0' }}>{rodape}</p>}
    </div>
  )
}
