import { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseIcon, SearchIcon, ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, Share2Icon, CopyIcon, CheckIcon, Building2Icon,
  MonitorIcon, ClipboardListIcon, ActivityIcon, SendIcon, EyeIcon, FileTextIcon,
} from 'lucide-react';
import PainelCompartilhadoPage from './PainelCompartilhadoPage';
import { listarEmpresasCarteira, abrirAnexoCarteira } from './carteiraApi';
import { useTrabalhoCarteira, TrabalhoEmpresaCarteira, QuadroCarteira } from './TrabalhoCarteira';
import { urlPublica } from '../../lib/linksPublicos';
import { STATUS_ENTREGA, statusEntregaEmpresa } from '../../lib/entregaCarteira';
import { trilhaEmpresa, guiasPorEmpresa, situacaoEntregaGuia } from '../../lib/trilhaFechamento';
import TrilhaProgresso, { COR_ROXO } from '../../components/TrilhaProgresso';
import { useTelaNoHistorico } from '../../lib/historico';

// Página do link da carteira (?carteira=<token>) — pra pessoa responsável
// pela carteira, sem login: lista as empresas da carteira e abre o painel de
// cada uma (o mesmo que o cliente vê), com atalho pra mandar o link daquela
// empresa pro cliente. Nada aqui conta como visita/download do cliente
// (PainelCompartilhadoPage com semRegistro). Lista vem da RPC carteira_painel
// (supabase-schema-painel-carteira.sql); "chave" é o token do painel da
// empresa (ou o id, antes do passo 1 do RLS) — a mesma que vai no link do cliente.

// Página de trabalho do escritório (não do cliente): usa a largura da tela,
// até esse limite, em vez da faixa estreita de 720px do painel do cliente.
const LARGURA = 1400;

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
  const [filtroEtapa, setFiltroEtapa] = useState(null); // etapa do funil escolhida (id de FUNIL)
  const [visao, setVisao] = useState(() => { try { return localStorage.getItem('carteira-visao') || 'progresso'; } catch { return 'progresso'; } });
  const [competencia, setCompetencia] = useState(competenciaDoLink || competenciaPadrao());
  // empresa aberta (chave) e, dentro dela, o painel do cliente ou as
  // tarefas/obrigações — no histórico do navegador (voltar retorna à tela
  // anterior) e na URL (&empresa=, F5 mantém a posição)
  const [tela, irPara] = useTelaNoHistorico('carteira', { empresa: empresaInicial || null, aba: 'painel' },
    { paramsUrl: (t) => ({ empresa: t.empresa }) });
  const selecionada = tela.empresa;
  const abaEmpresa = tela.aba;
  const setSelecionada = (chave) => irPara((t) => ({ ...t, empresa: chave || null }));
  const setAbaEmpresa = (aba) => irPara((t) => ({ ...t, aba }));
  const [copiado, setCopiado] = useState(false);
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

  useEffect(() => { setCopiado(false); }, [selecionada]);

  // status de entrega na competência (o mesmo do Fechamento do escritório)
  const entregaDe = (id) => statusEntregaEmpresa(id, competencia, trabalho.dados?.obrigacoes || [], trabalho.dados?.entregas || []);
  // trilha de progresso de cada empresa (mesma do Fechamento do gestor)
  const trilhas = useMemo(() => {
    if (!trabalho.dados) return {};
    const porEmpresa = guiasPorEmpresa(trabalho.dados.guias || []);
    const mapa = {};
    for (const e of empresas || []) {
      const marca = (trabalho.dados.entregas || []).find((x) => x.cliente_id === e.id);
      mapa[e.id] = trilhaEmpresa({
        obrigacoes: (trabalho.dados.obrigacoes || []).filter((o) => o.cliente_id === e.id && o.competencia === competencia),
        guias: porEmpresa[e.id] || [],
        marcadoConcluido: !!marca?.entregue,
        aguardando: !!marca?.aguardando_cliente,
      });
    }
    return mapa;
  }, [trabalho.dados, empresas, competencia]);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    const etapa = FUNIL.find((f) => f.id === filtroEtapa);
    return (empresas || []).filter((e) => (!termo || normalizar(`${e.nome} ${e.cnpj || ''}`).includes(termo))
      && (!etapa || (trilhas[e.id] && etapa.teste(trilhas[e.id]))));
  }, [empresas, busca, filtroEtapa, trilhas]);

  const escolherVisao = (v) => { setVisao(v); try { localStorage.setItem('carteira-visao', v); } catch { /* sem storage */ } };

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
        <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg)', padding: '12px 16px 0' }}>
          <div style={{ maxWidth: LARGURA, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: '10px 12px', boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => setSelecionada(null)} style={botaoBarra} title="Voltar à lista de empresas">
                <ArrowLeftIcon size={15} /> <span>Empresas</span>
              </button>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(atual.nome)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>{indice + 1} de {empresas.length} · carteira {carteira}</span>
                  {trabalho.dados && <SeloEntrega info={entregaDe(atual.id)} competencia={competencia} />}
                </div>
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
          : <PainelCompartilhadoPage key={`${atual.chave}-${competencia}`} clienteId={atual.chave} competencia={competencia} semRegistro largura={LARGURA} />}
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
    if (e) irPara({ empresa: e.chave, aba: 'trabalho' });
  };

  // ── Lista das empresas da carteira ──
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '20px 16px' }}>
      <div style={{ maxWidth: LARGURA, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          {trabalho.dados && <Funil empresas={empresas} trilhas={trilhas} filtro={filtroEtapa} onFiltro={setFiltroEtapa} />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 12px' }}>
            <SearchIcon size={15} color="var(--text3)" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa por nome ou CNPJ..."
              style={{ border: 'none', outline: 'none', background: 'none', fontSize: 14, padding: 0, width: '100%', color: 'var(--text1)' }} />
          </div>
          <div role="group" aria-label="Visão" style={{ display: 'flex', gap: 6 }}>
            {[['progresso', 'Progresso', ActivityIcon], ['entregas', 'Entregas', SendIcon]].map(([id, label, Icone]) => (
              <button key={id} type="button" onClick={() => escolherVisao(id)} aria-pressed={visao === id}
                style={{ ...botaoBarra, height: 38, padding: '0 14px', background: visao === id ? 'var(--navy)' : 'var(--surface)', color: visao === id ? '#fff' : 'var(--text2)', borderColor: visao === id ? 'var(--navy)' : 'var(--border)' }}>
                <Icone size={14} /> {label}
              </button>
            ))}
          </div>
        </div>

        {!trabalho.dados && !trabalho.erro && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 20 }}>Carregando o andamento...</div>}
        {trabalho.erro && <div style={{ textAlign: 'center', color: 'var(--danger)', fontSize: 13, padding: 12 }}>{trabalho.erro}</div>}

        {trabalho.dados && visao === 'progresso' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtradas.map((e) => (
                <LinhaProgresso key={e.chave} empresa={e} trilha={trilhas[e.id]} guias={(trabalho.dados.guias || []).filter((g) => g.cliente_id === e.id)}
                  resumo={resumoEmpresa(e.id)} onAbrir={() => setSelecionada(e.chave)} onEnviar={() => enviarAoCliente(e)} />
              ))}
            </div>
          </div>
        )}

        {trabalho.dados && visao === 'entregas' && (
          <TabelaEntregas empresas={filtradas} guias={trabalho.dados.guias || []} token={token} onAbrir={(e) => setSelecionada(e.chave)} />
        )}

        {filtradas.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 20 }}>Nenhuma empresa encontrada.</div>}
      </div>

      {/* Tarefas e obrigações de todas as empresas, por coluna — mais largo que a lista */}
      <div style={{ maxWidth: LARGURA, margin: '20px auto 0' }}>
        <QuadroCarteira trabalho={trabalho} competencia={competencia} onAbrirEmpresa={abrirEmpresaPorId} />
      </div>
    </div>
  );
}

// Etapas do funil do topo (agrupam as 6 da trilha em 5 baldes)
const FUNIL = [
  { id: 'a_fazer', rotulo: 'A fazer', cor: '#A3A3A3', teste: (t) => t.etapa === 0 },
  { id: 'andamento', rotulo: 'Em andamento', cor: '#F59E0B', teste: (t) => t.etapa === 1 },
  { id: 'aguardando', rotulo: 'Aguardando cliente', cor: '#A78BFA', teste: (t) => t.etapa === 2 },
  { id: 'concluido', rotulo: 'Falta entregar', cor: '#4ADE80', teste: (t) => t.etapa === 3 },
  { id: 'entregue', rotulo: 'Entregue', cor: '#22C55E', teste: (t) => t.etapa >= 4 },
];

function Funil({ empresas, trilhas, filtro, onFiltro }) {
  const total = empresas.length || 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
      {FUNIL.map((f) => {
        const qtd = empresas.filter((e) => trilhas[e.id] && f.teste(trilhas[e.id])).length;
        const ativo = filtro === f.id;
        return (
          <button key={f.id} type="button" onClick={() => onFiltro(ativo ? null : f.id)} aria-pressed={ativo}
            title={ativo ? 'Mostrar todas as empresas' : `Mostrar só: ${f.rotulo.toLowerCase()}`}
            style={{ textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, color: '#fff',
              background: ativo ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)', border: `1px solid ${ativo ? f.cor : 'rgba(255,255,255,.12)'}` }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: f.cor, fontVariantNumeric: 'tabular-nums' }}>{qtd}</span>
            <span style={{ fontSize: 11, color: 'var(--navy-text)' }}>{f.rotulo}</span>
            <span style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${(qtd / total) * 100}%`, background: f.cor }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SITUACAO_GUIA = {
  a_entregar: { rotulo: 'A entregar', cor: 'var(--text2)', fundo: 'var(--surface2)' },
  entregue: { rotulo: 'Enviada', cor: 'var(--ok)', fundo: 'var(--ok-dim)' },
  falhou: { rotulo: 'Envio falhou', cor: 'var(--danger)', fundo: 'var(--danger-dim)' },
  aberta: { rotulo: 'Cliente abriu', cor: '#2563EB', fundo: 'rgba(37,99,235,.12)' },
};

// Uma empresa na visão Progresso: trilha + guias + atalhos (substitui o card)
function LinhaProgresso({ empresa, trilha, guias, resumo, onAbrir, onEnviar }) {
  if (!trilha) return null;
  const cor = trilha.vencidas > 0 && trilha.etapa < 3 ? 'var(--danger)' : trilha.aguardando ? COR_ROXO
    : trilha.etapa >= 3 ? 'var(--ok)' : trilha.etapa === 1 ? 'var(--warn)' : 'var(--border2)';
  return (
    <div onClick={onAbrir} role="button" tabIndex={0} onKeyDown={(ev) => { if (ev.key === 'Enter') onAbrir(); }}
      className="linha-progresso-carteira"
      style={{ cursor: 'pointer',
        background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `4px solid ${cor}`, borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Building2Icon size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div title={empresa.nome} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeCurto(empresa.nome)}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            {empresa.regime && <span style={{ ...selo, background: 'var(--surface2)', color: 'var(--text3)' }}>{empresa.regime}</span>}
            {resumo.vencidas > 0 && <span style={{ ...selo, background: 'var(--danger-dim)', color: 'var(--danger)' }}>{resumo.vencidas} vencida{resumo.vencidas !== 1 ? 's' : ''}</span>}
            {resumo.aFazer > 0 && <span style={{ ...selo, background: 'var(--warn-dim)', color: 'var(--warn)' }}>{resumo.aFazer} pendente{resumo.aFazer !== 1 ? 's' : ''}</span>}
          </div>
        </div>
      </div>
      <TrilhaProgresso trilha={trilha} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        {guias.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>Nenhuma guia anexada ainda</span>}
        {guias.slice(0, 3).map((g) => {
          const st = SITUACAO_GUIA[situacaoEntregaGuia(g)];
          return (
            <span key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minWidth: 0 }}>
              <span style={{ ...selo, background: st.fundo, color: st.cor, flexShrink: 0 }}>{st.rotulo}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>{g.titulo}</span>
            </span>
          );
        })}
        {guias.length > 3 && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>+{guias.length - 3} guia{guias.length - 3 !== 1 ? 's' : ''}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ ...botaoAcao, padding: '0 12px', background: 'var(--navy)', color: '#fff', border: 'none' }}>Ver painel</span>
        <button type="button" title="Enviar o link do painel ao cliente pelo WhatsApp"
          onClick={(ev) => { ev.stopPropagation(); onEnviar(); }}
          style={{ ...botaoAcao, flex: 'none', padding: '0 10px', background: 'var(--ok-dim)', color: 'var(--ok)', border: 'none' }}>
          <Share2Icon size={13} />
        </button>
      </div>
    </div>
  );
}

const fmtDia = (ts) => (ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const fmtHora = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// Visão Entregas: cada guia anexada da competência, como foi entregue pela
// Central de Entregas e se o cliente abriu pelo painel
function TabelaEntregas({ empresas, guias, token, onAbrir }) {
  const porId = new Map(empresas.map((e) => [e.id, e]));
  const linhas = guias.filter((g) => porId.has(g.cliente_id))
    .sort((a, b) => (porId.get(a.cliente_id).nome || '').localeCompare(porId.get(b.cliente_id).nome || '') || (a.titulo || '').localeCompare(b.titulo || ''));
  const th = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text3)', padding: '9px 12px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '9px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, verticalAlign: 'middle' };
  if (linhas.length === 0) {
    return <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>Nenhuma guia anexada nesta competência.</div>;
  }
  return (
    <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
        <thead><tr><th style={th}>Empresa</th><th style={th}>Guia</th><th style={th}>Vencimento</th><th style={th}>Entrega</th><th style={th}>Cliente</th><th style={th} /></tr></thead>
        <tbody>
          {linhas.map((g) => {
            const e = porId.get(g.cliente_id);
            const sit = situacaoEntregaGuia(g);
            const st = SITUACAO_GUIA[sit === 'aberta' ? 'entregue' : sit];
            const entrega = sit === 'a_entregar' ? 'A entregar'
              : sit === 'falhou' ? `Falhou${g.entrega_erro ? ` · ${String(g.entrega_erro).replace(/^\d{4}-\d{2}-\d{2}: /, '')}` : ''}`
              : `${g.entrega_canal === 'manual' ? 'Entregue por fora' : 'Enviada pelo WhatsApp'}${g.entregue_em ? ` · ${fmtDia(g.entregue_em)}` : ''}`;
            return (
              <tr key={g.id}>
                <td style={td}>
                  <button type="button" onClick={() => onAbrir(e)}
                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, color: 'var(--text1)', fontSize: 12, textAlign: 'left' }}>
                    {nomeCurto(e.nome)}
                  </button>
                </td>
                <td style={td}>{g.titulo}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{g.vencimento_guia ? new Date(`${String(g.vencimento_guia).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</td>
                <td style={td}><span title={g.entrega_erro || ''} style={{ ...selo, background: st.fundo, color: st.cor }}>{entrega}</span></td>
                <td style={td}>
                  {g.aberto_em
                    ? (
                      <span style={{ ...selo, display: 'inline-flex', alignItems: 'center', gap: 4, background: SITUACAO_GUIA.aberta.fundo, color: SITUACAO_GUIA.aberta.cor }}>
                        <EyeIcon size={11} /> Abriu{g.aberto_vezes > 1 ? ` ${g.aberto_vezes}×` : ''} · {fmtHora(g.aberto_ultimo_em || g.aberto_em)}
                      </span>
                    )
                    : <span style={{ fontSize: 11, color: 'var(--text3)' }}>ainda não abriu</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button type="button" onClick={() => abrirAnexoCarteira(token, g.id).catch((err) => window.alert(err.message))}
                    style={{ ...botaoAcao, flex: 'none', height: 28, padding: '0 10px', display: 'inline-flex' }}>
                    <FileTextIcon size={12} /> Ver guia
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Selo do status de entrega da competência (Entregue / Aguardando cliente /
// Em andamento 3/5 / A fazer)
function SeloEntrega({ info, competencia }) {
  const st = STATUS_ENTREGA[info.status];
  const contagem = info.total > 0 && info.status !== 'entregue' && info.status !== 'a_fazer' ? ` ${info.feitas}/${info.total}` : '';
  const quando = info.atualizadoEm ? ` · marcado em ${new Date(info.atualizadoEm).toLocaleDateString('pt-BR')}` : '';
  return (
    <span title={`Competência ${competencia}: ${info.feitas} de ${info.total} obrigações concluídas${quando}`}
      style={{ ...selo, background: st.fundo, color: st.cor, border: `1px solid ${st.cor}` }}>
      {info.status === 'entregue' ? '✓ ' : ''}{st.rotulo}{contagem}
    </span>
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
