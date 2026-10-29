import { useState, useEffect, useRef, useMemo } from 'react'
import {
  LayoutDashboardIcon, SparklesIcon, AppWindowIcon, ClipboardCheckIcon, CheckSquareIcon, CalendarDaysIcon, BellIcon,
  UsersIcon, TargetIcon, PaperclipIcon, MonitorIcon, CircleDollarSignIcon, BanknoteIcon, CalculatorIcon, RefreshCwIcon,
  ReceiptIcon, FileSignatureIcon, ChevronDownIcon, SearchIcon, MenuIcon, XIcon,
} from 'lucide-react'

// Menu do gestor agrupado por assunto. O id de cada item é o mesmo `page`
// usado no App.jsx ('empresas' continua sendo o id da tela Fechamento, pra
// não quebrar navegações que já apontam pra ele).
export const GRUPOS = [
  { id: 'inicio', nome: 'Início', itens: [
    { id: 'overview',   label: 'Painel',       desc: 'Resumo do dia',                 Icon: LayoutDashboardIcon },
    { id: 'assessor',   label: 'Assessor',     desc: 'Prioridades e notícias',        Icon: SparklesIcon },
    { id: 'central',    label: 'Central',      desc: 'Atalhos e sistemas',            Icon: AppWindowIcon },
  ]},
  { id: 'rotina', nome: 'Rotina', itens: [
    { id: 'empresas',   label: 'Fechamento',   desc: 'Obrigações do mês por empresa', Icon: ClipboardCheckIcon },
    { id: 'tarefas',    label: 'Tarefas',      desc: 'Independentes do fechamento',   Icon: CheckSquareIcon },
    { id: 'agenda',     label: 'Agenda',       desc: 'Reuniões e lembretes',          Icon: CalendarDaysIcon },
    { id: 'notificacoes', label: 'Notificações', desc: 'Avisos enviados',             Icon: BellIcon },
  ]},
  { id: 'clientes', nome: 'Clientes', itens: [
    { id: 'clientes',   label: 'Clientes',     desc: 'Cadastro das empresas',         Icon: UsersIcon },
    { id: 'prospectos', label: 'Prospectos',   desc: 'Novos clientes em negociação',  Icon: TargetIcon },
    { id: 'documentos', label: 'Documentos',   desc: 'Arquivos recebidos',            Icon: PaperclipIcon },
    { id: 'paineis',    label: 'Painéis',      desc: 'Painel do cliente',             Icon: MonitorIcon },
  ]},
  { id: 'financeiro', nome: 'Financeiro', itens: [
    { id: 'pagamentos', label: 'Pagamentos',   desc: 'Guias e comprovantes',          Icon: CircleDollarSignIcon },
    { id: 'honorarios', label: 'Honorários',   desc: 'Cobrança do escritório',        Icon: BanknoteIcon },
    { id: 'contabil',   label: 'Financeiro',   desc: 'Lançamentos e conciliação',     Icon: CalculatorIcon },
    { id: 'erp',        label: 'ERP',          desc: 'Fechamentos do sistema contábil', Icon: RefreshCwIcon },
  ]},
  { id: 'fiscal', nome: 'Fiscal', itens: [
    { id: 'notasfiscais', label: 'Notas Fiscais', desc: 'Notas das empresas',         Icon: ReceiptIcon },
    { id: 'nfse',       label: 'Emitir NFS-e', desc: 'Nota de serviço',               Icon: FileSignatureIcon },
  ]},
]

export const NAV = GRUPOS.flatMap(g => g.itens.map(i => ({ ...i, grupo: g.nome })))

// badges: { [pageId]: { n, tipo: 'warn' | 'err' } }
function Badge({ b }) {
  if (!b || !b.n) return null
  return <span className={`badge ${b.tipo === 'err' ? 'badge-err' : 'badge-warn'}`} style={{ fontSize: 10 }}>{b.n}</span>
}

function ItemMenu({ item, ativo, badge, onClick, destaque }) {
  const { Icon } = item
  return (
    <button type="button" role="menuitem" className={`menu-item ${ativo ? 'active' : ''} ${destaque ? 'destaque' : ''}`} onClick={onClick}>
      <span className="menu-item-icone"><Icon size={18} /></span>
      <span className="menu-item-textos">
        <span className="menu-item-nome">{item.label}</span>
        <span className="menu-item-desc">{item.desc}</span>
      </span>
      <Badge b={badge} />
    </button>
  )
}

// Abas do topo (desktop): cada grupo abre uma caixa com as telas dele.
export function MenuTopo({ page, onNavigate, badges }) {
  const [aberto, setAberto] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(null) }
    const esc = (e) => { if (e.key === 'Escape') setAberto(null) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  return (
    <nav className="menu-topo" aria-label="Menu principal" ref={ref}>
      {GRUPOS.map(g => {
        const ativo = g.itens.some(i => i.id === page)
        const alerta = g.itens.some(i => badges[i.id]?.n)
        return (
          <div key={g.id} className="menu-grupo">
            <button type="button" className={`menu-aba ${ativo ? 'active' : ''} ${aberto === g.id ? 'aberta' : ''}`}
              aria-expanded={aberto === g.id} aria-haspopup="menu"
              onClick={() => setAberto(a => a === g.id ? null : g.id)}
              onMouseEnter={() => { if (aberto && aberto !== g.id) setAberto(g.id) }}>
              {g.nome}
              {alerta && <span className="menu-aba-ponto" aria-hidden="true" />}
              <ChevronDownIcon size={14} />
            </button>
            {aberto === g.id && (
              <div className="menu-caixa" role="menu" aria-label={g.nome}>
                {g.itens.map(i => (
                  <ItemMenu key={i.id} item={i} ativo={page === i.id} badge={badges[i.id]}
                    onClick={() => { setAberto(null); onNavigate(i.id) }} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// Busca rápida (Ctrl K): digita o nome da tela e Enter.
export function BuscaRapida({ aberta, onFechar, onNavigate, badges }) {
  const [termo, setTermo] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  useEffect(() => { if (aberta) { setTermo(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [aberta])
  const lista = useMemo(() => {
    const t = termo.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const sem = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return NAV.filter(i => !t || sem(i.label).includes(t) || sem(i.desc).includes(t) || sem(i.grupo).includes(t))
  }, [termo])
  if (!aberta) return null
  const ir = (i) => { onFechar(); onNavigate(i.id) }
  const tecla = (e) => {
    if (e.key === 'Escape') onFechar()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, lista.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && lista[sel]) ir(lista[sel])
  }
  return (
    <div className="busca-fundo" onMouseDown={onFechar}>
      <div className="busca-caixa" role="dialog" aria-label="Ir para tela" onMouseDown={e => e.stopPropagation()}>
        <label className="busca-campo">
          <SearchIcon size={18} />
          <input ref={inputRef} value={termo} onChange={e => { setTermo(e.target.value); setSel(0) }} onKeyDown={tecla}
            placeholder="Ir para tela… (ex.: fechamento, notas, agenda)" aria-label="Buscar tela" />
          <kbd>Esc</kbd>
        </label>
        <div className="busca-lista" role="menu">
          {lista.length === 0 && <p className="busca-vazio">Nenhuma tela com esse nome.</p>}
          {lista.map((i, idx) => (
            <ItemMenu key={i.id} item={{ ...i, desc: `${i.grupo} · ${i.desc}` }} badge={badges[i.id]} destaque={idx === sel}
              onClick={() => ir(i)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// Celular: botão ☰ abre a lista completa, agrupada.
export function MenuCelular({ page, onNavigate, badges }) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-icon btn-ghost menu-celular-botao" onClick={() => setAberto(true)} aria-label="Abrir menu">
        <MenuIcon size={20} />
      </button>
      {aberto && (
        <div className="busca-fundo" onMouseDown={() => setAberto(false)}>
          <div className="menu-celular" role="dialog" aria-label="Menu" onMouseDown={e => e.stopPropagation()}>
            <div className="menu-celular-topo">
              <span style={{ fontWeight: 700 }}>Menu</span>
              <button type="button" className="btn btn-icon btn-ghost" onClick={() => setAberto(false)} aria-label="Fechar menu"><XIcon size={18} /></button>
            </div>
            {GRUPOS.map(g => (
              <div key={g.id} className="menu-celular-grupo">
                <span className="menu-celular-titulo">{g.nome}</span>
                {g.itens.map(i => (
                  <ItemMenu key={i.id} item={i} ativo={page === i.id} badge={badges[i.id]}
                    onClick={() => { setAberto(false); onNavigate(i.id) }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
