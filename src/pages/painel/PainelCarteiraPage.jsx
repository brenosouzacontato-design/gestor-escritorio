import { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseIcon, SearchIcon, ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, Share2Icon, CopyIcon, CheckIcon, Building2Icon,
  MonitorIcon, ClipboardListIcon,
} from 'lucide-react';
import PainelCompartilhadoPage from './PainelCompartilhadoPage';
import { listarEmpresasCarteira } from './carteiraApi';
import { useTrabalhoCarteira, TrabalhoEmpresaCarteira, QuadroCarteira } from './TrabalhoCarteira';
import { urlPublica } from '../../lib/linksPublicos';

// Página do link da carteira (?carteira=<token>) — pra pessoa responsável
// pela carteira, sem login: lista as empresas da carteira e abre o painel de
// cada uma (o mesmo que o cliente vê), com atalho pra mandar o link daquela
// empresa pro cliente. Nada aqui conta como visita/download do cliente
// (PainelCompartilhadoPage com semRegistro). Lista vem da RPC carteira_painel
// (supabase-schema-painel-carteira.sql); "chave" é o token do painel da
// empresa (ou o id, antes do passo 1 do RLS) — a mesma que vai no link do cliente.

const nomeCurto = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '');
const normalizar = (t) => (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// mesmo padrão do gestor (store/index.js): mês anterior
function competenciaPadrao() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function ultimasCompetencias(n = 12) {
  const lista = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    lista.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    d.setMonth(d.getMonth() - 1);
  }
  return lista;
}

export default function PainelCarteiraPage({ token, competencia: competenciaDoLink, empresaInicial }) {
  const [empresas, setEmpresas] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [competencia, setCompetencia] = useState(competenciaDoLink || competenciaPadrao());
  const [selecionada, setSelecionada] = useState(empresaInicial || null); // chave da empresa aberta
  const [copiado, setCopiado] = useState(false);
  // dentro de uma empresa: o painel do cliente ou as tarefas/obrigações dela
  const [abaEmpresa, setAbaEmpresa] = useState('painel');
  // tarefas, obrigações e anexos de todas as empresas da carteira (carteira-acao)
  const trabalho = useTrabalhoCarteira(token, competencia);

  useEffect(() => {
    listarEmpresasCarteira(token)
      .then((lista) => {
        if (lista.length === 0) setErro('Link inválido ou expirado. Peça um link novo ao escritório.');
        setEmpresas(lista);
      })
      .catch((e) => setErro(e.message));
  }, [token]);

  // empresa aberta fica na URL: F5 / voltar do navegador mantêm a posição
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selecionada) url.searchParams.set('empresa', selecionada); else url.searchParams.delete('empresa');
    window.history.replaceState(null, '', url);
    window.scrollTo(0, 0);
    setCopiado(false);
  }, [selecionada]);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return (empresas || []).filter((e) => !termo || normalizar(`${e.nome} ${e.cnpj || ''}`).includes(termo));
  }, [empresas, busca]);

  const carteira = empresas?.[0]?.carteira;
  const indice = (empresas || []).findIndex((e) => e.chave === selecionada);
  const atual = indice >= 0 ? empresas[indice] : null;

  const linkCliente = (e) => urlPublica({ painel: e.chave, competencia });
  const enviarAoCliente = (e) => {
    const mensagem = `Olá! Seguem os impostos e as pendências fiscais de ${nomeCurto(e.nome)} — competência ${competencia}:\n${linkCliente(e)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  };
  const copiarLink = async (e) => {
    try {
      await navigator.clipboard.writeText(linkCliente(e));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      window.prompt('Copie o link do cliente:', linkCliente(e));
    }
  };

  if (erro) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 14 }}>{erro}</div>;
  }
  if (!empresas) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Carregando...</div>;
  }

  // ── Painel de uma empresa ──
  if (atual) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', padding: '12px 12px 0' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: '10px 12px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setSelecionada(null)} style={botaoBarra} title="Voltar à lista de empresas">
                <ArrowLeftIcon size={15} /> <span>Empresas</span>
              </button>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(atual.nome)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)' }}>{indice + 1} de {empresas.length} · carteira {carteira}</div>
              </div>
              <button type="button" onClick={() => setSelecionada(empresas[indice - 1]?.chave)} disabled={indice <= 0} style={botaoSeta} title="Empresa anterior">
                <ChevronLeftIcon size={16} />
              </button>
              <button type="button" onClick={() => setSelecionada(empresas[indice + 1]?.chave)} disabled={indice >= empresas.length - 1} style={botaoSeta} title="Próxima empresa">
                <ChevronRightIcon size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => enviarAoCliente(atual)}
                style={{ ...botaoAcao, background: 'var(--ok)', color: '#fff', border: 'none' }}>
                <Share2Icon size={13} /> Enviar ao cliente
              </button>
              <button type="button" onClick={() => copiarLink(atual)} style={botaoAcao}>
                {copiado ? <><CheckIcon size={13} /> Copiado</> : <><CopyIcon size={13} /> Copiar link do cliente</>}
              </button>
            </div>
            <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 2 }}>
              {[['painel', 'Painel do cliente', MonitorIcon], ['trabalho', 'Tarefas e obrigações', ClipboardListIcon]].map(([id, label, Icone]) => {
                const pendentes = id === 'trabalho' ? trabalho.itens.filter((i) => i.clienteId === atual.id && !i.concluido).length : 0;
                return (
                  <button key={id} type="button" onClick={() => setAbaEmpresa(id)}
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, border: 'none', borderRadius: 6,
                      padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      background: abaEmpresa === id ? 'var(--navy)' : 'transparent', color: abaEmpresa === id ? '#fff' : 'var(--text2)' }}>
                    <Icone size={13} /> {label}
                    {pendentes > 0 && <span style={{ fontSize: 10, borderRadius: 99, padding: '0 6px', background: abaEmpresa === id ? 'rgba(255,255,255,.2)' : 'var(--warn-dim)', color: abaEmpresa === id ? '#fff' : 'var(--warn)' }}>{pendentes}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {abaEmpresa === 'trabalho'
          ? <TrabalhoEmpresaCarteira trabalho={trabalho} empresa={atual} />
          : <PainelCompartilhadoPage key={`${atual.chave}-${competencia}`} clienteId={atual.chave} competencia={competencia} semRegistro />}
      </div>
    );
  }

  // situação de cada empresa nos cards (vencidas / a fazer)
  const resumoEmpresa = (id) => {
    const abertos = trabalho.itens.filter((i) => i.clienteId === id && !i.concluido);
    return { vencidas: abertos.filter((i) => i.vencido).length, aFazer: abertos.filter((i) => !i.vencido).length };
  };
  const abrirEmpresaPorId = (empresa) => {
    const e = empresas.find((x) => x.id === empresa.id);
    if (e) { setAbaEmpresa('trabalho'); setSelecionada(e.chave); }
  };

  // ── Lista das empresas da carteira ──
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '20px 12px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'var(--navy)', borderRadius: 'var(--r-xl)', padding: '18px 20px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            <BriefcaseIcon size={13} /> Carteira
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{carteira}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--navy-text)' }}>{empresas.length} empresa{empresas.length !== 1 ? 's' : ''} · toque numa empresa pra ver o painel</span>
            <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              style={{ width: 'auto', fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, padding: '5px 8px', fontWeight: 600 }}>
              {ultimasCompetencias().map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px' }}>
          <SearchIcon size={15} color="var(--text3)" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa por nome ou CNPJ..."
            style={{ border: 'none', outline: 'none', background: 'none', fontSize: 14, padding: 0, width: '100%', color: 'var(--text1)' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {filtradas.map((e) => (
            <div key={e.chave} onClick={() => setSelecionada(e.chave)} role="button" tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === 'Enter') setSelecionada(e.chave); }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 12px 10px',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Building2Icon size={16} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', lineHeight: 1.25 }}>{nomeCurto(e.nome)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{[e.cnpj, e.regime].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              {trabalho.dados && (() => {
                const r = resumoEmpresa(e.id);
                return (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {r.vencidas > 0 && <span style={{ ...selo, background: 'var(--danger-dim)', color: 'var(--danger)' }}>{r.vencidas} vencida{r.vencidas !== 1 ? 's' : ''}</span>}
                    {r.aFazer > 0 && <span style={{ ...selo, background: 'var(--warn-dim)', color: 'var(--warn)' }}>{r.aFazer} a fazer</span>}
                    {r.vencidas === 0 && r.aFazer === 0 && <span style={{ ...selo, background: 'var(--ok-dim)', color: 'var(--ok)' }}>tudo em dia</span>}
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ ...botaoAcao, flex: 1, background: 'var(--navy)', color: '#fff', border: 'none' }}>Ver painel</span>
                <button type="button" title="Enviar o link do painel ao cliente pelo WhatsApp"
                  onClick={(ev) => { ev.stopPropagation(); enviarAoCliente(e); }}
                  style={{ ...botaoAcao, flex: 'none', padding: '0 10px', background: 'var(--ok-dim)', color: 'var(--ok)', border: 'none' }}>
                  <Share2Icon size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {filtradas.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 20 }}>Nenhuma empresa encontrada.</div>}
      </div>

      {/* Tarefas e obrigações de todas as empresas, por coluna — mais largo que a lista */}
      <div style={{ maxWidth: 1100, margin: '20px auto 0' }}>
        <QuadroCarteira trabalho={trabalho} competencia={competencia} onAbrirEmpresa={abrirEmpresaPorId} />
      </div>
    </div>
  );
}

const botaoBarra = {
  display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)', fontSize: 12, fontWeight: 600, flexShrink: 0,
};
const botaoSeta = {
  width: 32, height: 32, borderRadius: 8, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)',
};
const selo = { fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '1px 8px' };
const botaoAcao = {
  flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 32, borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)', fontSize: 12, fontWeight: 700,
};
