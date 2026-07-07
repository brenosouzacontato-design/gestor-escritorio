import { useState } from 'react'
import { ExternalLinkIcon, SearchIcon, MonitorIcon, FolderIcon, FileTextIcon } from 'lucide-react'

const PROJECTS = [
  {
    name: 'Gestor Escritório Contábil',
    desc: 'Clientes, obrigações, kanban e automação WhatsApp via Evolution API',
    cat: 'Breno Contador',
    status: 'online',
    url: 'https://gestorcount.netlify.app',
    tech: 'React + Supabase',
    emoji: '📊',
  },
  {
    name: 'Conciliador Bancário',
    desc: 'Extração de extratos via IA, DRE Gerencial e export OneFlow',
    cat: 'Breno Contador',
    status: 'local',
    url: 'http://localhost:8080/conciliador.html',
    tech: 'HTML + Claude Haiku',
    emoji: '💰',
  },
  {
    name: 'Painel PGDAS Carteira',
    desc: 'Análise do portfólio Simples Nacional — Alertas, Economia, Ranking',
    cat: 'Breno Contador',
    status: 'local',
    url: 'http://localhost:8080/painel_pgdas_carteira.html',
    tech: 'HTML + Claude Haiku',
    emoji: '📈',
  },
  {
    name: 'eCAC Scraper',
    desc: 'Extração automatizada de débitos dos ~30 clientes via certificado A1',
    cat: 'Breno Contador',
    status: 'local',
    url: '',
    tech: 'Python + Selenium',
    emoji: '🤖',
  },
  {
    name: 'Bot de Notícias Contábeis',
    desc: 'RSS + Claude Haiku — top 7 notícias diárias via WhatsApp',
    cat: 'Breno Contador',
    status: 'local',
    url: '',
    tech: 'Python + Evolution API',
    emoji: '📰',
  },
  {
    name: 'NFS-e Odontologia',
    desc: 'Emissão em lote de NFS-e para Simple Care via automação de browser',
    cat: 'Breno Contador',
    status: 'local',
    url: 'http://localhost:4321',
    tech: 'Node + Playwright',
    emoji: '🦷',
  },
  {
    name: 'Captura NF-e SEFAZ',
    desc: 'Proxy Flask + painel para captura via DistDFeInt com certif. A1',
    cat: 'Breno Contador',
    status: 'local',
    url: '',
    tech: 'Python Flask + HTML',
    emoji: '📥',
  },
  {
    name: 'Painel Tributário 3 Empresas',
    desc: 'Kamecase, YOW/Lidiane e Sandes Car — comparativo de regimes',
    cat: 'Breno Contador',
    status: 'local',
    url: 'http://localhost:8080/painel_tributario.html',
    tech: 'HTML + Chart.js',
    emoji: '⚖️',
  },
  {
    name: 'Painel Sandes Car',
    desc: 'Fator R, limiar de folha, Anexo III vs V e impacto CCT 2025/2026',
    cat: 'Breno Contador',
    status: 'local',
    url: 'http://localhost:8080/painel_sandes_car.html',
    tech: 'HTML + Chart.js',
    emoji: '🚗',
  },
  {
    name: 'Gerador de Contratos JUCEMG',
    desc: 'Alteração Contratual Ltda. — 11 tipos de evento, MEI→Ltda',
    cat: 'Breno Contador',
    status: 'draft',
    url: '',
    tech: 'React Artifact',
    emoji: '📜',
  },
  {
    name: 'Simulador Reforma Tributária',
    desc: 'LC 214/2025 — IBS/CBS, Split Payment, projeções 2026–2033',
    cat: 'Breno Contador',
    status: 'draft',
    url: '',
    tech: 'HTML + Claude API',
    emoji: '🧮',
  },
  {
    name: 'Memorial Ribeirao Materiais',
    desc: 'LP vs SN 2022, inaptidão CNPJ 08.346.664/0001-19, EFD-Contribuições',
    cat: 'Breno Contador',
    status: 'draft',
    url: '',
    tech: 'DOCX + HTML',
    emoji: '🧱',
  },
  {
    name: 'Central Inteligência Contábil',
    desc: 'DRE, Balanço Patrimonial e DFC — tema escuro, demo SAM Multi',
    cat: 'Nexpe',
    status: 'local',
    url: 'http://localhost:8080/central_nexpe.html',
    tech: 'HTML',
    emoji: '🧠',
  },
  {
    name: 'ExtratoXLS',
    desc: 'Conversão de extratos PDF → Excel via Claude API',
    cat: 'Nexpe',
    status: 'local',
    url: 'http://localhost:8080/extratoxls.html',
    tech: 'HTML + SheetJS',
    emoji: '📋',
  },
  {
    name: 'ContaFlow (Lovable)',
    desc: 'SaaS contábil multi-empresa — kanban, WhatsApp, Supabase',
    cat: 'Nexpe',
    status: 'online',
    url: '',
    tech: 'React + Supabase',
    emoji: '🌊',
  },
]

const CATS = ['Todos', ...[...new Set(PROJECTS.map(p => p.cat))]]

const STATUS_LABEL = { online: 'Online', local: 'Local', draft: 'Rascunho' }
const STATUS_STYLE = {
  online: { background: 'var(--success-bg, #f0fdf4)', color: 'var(--success, #16a34a)' },
  local:  { background: 'rgba(234,179,8,0.12)',        color: '#a16207' },
  draft:  { background: 'var(--surface-2, #f5f5f5)',   color: 'var(--text-muted)' },
}

export default function Central() {
  const [tab, setTab]       = useState('Todos')
  const [query, setQuery]   = useState('')

  const filtered = PROJECTS.filter(p => {
    const matchTab = tab === 'Todos' || p.cat === tab
    const q = query.toLowerCase()
    const matchQ = !q || [p.name, p.desc, p.tech, p.cat].some(s => s.toLowerCase().includes(q))
    return matchTab && matchQ
  })

  const byCat = {}
  filtered.forEach(p => {
    if (!byCat[p.cat]) byCat[p.cat] = []
    byCat[p.cat].push(p)
  })

  const total  = PROJECTS.length
  const online = PROJECTS.filter(p => p.status === 'online').length
  const local  = PROJECTS.filter(p => p.status === 'local').length
  const draft  = PROJECTS.filter(p => p.status === 'draft').length

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Central de Projetos</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Todos os apps, ferramentas e sistemas do escritório
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { n: total,  l: 'projetos' },
          { n: online, l: 'online'   },
          { n: local,  l: 'locais'   },
          { n: draft,  l: 'rascunhos'},
        ].map(s => (
          <div key={s.l} style={{ background: 'var(--surface-1)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{s.n}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <SearchIcon size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar projeto, app ou ferramenta…"
          style={{
            width: '100%', padding: '8px 12px 8px 34px',
            border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--surface-1)', color: 'var(--text)',
            fontSize: 14, fontFamily: 'inherit', outline: 'none',
          }}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {CATS.map(c => (
          <button
            key={c}
            onClick={() => setTab(c)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${c === tab ? 'var(--accent, #2563EB)' : 'var(--border)'}`,
              background: c === tab ? 'rgba(37,99,235,0.08)' : 'transparent',
              color: c === tab ? 'var(--accent, #2563EB)' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}
          >{c}</button>
        ))}
      </div>

      {/* Cards */}
      {Object.keys(byCat).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: 14 }}>
          Nenhum projeto encontrado
        </div>
      ) : (
        Object.entries(byCat).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{cat}</span>
              <span style={{ fontSize: 11, background: 'var(--surface-2)', color: 'var(--text-muted)', borderRadius: 20, padding: '1px 8px', border: '1px solid var(--border)' }}>{items.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px,1fr))', gap: 10 }}>
              {items.map(p => (
                <div
                  key={p.name}
                  onClick={() => p.url && window.open(p.url, '_blank')}
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 14,
                    cursor: p.url ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'border-color 0.15s',
                    opacity: p.url ? 1 : 0.8,
                  }}
                  onMouseEnter={e => { if (p.url) e.currentTarget.style.borderColor = 'var(--border-strong, #aaa)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <span style={{ fontSize: 22 }}>{p.emoji}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, ...STATUS_STYLE[p.status] }}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>{p.desc}</div>
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.tech}</span>
                    {p.url
                      ? <span style={{ fontSize: 11, color: 'var(--accent, #2563EB)', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLinkIcon size={11} /> abrir</span>
                      : <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— sem link</span>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
