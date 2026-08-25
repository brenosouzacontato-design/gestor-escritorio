import { useState, useEffect, useMemo } from 'react';
import { RefreshCwIcon, InfoIcon, ChevronDownIcon, ChevronRightIcon, ArrowDownCircleIcon, ArrowUpCircleIcon, FileEditIcon, CheckCircleIcon, SearchIcon, AlertTriangleIcon, SparklesIcon, TrendingUpIcon } from 'lucide-react';
import { useStore } from '../../store';
import { listarDocumentosFiscais, obterUltimaSincronizacao, sincronizarDocumentosFiscaisAgora, obterEvolucaoMensal } from '../contabil/documentosFiscaisApi';
import GerarLancamentoModal from '../contabil/GerarLancamentoModal';
import { useToast } from '../../components/shared';

const JANELA_NOVAS_MS = 24 * 60 * 60 * 1000; // documento "novo" = sincronizado nas últimas 24h

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function fmtDataHora(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function competenciaAtual() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function ehRecente(sincronizadoEm) {
  if (!sincronizadoEm) return false;
  return Date.now() - new Date(sincronizadoEm).getTime() < JANELA_NOVAS_MS;
}

// Visão geral de notas fiscais (entrada/saída) de TODAS as empresas numa
// competência — uma linha por empresa com os totais, expandível pra ver
// os documentos um a um. Complementa a aba "Notas Fiscais" de dentro do
// Financeiro (essa é por empresa já selecionada; essa aqui é o panorama
// do escritório inteiro antes de entrar em cada uma). Também mostra a
// evolução mensal e alerta sobre empresas sem nenhuma nota na competência
// e documentos sincronizados recentemente.
export default function NotasFiscaisPage() {
  const { show } = useToast();
  const clientes = useStore((s) => s.clientes);

  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [documentos, setDocumentos] = useState(null); // null = carregando
  const [erro, setErro] = useState(null);
  const [ultimaSinc, setUltimaSinc] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [busca, setBusca] = useState('');
  const [expandidos, setExpandidos] = useState(() => new Set());
  const [lancarDocumento, setLancarDocumento] = useState(null);
  const [evolucao, setEvolucao] = useState([]);

  const carregar = () => {
    listarDocumentosFiscais({ competencia })
      .then(setDocumentos)
      .catch((e) => setErro(e.message));
    obterUltimaSincronizacao().then(setUltimaSinc).catch(() => {});
    obterEvolucaoMensal(6).then(setEvolucao).catch(() => {});
  };

  useEffect(() => { carregar(); }, [competencia]);

  const sincronizarAgora = async () => {
    setSincronizando(true);
    try {
      const r = await sincronizarDocumentosFiscaisAgora();
      show?.(`Sincronizado: ${r.sincronizados}/${r.total} empresas${r.erros?.length ? `, ${r.erros.length} com erro` : ''}${r.motivo ? ` — ${r.motivo}` : ''}`);
      carregar();
    } catch (e) {
      show?.('Erro ao sincronizar: ' + e.message);
    }
    setSincronizando(false);
  };

  const porEmpresa = useMemo(() => {
    const grupos = new Map();
    (documentos || []).forEach((d) => {
      const chave = d.cliente_id;
      if (!grupos.has(chave)) {
        grupos.set(chave, { clienteId: chave, nome: d.clientes?.nome || 'Empresa sem nome', entradaQtd: 0, entradaValor: 0, saidaQtd: 0, saidaValor: 0, docs: [], temNova: false });
      }
      const g = grupos.get(chave);
      g.docs.push(d);
      if (ehRecente(d.sincronizado_em)) g.temNova = true;
      if (d.tipo_movimento === 'entrada') { g.entradaQtd++; g.entradaValor += Number(d.valor_total || 0); }
      else if (d.tipo_movimento === 'saida') { g.saidaQtd++; g.saidaValor += Number(d.valor_total || 0); }
    });
    return [...grupos.values()]
      .filter((g) => !busca.trim() || g.nome.toLowerCase().includes(busca.trim().toLowerCase()))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [documentos, busca]);

  const totalGeral = useMemo(() => porEmpresa.reduce((acc, g) => ({
    entradaQtd: acc.entradaQtd + g.entradaQtd, entradaValor: acc.entradaValor + g.entradaValor,
    saidaQtd: acc.saidaQtd + g.saidaQtd, saidaValor: acc.saidaValor + g.saidaValor,
  }), { entradaQtd: 0, entradaValor: 0, saidaQtd: 0, saidaValor: 0 }), [porEmpresa]);

  // Empresas ativas do escritório que não têm NENHUM documento fiscal
  // sincronizado nessa competência — sinal de que o cron/sync não achou
  // nada pra ela (ou ela genuinamente não teve movimento, mas vale olhar).
  const empresasSemNota = useMemo(() => {
    if (!documentos) return [];
    const comNota = new Set(documentos.map((d) => d.cliente_id));
    return clientes.filter((c) => !comNota.has(c.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [clientes, documentos]);

  const notasNovas = useMemo(() => (documentos || []).filter((d) => ehRecente(d.sincronizado_em)), [documentos]);

  const toggle = (clienteId) => setExpandidos((prev) => {
    const next = new Set(prev);
    if (next.has(clienteId)) next.delete(clienteId); else next.add(clienteId);
    return next;
  });

  return (
    <div className="page">
      <div className="section-hdr">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileEditIcon size={18} /> Notas Fiscais
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            Entradas e saídas de todas as empresas — clique numa linha pra ver os documentos.
          </p>
        </div>
      </div>

      <div className="notice notice-info" style={{ marginBottom: 12 }}>
        <InfoIcon size={14} />
        <span>
          {ultimaSinc ? `Última sincronização: ${fmtDataHora(ultimaSinc)}` : 'Ainda não sincronizado.'}
          {' '}— roda sozinho todo dia; se parar de atualizar, o token do OneFlow provavelmente venceu (Financeiro → Notas Fiscais → aviso igual esse).
        </span>
      </div>

      {notasNovas.length > 0 && (
        <div className="notice" style={{ marginBottom: 12, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <SparklesIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><strong>{notasNovas.length} nota{notasNovas.length !== 1 ? 's' : ''} nova{notasNovas.length !== 1 ? 's' : ''}</strong> sincronizada{notasNovas.length !== 1 ? 's' : ''} nas últimas 24h — marcadas com 🆕 nas empresas abaixo.</span>
        </div>
      )}

      {!erro && documentos && empresasSemNota.length > 0 && (
        <div className="notice" style={{ marginBottom: 12, background: 'var(--warn-dim)', color: 'var(--warn)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertTriangleIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{empresasSemNota.length} empresa{empresasSemNota.length !== 1 ? 's' : ''} sem nenhuma nota</strong> em {competencia}: {empresasSemNota.map((c) => c.nome).join(', ')}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
          style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, background: 'var(--surface)', color: 'var(--text1)' }}>
          {[0, 1, 2, 3].map((i) => {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const c = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            const label = i === 0 ? 'Competência atual' : i === 1 ? 'Competência anterior' : '';
            return <option key={c} value={c}>{label ? `${label} (${c})` : c}</option>;
          })}
        </select>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <SearchIcon size={14} color="var(--text3)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', fontSize: 12.5 }} />
        </div>
        <button className="btn btn-accent" onClick={sincronizarAgora} disabled={sincronizando}>
          <RefreshCwIcon size={14} className={sincronizando ? 'spinning' : ''} />
          {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </div>

      {porEmpresa.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              <ArrowDownCircleIcon size={12} color="var(--ok)" /> Entrada em {competencia}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text1)', marginTop: 5 }}>{fmt(totalGeral.entradaValor)}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalGeral.entradaQtd} documento{totalGeral.entradaQtd !== 1 ? 's' : ''}</div>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              <ArrowUpCircleIcon size={12} color="var(--info)" /> Saída em {competencia}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text1)', marginTop: 5 }}>{fmt(totalGeral.saidaValor)}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalGeral.saidaQtd} documento{totalGeral.saidaQtd !== 1 ? 's' : ''}</div>
          </div>
        </div>
      )}

      {evolucao.length > 1 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 10 }}>
            <TrendingUpIcon size={13} /> Evolução — entrada x saída
          </div>
          <GraficoEvolucao dados={evolucao} />
        </div>
      )}

      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}
      {!erro && documentos === null && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
      {!erro && documentos && porEmpresa.length === 0 && (
        <div className="empty">
          <p>🧾</p>
          Nenhum documento fiscal encontrado pra essa competência/busca.
        </div>
      )}

      {porEmpresa.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {porEmpresa.map((g) => {
            const aberto = expandidos.has(g.clienteId);
            return (
              <div key={g.clienteId} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <button onClick={() => toggle(g.clienteId)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  {aberto ? <ChevronDownIcon size={14} color="var(--text3)" /> : <ChevronRightIcon size={14} color="var(--text3)" />}
                  {g.temNova && <span title="Tem nota nova nas últimas 24h">🆕</span>}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.nome}</span>
                  <span style={{ fontSize: 12, color: 'var(--ok)', fontWeight: 700, whiteSpace: 'nowrap' }}>↓ {fmt(g.entradaValor)} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>({g.entradaQtd})</span></span>
                  <span style={{ fontSize: 12, color: 'var(--info)', fontWeight: 700, whiteSpace: 'nowrap' }}>↑ {fmt(g.saidaValor)} <span style={{ color: 'var(--text3)', fontWeight: 500 }}>({g.saidaQtd})</span></span>
                </button>

                {aberto && (
                  <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: 'var(--surface2)' }}>
                          <th style={thStyle}>Emissão</th>
                          <th style={thStyle}>Fornecedor/Cliente</th>
                          <th style={thStyle}>Modelo</th>
                          <th style={thStyle}>Número</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
                          <th style={thStyle}>Tipo</th>
                          <th style={thStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.docs.map((d) => (
                          <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                              {ehRecente(d.sincronizado_em) && <span title="Sincronizado nas últimas 24h" style={{ marginRight: 4 }}>🆕</span>}
                              {fmtData(d.data_emissao)}
                            </td>
                            <td style={tdStyle}>{d.razao_social_terceiro || '—'}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{d.modelo || '—'}</td>
                            <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{d.numero}{d.serie ? `/${d.serie}` : ''}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(d.valor_total)}</td>
                            <td style={tdStyle}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
                                color: d.tipo_movimento === 'entrada' ? 'var(--ok)' : 'var(--info)',
                                background: d.tipo_movimento === 'entrada' ? 'var(--ok-dim)' : 'var(--info-dim)',
                                borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                                {d.tipo_movimento === 'entrada' ? <ArrowDownCircleIcon size={11} /> : <ArrowUpCircleIcon size={11} />}
                                {d.tipo_movimento === 'entrada' ? 'Entrada' : d.tipo_movimento === 'saida' ? 'Saída' : '—'}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                              {d.lancamento_id ? (
                                <span title="Já tem lançamento gerado" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--ok)' }}>
                                  <CheckCircleIcon size={13} /> Lançado
                                </span>
                              ) : (
                                <button onClick={() => setLancarDocumento(d)} title="Gerar lançamento contábil"
                                  style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 26, height: 26,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
                                  <FileEditIcon size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lancarDocumento && (
        <GerarLancamentoModal documento={lancarDocumento} onClose={() => setLancarDocumento(null)} onGerado={carregar} />
      )}

      <style>{`.spinning { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' };
const tdStyle = { padding: '8px 12px' };

// Gráfico de barras agrupadas (entrada x saída por competência) — SVG à
// mão, mesmo estilo do gráfico de faturamento do Painel do cliente.
// Margem no topo evita o rótulo do valor da barra mais alta sair do
// desenho (mesmo bug já corrigido lá).
function GraficoEvolucao({ dados }) {
  const max = Math.max(...dados.flatMap((d) => [d.entrada, d.saida]), 1);
  const larguraBarra = 20, gapBarras = 4, gapGrupos = 22, altura = 100;
  const margemTopo = 16, margemBaixo = 20;
  const larguraGrupo = larguraBarra * 2 + gapBarras;
  const larguraTotal = dados.length * (larguraGrupo + gapGrupos);
  const alturaSvg = altura + margemTopo + margemBaixo;
  const yBase = margemTopo + altura;

  const fmtCurto = (v) => {
    if (v >= 1000000) return `${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
    if (v >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${larguraTotal} ${alturaSvg}`} width="100%" height={alturaSvg} style={{ minWidth: larguraTotal, display: 'block' }}>
        {dados.map((d, i) => {
          const alturaEntrada = max > 0 ? Math.max((d.entrada / max) * altura, d.entrada > 0 ? 2 : 0) : 0;
          const alturaSaida = max > 0 ? Math.max((d.saida / max) * altura, d.saida > 0 ? 2 : 0) : 0;
          const x = i * (larguraGrupo + gapGrupos);
          const [mes, ano] = d.competencia.split('/');
          return (
            <g key={d.competencia}>
              {d.entrada > 0 && (
                <text x={x + larguraBarra / 2} y={yBase - alturaEntrada - 6} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--ok)">
                  {fmtCurto(d.entrada)}
                </text>
              )}
              <rect x={x} y={yBase - alturaEntrada} width={larguraBarra} height={alturaEntrada} rx="3" fill="var(--ok)" />
              {d.saida > 0 && (
                <text x={x + larguraBarra + gapBarras + larguraBarra / 2} y={yBase - alturaSaida - 6} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--info)">
                  {fmtCurto(d.saida)}
                </text>
              )}
              <rect x={x + larguraBarra + gapBarras} y={yBase - alturaSaida} width={larguraBarra} height={alturaSaida} rx="3" fill="var(--info)" />
              <text x={x + larguraGrupo / 2} y={yBase + 16} textAnchor="middle" fontSize="10" fill="var(--text3)">
                {mes}/{ano.slice(2)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--ok)', display: 'inline-block' }} /> Entrada</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--info)', display: 'inline-block' }} /> Saída</span>
      </div>
    </div>
  );
}
