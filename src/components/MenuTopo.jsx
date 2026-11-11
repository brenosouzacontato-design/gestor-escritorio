import { useState, useEffect, useRef, useMemo } from 'react'
import {
  LayoutDashboardIcon, SparklesIcon, AppWindowIcon, ClipboardCheckIcon, CheckSquareIcon, CalendarDaysIcon, BellIcon,
  UsersIcon, TargetIcon, SunIcon, PaperclipIcon, MonitorIcon, CircleDollarSignIcon, BanknoteIcon, CalculatorIcon, RefreshCwIcon,
  ReceiptIcon, FileSignatureIcon, LayersIcon, FileBadgeIcon, ShieldCheckIcon, ChevronDownIcon, SearchIcon, MenuIcon, XIcon, SendIcon, ReceiptTextIcon, BadgeCheckIcon, UserPlusIcon, Building2Icon,
}  from 'lucide-react'
import { useStore } from '../store'

// Menu do gestor. O grupo "Rotina" (direto: true) aparece com cada tela
// direto na barra, a um clique: são as mais usadas no dia a dia. Os outros
// abrem uma caixa; em Documentos os itens vêm em seções (secao). O id de
// cada item é o mesmo `page` usado no App.jsx ('empresas' continua sendo o
// id da tela Fechamento, pra não quebrar navegações que já apontam pra ele).
export const GRUPOS = [
  { id: 'rotina', nome: 'Rotina', direto: true, itens: [
    { id: 'hoje',       label: 'Hoje',         desc: 'Pendências do dia (tablet)',    Icon: SunIcon },
    { id: 'empresas',   label: 'Fechamento',   desc: 'Obrigações do mês por empresa', Icon: ClipboardCheckIcon },
    { id: 'entregas',   label: 'Entregas',     desc: 'Entregar guias e ver se o cliente abriu', Icon: SendIcon },
    { id: 'tarefas',    label: 'Tarefas',      desc: 'Independentes do fechamento',   Icon: CheckSquareIcon },
    { id: 'agenda',     label: 'Agenda',       desc: 'Reuniões e lembretes',          Icon: CalendarDaysIcon },
  ]},
  { id: 'documentos', nome: 'Documentos', itens: [
    { id: 'documentos', label: 'Documentos',   desc: 'Arquivos recebidos',            Icon: PaperclipIcon,        secao: 'Recebidos e guias' },
    { id: 'pagamentos', label: 'Pagamentos',   desc: 'Guias e comprovantes',          Icon: CircleDollarSignIcon, secao: 'Recebidos e guias' },
    { id: 'parcelamentos', label: 'Parcelamentos', desc: 'Guias de PARCMEI e PGFN',   Icon: LayersIcon,           secao: 'Recebidos e guias' },
    { id: 'notasfiscais', label: 'Notas Fiscais', desc: 'Notas das empresas',         Icon: ReceiptIcon,          secao: 'Notas fiscais' },
    { id: 'nfse',       label: 'Emitir NFS-e', desc: 'Nota de serviço',               Icon: FileSignatureIcon,    secao: 'Notas fiscais' },
    { id: 'nfsemei',    label: 'NFS-e MEI',    desc: 'MEI sem certificado: robô no Emissor Nacional', Icon: BadgeCheckIcon, secao: 'Notas fiscais' },
    { id: 'pedidosnfe', label: 'Pedidos de NF-e', desc: 'Notas de venda pedidas pelo app do cliente', Icon: ReceiptTextIcon, secao: 'Notas fiscais' },
    { id: 'licenciamento', label: 'Licenciamento', desc: 'Alvarás e licenças a vencer', Icon: FileBadgeIcon,      secao: 'Certidões e licenças' },
    { id: 'ecac',       label: 'Situação e-CAC', desc: 'Receita e pagamentos (robô)', Icon: ShieldCheckIcon,      secao: 'Certidões e licenças' },
  ]},
  { id: 'clientes', nome: 'Clientes', itens: [
    { id: 'clientes',   label: 'Clientes',     desc: 'Cadastro das empresas',         Icon: UsersIcon },
    { id: 'prospectos', label: 'Prospectos',   desc: 'Novos clientes em negociação',  Icon: TargetIcon },
    { id: 'admissoes',  label: 'Admissões',    desc: 'Ficha do funcionário por link e WhatsApp', Icon: UserPlusIcon },
    { id: 'paineis',    label: 'Painéis',      desc: 'Painel do cliente',             Icon: MonitorIcon },
  ]},
  { id: 'financeiro', nome: 'Financeiro', itens: [
    { id: 'honorarios', label: 'Honorários',   desc: 'Cobrança do escritório',        Icon: BanknoteIcon },
    { id: 'contabil',   label: 'Financeiro',   desc: 'Lançamentos e conciliação',     Icon: CalculatorIcon },
    { id: 'erp',        label: 'ERP',          desc: 'Fechamentos do sistema contábil', Icon: RefreshCwIcon },
  ]},
  { id: 'mais', nome: 'Mais', itens: [
    { id: 'overview',   label: 'Painel',       desc: 'Resumo do dia',                 Icon: LayoutDashboardIcon },
    { id: 'assessor',   label: 'Assessor',     desc: 'Prioridades e notícias',        Icon: SparklesIcon },
    { id: 'central',    label: 'Central',      desc: 'Atalhos e sistemas',            Icon: AppWindowIcon },
    { id: 'notificacoes', label: 'Notificações', desc: 'Avisos enviados',             Icon: BellIcon },
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

// Itens da caixa de um grupo, separados por seção quando o grupo tem seções
function ItensDoGrupo({ grupo, page, badges, onEscolher }) {
  const secoes = [...new Set(grupo.itens.map(i => i.secao).filter(Boolean))]
  if (secoes.length === 0) {
    return grupo.itens.map(i => (
      <ItemMenu key={i.id} item={i} ativo={page === i.id} badge={badges[i.id]} onClick={() => onEscolher(i.id)} />
    ))
  }
  return secoes.map(sec => (
    <div key={sec} className="menu-secao">
      <span className="menu-secao-titulo">{sec}</span>
      {grupo.itens.filter(i => i.secao === sec).map(i => (
        <ItemMenu key={i.id} item={i} ativo={page === i.id} badge={badges[i.id]} onClick={() => onEscolher(i.id)} />
      ))}
    </div>
  ))
}

// Barra do topo (desktop): as telas da Rotina direto na barra; os outros
// grupos abrem uma caixa com as telas deles.
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

  const diretos = GRUPOS.filter(g => g.direto).flatMap(g => g.itens)
  const caixas = GRUPOS.filter(g => !g.direto)
  return (
    <nav className="menu-topo" aria-label="Menu principal" ref={ref}>
      {diretos.map(i => {
        const { Icon } = i
        const b = badges[i.id]
        return (
          <button key={i.id} type="button" title={`${i.label} · ${i.desc}`}
            className={`menu-aba menu-direto ${page === i.id ? 'active' : ''}`}
            aria-current={page === i.id ? 'page' : undefined}
            onClick={() => { setAberto(null); onNavigate(i.id) }}>
            <Icon size={15} />
            <span className="menu-direto-nome">{i.label}</span>
            {b?.n ? <span className={`menu-aba-qtd ${b.tipo === 'err' ? 'err' : ''}`}>{b.n}</span> : null}
          </button>
        )
      })}
      <span className="menu-separador" aria-hidden="true" />
      {caixas.map(g => {
        const ativo = g.itens.some(i => i.id === page)
        const alerta = g.itens.some(i => badges[i.id]?.n)
        const comSecoes = g.itens.some(i => i.secao)
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
              <div className={`menu-caixa ${comSecoes ? 'menu-caixa-secoes' : 'menu-caixa-simples'}`} role="menu" aria-label={g.nome}>
                <ItensDoGrupo grupo={g} page={page} badges={badges} onEscolher={(id) => { setAberto(null); onNavigate(id) }} />
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

// Busca rápida (Ctrl K): nome da tela ou da empresa (nome, CNPJ, código) e Enter.
// Empresa: Enter abre no Fechamento; Shift+Enter (ou o botão) abre o cadastro.
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const soDigitos = (s) => String(s || '').replace(/\D/g, '')
const nomeEmpresa = (nome) => String(nome || '').replace(/^[\d./-]+\s+/, '')
const MAX_EMPRESAS = 8

export function BuscaRapida({ aberta, onFechar, onNavigate, badges, onAbrirEmpresa, onAbrirCadastro }) {
  const clientes = useStore(s => s.clientes)
  const [termo, setTermo] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listaRef = useRef(null)
  useEffect(() => { if (aberta) { setTermo(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [aberta])
  const { telas, empresas } = useMemo(() => {
    const t = semAcento(termo.trim())
    const telas = NAV.filter(i => !t || semAcento(i.label).includes(t) || semAcento(i.desc).includes(t) || semAcento(i.grupo).includes(t))
    if (!t) return { telas, empresas: [] }
    const dig = soDigitos(termo)
    const palavras = t.split(/\s+/).filter(Boolean)
    const empresas = (clientes || [])
      .map(c => {
        const nome = semAcento(c.nome)
        const doc = soDigitos(c.cnpj || c.cpf)
        const porNome = palavras.every(p => nome.includes(p))
        const porDoc = dig.length >= 3 && doc.includes(dig)
        if (!porNome && !porDoc) return null
        // começa com o termo vem antes
        const peso = nomeEmpresa(nome).startsWith(t) ? 0 : porDoc && doc.startsWith(dig) ? 1 : 2
        return { c, peso }
      })
      .filter(Boolean)
      .sort((a, b) => a.peso - b.peso || String(a.c.nome).localeCompare(String(b.c.nome)))
      .slice(0, MAX_EMPRESAS)
      .map(x => x.c)
    return { telas, empresas }
  }, [termo, clientes])
  // empresas primeiro quando o termo bate com empresa e com poucas telas
  const itens = useMemo(() => [
    ...empresas.map(c => ({ tipo: 'empresa', c })),
    ...telas.map(i => ({ tipo: 'tela', i })),
  ], [telas, empresas])
  useEffect(() => {
    listaRef.current?.querySelector('.destaque')?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  if (!aberta) return null
  const escolher = (item, cadastro = false) => {
    if (!item) return
    onFechar()
    if (item.tipo === 'tela') onNavigate(item.i.id)
    else if (cadastro) onAbrirCadastro?.(item.c.id)
    else onAbrirEmpresa?.(item.c.id)
  }
  const tecla = (e) => {
    if (e.key === 'Escape') onFechar()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, itens.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(itens[sel], e.shiftKey) }
  }
  return (
    <div className="busca-fundo" onMouseDown={onFechar}>
      <div className="busca-caixa" role="dialog" aria-label="Buscar tela ou empresa" onMouseDown={e => e.stopPropagation()}>
        <label className="busca-campo">
          <SearchIcon size={18} />
          <input ref={inputRef} value={termo} onChange={e => { setTermo(e.target.value); setSel(0) }} onKeyDown={tecla}
            placeholder="Tela ou empresa… (ex.: fechamento, notas, nome ou CNPJ)" aria-label="Buscar tela ou empresa" />
          <kbd>Esc</kbd>
        </label>
        <div className="busca-lista" role="menu" ref={listaRef}>
          {itens.length === 0 && <p className="busca-vazio">Nenhuma tela ou empresa com esse nome.</p>}
          {empresas.length > 0 && <span className="busca-secao">Empresas</span>}
          {empresas.map((c, idx) => (
            <div key={c.id} className={`menu-item busca-empresa ${idx === sel ? 'destaque' : ''}`} role="menuitem" tabIndex={-1}
              onClick={() => escolher({ tipo: 'empresa', c })} onMouseEnter={() => setSel(idx)}>
              <span className="menu-item-icone"><Building2Icon size={18} /></span>
              <span className="menu-item-textos">
                <span className="menu-item-nome">{nomeEmpresa(c.nome)}</span>
                <span className="menu-item-desc">{[c.cnpj || c.cpf, c.regime].filter(Boolean).join(' · ') || 'Empresa'}</span>
              </span>
              <button type="button" className="busca-acao" title="Abrir o cadastro (Shift+Enter)"
                onClick={(e) => { e.stopPropagation(); escolher({ tipo: 'empresa', c }, true) }}>
                Cadastro
              </button>
              <span className="busca-acao busca-acao-principal" title="Abrir no Fechamento (Enter)">Fechamento</span>
            </div>
          ))}
          {empresas.length > 0 && telas.length > 0 && <span className="busca-secao">Telas</span>}
          {telas.map((i, idx) => (
            <ItemMenu key={i.id} item={{ ...i, desc: `${i.grupo} · ${i.desc}` }} badge={badges[i.id]} destaque={empresas.length + idx === sel}
              onClick={() => escolher({ tipo: 'tela', i })} />
          ))}
        </div>
        <div className="busca-rodape">
          <span><kbd>↑</kbd><kbd>↓</kbd> escolher</span>
          <span><kbd>Enter</kbd> abrir</span>
          {empresas.length > 0 && <span><kbd>Shift</kbd>+<kbd>Enter</kbd> cadastro da empresa</span>}
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
