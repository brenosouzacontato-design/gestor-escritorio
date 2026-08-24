import { useEffect, useState } from 'react';
import {
  WalletIcon, ClipboardListIcon, CheckSquareIcon, PaperclipIcon, BarChart3Icon,
  CalendarIcon, DownloadIcon, CheckCircleIcon, FileTextIcon, TrendingUpIcon, LayersIcon,
  AlertTriangleIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listarLancamentosAIdentificar } from '../contabil/contabilApi';
import LancamentosIdentificar from '../contabil/LancamentosIdentificar';
import { criarLinkAssinado } from '../documentos/documentosApi';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterResumoFinanceiro, obterDadosGerenciais,
  obterDocumentosDoMes, obterDocumentosPorObrigacao, obterSituacaoFiscal, obterHistoricoFaturamento, obterCndManual,
  obterPendenciasAnteriores, obterValoresDasPendencias, obterDocumentosFiscais,
} from './painelApi';

const RECEITA_TIPO_LABEL = { normal: 'Normal', st: 'Com ST', monofasico: 'Monofásico' };

const STATUS_OBS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_OBS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtPct(v) {
  return v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}
function fmtData(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Recalculado a cada carregamento da página a partir da data de hoje —
// não precisa de job/cron pra "atualizar diariamente", já nasce correto
// toda vez que alguém abre o link.
function diasParaVencer(vencimento) {
  if (!vencimento) return null;
  const hoje = new Date(new Date().toDateString());
  const venc = new Date(vencimento + 'T00:00:00');
  return Math.round((venc - hoje) / 86400000);
}
function fmtDiasParaVencer(dias) {
  if (dias == null) return null;
  if (dias === 0) return 'vence hoje';
  if (dias > 0) return `vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`;
}

// "MM/YYYY" -> primeiro/último dia do mês (formato usado por
// calcularDREPorConta/listarLancamentosAIdentificar, que trabalham com
// intervalo de datas, não competência-texto).
function competenciaParaPeriodo(competencia) {
  const [mes, ano] = competencia.split('/').map(Number);
  const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { dataInicio, dataFim };
}

// Agrupa as obrigações do mês por módulo (departamento) pra alimentar a
// fileira de cards "Módulos" no topo do painel — resumo rápido antes da
// lista detalhada mais embaixo. Obrigações sem departamento_id (modelo
// legado) caem num módulo "Geral".
function agruparPorModulo(itensObrigacoes) {
  const grupos = {};
  itensObrigacoes.forEach((o) => {
    const nome = o.departamentos?.nome || 'Geral';
    const icone = o.departamentos?.icone || '📋';
    if (!grupos[nome]) grupos[nome] = { nome, icone, itens: [] };
    grupos[nome].itens.push(o);
  });
  return Object.values(grupos).map((g) => {
    const ok = g.itens.filter((o) => o.status === 'concluido' || o.status === 'nao_aplica').length;
    const venc = g.itens.filter((o) => o.status === 'vencido').length;
    const pct = g.itens.length > 0 ? Math.round((ok / g.itens.length) * 100) : 0;
    const s = venc > 0 ? 'danger' : pct === 100 ? 'ok' : g.itens.some((o) => o.status === 'pendente') ? 'warn' : 'empty';
    return { nome: g.nome, icone: g.icone, s, pct, val: `${ok}/${g.itens.length}` };
  });
}

// CND (Certidão Negativa de Débitos) — módulo virtual que combina as 3
// esferas: federal (situacao_fiscal_rfb, extraído por IA), estadual e
// municipal (cnd_manual, marcação manual — layout de certidão varia
// demais entre estados/prefeituras pra automatizar). "Com CND" só se
// todas as esferas que têm dado estiverem regulares; "Sem CND" se
// qualquer uma estiver pendente; vazio se nenhuma tiver dado ainda.
function moduloCND(situacaoFiscal, cndManual) {
  const esferas = [
    situacaoFiscal?.situacao_geral,
    cndManual?.situacao_estadual,
    cndManual?.situacao_municipal,
  ].filter(Boolean);
  if (esferas.length === 0) return { nome: 'CND', icone: '🛡️', s: 'empty', pct: 0, val: '—' };
  if (esferas.some((s) => s === 'pendente')) return { nome: 'CND', icone: '🛡️', s: 'danger', pct: 0, val: 'Sem CND' };
  return { nome: 'CND', icone: '🛡️', s: 'ok', pct: 100, val: 'Com CND' };
}

// Página pública (sem login) com a visão consolidada do cliente naquela
// competência: financeiro, obrigações, tarefas, documentos, lançamentos a
// identificar (quando houver) e dados gerenciais do Simples Nacional
// (quando enviados). Acessada via ?painel=<clienteId>&competencia=MM/YYYY
// (ver main.jsx). Mesmo padrão visual de RelatorioCompartilhadoPage.jsx /
// IdentificarLancamentosPage.jsx.
export default function PainelClientePage({ clienteId, competencia }) {
  const [cliente, setCliente] = useState(null); // {nome, cnpj, regime, carteira}
  const [aba, setAba] = useState('resumo'); // 'resumo' | nome do módulo | 'cnd'
  const [obs, setObs] = useState(null);
  const [tarefas, setTarefas] = useState(null);
  const [financeiro, setFinanceiro] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [gerenciais, setGerenciais] = useState(null);
  const [historicoFaturamento, setHistoricoFaturamento] = useState([]);
  const [situacaoFiscal, setSituacaoFiscal] = useState(null);
  const [cndManual, setCndManual] = useState(null);
  const [pendenciasAnteriores, setPendenciasAnteriores] = useState({ obrigacoes: [], tarefas: [] });
  const [valoresDasPendencias, setValoresDasPendencias] = useState({}); // competencia -> valor_das, só das pendências que parecem DAS
  const [documentos, setDocumentos] = useState([]);
  const [documentosFiscais, setDocumentosFiscais] = useState([]);
  const [anexosObrigacao, setAnexosObrigacao] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const { dataInicio, dataFim } = competenciaParaPeriodo(competencia);
        const [{ data: clienteData, error: errCliente }, resObs, resTarefas, resFinanceiro, itensIdentificar, dadosSimples, historico, situFiscal, cndManualData, docs, pendenciasAnt, docsFiscais] = await Promise.all([
          supabase.from('clientes').select('nome, cnpj, regime, carteira').eq('id', clienteId).single(),
          obterResumoObrigacoes(clienteId, competencia),
          obterResumoTarefas(clienteId, competencia),
          obterResumoFinanceiro(clienteId, { dataInicio, dataFim }),
          listarLancamentosAIdentificar(clienteId, { dataInicio, dataFim }),
          // tabelas/colunas novas (dados_gerenciais_simples/situacao_fiscal_rfb/cnd_manual) —
          // toleram ainda não existir no banco (schema pendente de aplicar)
          // sem quebrar o resto do painel
          obterDadosGerenciais(clienteId, competencia).catch(() => null),
          obterHistoricoFaturamento(clienteId).catch(() => []),
          obterSituacaoFiscal(clienteId, competencia).catch(() => null),
          obterCndManual(clienteId, competencia).catch(() => null),
          obterDocumentosDoMes(clienteId, { dataInicio, dataFim }).catch(() => []),
          obterPendenciasAnteriores(clienteId, competencia).catch(() => ({ obrigacoes: [], tarefas: [] })),
          obterDocumentosFiscais(clienteId, competencia).catch(() => []),
        ]);
        if (errCliente) throw errCliente;
        setCliente(clienteData);
        setObs(resObs);
        setTarefas(resTarefas);
        setFinanceiro(resFinanceiro);
        setLancamentos(itensIdentificar);
        setGerenciais(dadosSimples);
        setHistoricoFaturamento(historico);
        setSituacaoFiscal(situFiscal);
        setCndManual(cndManualData);
        setDocumentos(docs);
        setPendenciasAnteriores(pendenciasAnt);
        setDocumentosFiscais(docsFiscais);
        const competenciasDas = [...new Set(
          pendenciasAnt.obrigacoes
            .filter((o) => `${o.titulo || ''} ${o.tipo || ''}`.toLowerCase().includes('das'))
            .map((o) => o.competencia)
        )];
        const valoresDas = await obterValoresDasPendencias(clienteId, competenciasDas).catch(() => ({}));
        setValoresDasPendencias(valoresDas);
        const anexos = await obterDocumentosPorObrigacao(resObs.itens.map((o) => o.id)).catch(() => ({}));
        setAnexosObrigacao(anexos);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [clienteId, competencia]);

  const baixarAnexo = async (documento) => {
    const url = await criarLinkAssinado(documento.storage_path).catch(() => null);
    if (url) window.open(url, '_blank');
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 26px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            📋 Painel do cliente
          </div>
          <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando ? '...' : cliente?.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>Competência {competencia}</div>
          {cliente && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {cliente.cnpj && (
                <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
                  {cliente.cnpj}
                </span>
              )}
              <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
                {cliente.regime || 'SN'}
              </span>
              {cliente.carteira && (
                <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
                  {cliente.carteira}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: 26 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && (() => {
            const modulos = agruparPorModulo(obs.itens);
            // Lançamentos a identificar e notas fiscais moram na aba Contábil —
            // garante que a aba apareça mesmo se não houver obrigação desse
            // módulo na competência (senão ficariam sem lugar pra aparecer).
            if ((lancamentos.length > 0 || documentosFiscais.length > 0) && !modulos.some((m) => m.nome === 'Contábil')) {
              modulos.push({ nome: 'Contábil', icone: '🧮', s: 'empty', pct: 0, val: '—' });
            }
            const abas = [
              { id: 'resumo', label: 'Resumo', icone: '🏠' },
              ...modulos.map((m) => ({ id: m.nome, label: m.nome, icone: m.icone })),
              { id: 'cnd', label: 'CND', icone: '🛡️' },
            ];
            const abaAtiva = abas.some((a) => a.id === aba) ? aba : 'resumo';
            const moduloAtual = modulos.find((m) => m.nome === abaAtiva);
            const obsDoModulo = moduloAtual ? obs.itens.filter((o) => (o.departamentos?.nome || 'Geral') === abaAtiva) : [];
            const tarefasDoModulo = moduloAtual ? tarefas.itens.filter((t) => (t.departamento || '').toLowerCase() === abaAtiva.toLowerCase()) : [];

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Barra de abas — Resumo + um módulo por área com obrigação na competência + CND */}
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {abas.map((a) => (
                    <button key={a.id} onClick={() => setAba(a.id)}
                      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                        background: abaAtiva === a.id ? 'var(--navy)' : 'var(--surface2)',
                        border: `1px solid ${abaAtiva === a.id ? 'var(--navy)' : 'var(--border)'}`,
                        borderRadius: 99, padding: '6px 13px', fontSize: 12, fontWeight: 600,
                        color: abaAtiva === a.id ? '#fff' : 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      <span>{a.icone}</span> {a.label}
                    </button>
                  ))}
                </div>

                {/* ── Aba Resumo ── */}
                {abaAtiva === 'resumo' && (() => {
                  const obrigDas = obs.itens.find((o) => `${o.titulo || ''} ${o.tipo || ''}`.toLowerCase().includes('das'));
                  const temValorDas = gerenciais?.valor_das != null && gerenciais.valor_das > 0;
                  const itensTimeline = obs.itens
                    .filter((o) => o.vencimento)
                    .map((o) => ({
                      id: o.id,
                      titulo: o.titulo || o.tipo,
                      departamento: o.departamentos?.nome,
                      vencimento: o.vencimento,
                      concluido: o.status === 'concluido' || o.status === 'nao_aplica',
                      valor: temValorDas && obrigDas && o.id === obrigDas.id ? gerenciais.valor_das : null,
                    }));
                  const semData = [
                    ...(temValorDas && !obrigDas ? [{ titulo: 'DAS — Simples Nacional', sub: 'Vencimento não cadastrado', valor: gerenciais.valor_das }] : []),
                    ...(situacaoFiscal?.debitos || []).map((d) => ({ titulo: d.tributo, sub: d.situacao, valor: d.valor })),
                  ];

                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                    {gerenciais && (
                      <div>
                        <SecaoTitulo icone={<BarChart3Icon size={14} />}>Informações gerenciais — Simples Nacional</SecaoTitulo>
                        {historicoFaturamento.length > 0 && (
                          <div style={{ marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>
                              <TrendingUpIcon size={12} /> Evolução do faturamento
                            </div>
                            <GraficoFaturamento dados={historicoFaturamento} />
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                          <Metrica label="Faturamento do período" valor={fmt(gerenciais.faturamento_periodo)} />
                          <Metrica label="RBT12" valor={fmt(gerenciais.rbt12)} />
                          <Metrica label="Alíquota efetiva" valor={fmtPct(gerenciais.aliquota_efetiva)} />
                          <Metrica label="DAS a pagar" valor={fmt(gerenciais.valor_das)} />
                        </div>
                        {gerenciais.anexo && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Enquadrado no Anexo {gerenciais.anexo} do Simples Nacional.</div>
                        )}
                        {gerenciais.receita_por_tipo?.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Receita por tipo</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {gerenciais.receita_por_tipo.map((r, i) => (
                                <span key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 99, padding: '4px 10px' }}>
                                  {RECEITA_TIPO_LABEL[r.tipo] || r.tipo}: {fmt(r.valor)}
                                </span>
                              ))}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 6 }}>
                              A alíquota efetiva acima é sobre o total da competência — parte dessa receita já teve imposto retido antes (ST/monofásico).
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {(itensTimeline.length > 0 || semData.length > 0) && (
                      <div>
                        <SecaoTitulo icone={<CalendarIcon size={14} />}>Vencimentos do mês</SecaoTitulo>
                        {itensTimeline.length > 0 && <LinhaDoTempoVencimentos itens={itensTimeline} />}
                        {semData.length > 0 && (
                          <div style={{ marginTop: itensTimeline.length > 0 ? 14 : 0 }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Sem vencimento definido</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {semData.map((it, i) => (
                                <ItemLista key={i} titulo={it.titulo} sub={it.sub} statusLabel={fmt(it.valor)} statusCor={['var(--warn)', 'var(--warn-dim)']} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {(pendenciasAnteriores.obrigacoes.length > 0 || pendenciasAnteriores.tarefas.length > 0) && (
                      <div>
                        <SecaoTitulo icone={<AlertTriangleIcon size={14} />}>Pendências de meses anteriores</SecaoTitulo>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {pendenciasAnteriores.obrigacoes.map((o) => {
                            const dias = diasParaVencer(o.vencimento);
                            const valorDas = valoresDasPendencias[o.competencia];
                            return (
                              <ItemLista key={o.id} titulo={o.titulo || o.tipo} sub={`${o.departamentos?.nome || 'Geral'} · ${o.competencia}`}
                                statusLabel={STATUS_OBS_LABEL[o.status]} statusCor={STATUS_OBS_COR[o.status]}
                                valorTexto={valorDas != null ? fmt(valorDas) : null}
                                vencimentoTexto={o.vencimento ? `${fmtData(o.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                                vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : 'var(--text3)'} />
                            );
                          })}
                          {pendenciasAnteriores.tarefas.map((t) => {
                            const dias = diasParaVencer(t.vencimento);
                            return (
                              <ItemLista key={t.id} titulo={t.titulo} sub={`${t.departamento || 'Geral'} · ${t.competencia}`}
                                statusLabel="Pendente" statusCor={['var(--warn)', 'var(--warn-dim)']}
                                vencimentoTexto={t.vencimento ? `${fmtData(t.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                                vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : 'var(--text3)'} />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div>
                      <SecaoTitulo icone={<LayersIcon size={14} />}>Módulos</SecaoTitulo>
                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(72px, 1fr))`, gap: 8 }}>
                        {[...modulos, moduloCND(situacaoFiscal, cndManual)].map((m) => (
                          <ModuloCard key={m.nome} {...m} onClick={() => setAba(m.nome === 'CND' ? 'cnd' : m.nome)} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <SecaoTitulo icone={<ClipboardListIcon size={14} />}>Visão geral do mês</SecaoTitulo>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <ResumoCard titulo="Obrigações" icone={<ClipboardListIcon size={13} />} pct={obs.total ? Math.round((obs.ok / obs.total) * 100) : 0}
                          linha1={`${obs.ok}/${obs.total} concluídas`} alerta={obs.vencido > 0 ? `${obs.vencido} vencida${obs.vencido !== 1 ? 's' : ''}` : null} />
                        <ResumoCard titulo="Tarefas" icone={<CheckSquareIcon size={13} />} pct={tarefas.total ? Math.round((tarefas.concluidas / tarefas.total) * 100) : 0}
                          linha1={`${tarefas.concluidas}/${tarefas.total} concluídas`} alerta={null} />
                      </div>
                    </div>

                    {documentos.length > 0 && (
                      <div>
                        <SecaoTitulo icone={<PaperclipIcon size={14} />}>Documentos do mês</SecaoTitulo>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {documentos.map((d) => (
                            <ItemLista key={d.id} titulo={d.tipo_documento_sugerido || d.nome_arquivo} sub={fmtData(d.created_at?.slice(0, 10))}
                              anexo={d} onBaixarAnexo={baixarAnexo} />
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <SecaoTitulo icone={<WalletIcon size={14} />}>Financeiro</SecaoTitulo>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        <Metrica label="Conciliados" valor={financeiro.conciliados} />
                        <Metrica label="A conciliar" valor={financeiro.aConciliar} cor={financeiro.aConciliar > 0 ? 'var(--warn)' : 'var(--ok)'} />
                        <Metrica label="Resultado do período" valor={financeiro.resultado != null ? fmt(financeiro.resultado) : '—'}
                          cor={financeiro.resultado < 0 ? 'var(--danger)' : 'var(--ok)'} />
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {/* ── Aba de módulo (Fiscal/Folha/Legalização/Contábil/...) ── */}
                {moduloAtual && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <SecaoTitulo icone={<span>{moduloAtual.icone}</span>}>{moduloAtual.nome}</SecaoTitulo>
                      <span style={{ fontSize: 18, fontWeight: 800, color: MODULO_COR[moduloAtual.s] }}>
                        {moduloAtual.s === 'empty' ? '—' : `${moduloAtual.pct}%`}
                      </span>
                    </div>
                    {obsDoModulo.length === 0 && tarefasDoModulo.length === 0
                      && !(moduloAtual.nome === 'Contábil' && lancamentos.length > 0)
                      && !(moduloAtual.nome === 'Contábil' && documentosFiscais.length > 0) && (
                      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '24px 0' }}>Nada nesse módulo por enquanto.</div>
                    )}
                    {obsDoModulo.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: tarefasDoModulo.length > 0 ? 10 : 0 }}>
                        {obsDoModulo.map((o) => {
                          const dias = diasParaVencer(o.vencimento);
                          const anexo = anexosObrigacao[o.id];
                          return (
                            <ItemLista key={o.id} titulo={o.titulo || o.tipo} sub={o.departamentos?.nome}
                              statusLabel={STATUS_OBS_LABEL[o.status]} statusCor={STATUS_OBS_COR[o.status]}
                              vencimentoTexto={o.vencimento ? `${fmtData(o.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                              vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : dias != null && dias <= 3 ? 'var(--warn)' : 'var(--text3)'}
                              anexo={anexo} onBaixarAnexo={baixarAnexo} />
                          );
                        })}
                      </div>
                    )}
                    {tarefasDoModulo.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {tarefasDoModulo.map((t) => {
                          const dias = diasParaVencer(t.vencimento);
                          return (
                            <ItemLista key={t.id} titulo={t.titulo} sub={t.departamento}
                              statusLabel={t.concluida ? 'Concluída' : 'Pendente'} statusCor={t.concluida ? ['var(--ok)', 'var(--ok-dim)'] : ['var(--warn)', 'var(--warn-dim)']}
                              vencimentoTexto={t.vencimento && !t.concluida ? `${fmtData(t.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                              vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : dias != null && dias <= 3 ? 'var(--warn)' : 'var(--text3)'} />
                          );
                        })}
                      </div>
                    )}
                    {moduloAtual.nome === 'Contábil' && documentosFiscais.length > 0 && (() => {
                      const entradas = documentosFiscais.filter((d) => d.tipo_movimento === 'entrada');
                      const saidas = documentosFiscais.filter((d) => d.tipo_movimento === 'saida');
                      const totalEntrada = entradas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
                      const totalSaida = saidas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
                      return (
                        <div style={{ marginTop: (obsDoModulo.length > 0 || tarefasDoModulo.length > 0) ? 16 : 0 }}>
                          <SecaoTitulo icone={<FileTextIcon size={14} />}>Notas fiscais</SecaoTitulo>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 }}>
                            <Metrica label={`Entrada (${entradas.length})`} valor={fmt(totalEntrada)} />
                            <Metrica label={`Saída (${saidas.length})`} valor={fmt(totalSaida)} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {documentosFiscais.map((d) => (
                              <ItemLista key={d.id} titulo={d.razao_social_terceiro || 'Documento fiscal'}
                                sub={`${d.modelo || ''}${d.numero ? ` ${d.numero}` : ''} · ${fmtData(d.data_emissao)}`}
                                valorTexto={fmt(d.valor_total)}
                                statusLabel={d.tipo_movimento === 'entrada' ? 'Entrada' : d.tipo_movimento === 'saida' ? 'Saída' : null}
                                statusCor={d.tipo_movimento === 'entrada' ? ['var(--ok)', 'var(--ok-dim)'] : ['var(--info)', 'var(--info-dim)']} />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {moduloAtual.nome === 'Contábil' && lancamentos.length > 0 && (
                      <div style={{ marginTop: (obsDoModulo.length > 0 || tarefasDoModulo.length > 0 || documentosFiscais.length > 0) ? 16 : 0 }}>
                        <SecaoTitulo icone={<WalletIcon size={14} />}>Lançamentos a identificar</SecaoTitulo>
                        <LancamentosIdentificar lancamentos={lancamentos} onSaved={() => setLancamentos((prev) => [...prev])} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Aba CND ── */}
                {abaAtiva === 'cnd' && (
                  <div>
                    <SecaoTitulo icone={<FileTextIcon size={14} />}>Situação Fiscal — RFB</SecaoTitulo>
                    {!situacaoFiscal && (
                      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '24px 0' }}>
                        Nenhum relatório de situação fiscal enviado ainda pra essa competência.
                      </div>
                    )}
                    {situacaoFiscal && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 10 }}>
                          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
                            <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>Situação</div>
                            <span style={{ display: 'inline-block', marginTop: 5, fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '3px 10px',
                              color: situacaoFiscal.situacao_geral === 'regular' ? 'var(--ok)' : situacaoFiscal.situacao_geral === 'pendente' ? 'var(--danger)' : 'var(--text3)',
                              background: situacaoFiscal.situacao_geral === 'regular' ? 'var(--ok-dim)' : situacaoFiscal.situacao_geral === 'pendente' ? 'var(--danger-dim)' : 'var(--surface2)' }}>
                              {situacaoFiscal.situacao_geral === 'regular' ? 'Regular' : situacaoFiscal.situacao_geral === 'pendente' ? 'Com pendências' : 'Não identificada'}
                            </span>
                          </div>
                          <Metrica label="Emissão do relatório" valor={situacaoFiscal.data_emissao ? fmtData(situacaoFiscal.data_emissao) : '—'} />
                        </div>
                        {situacaoFiscal.debitos?.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Débitos em aberto</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {situacaoFiscal.debitos.map((d, i) => (
                                <ItemLista key={i} titulo={d.tributo} sub={fmt(d.valor)} statusLabel={d.situacao} statusCor={['var(--warn)', 'var(--warn-dim)']} />
                              ))}
                            </div>
                          </div>
                        )}
                        {situacaoFiscal.parcelamentos?.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Parcelamentos ativos</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {situacaoFiscal.parcelamentos.map((p, i) => (
                                <ItemLista key={i} titulo={p.modalidade} sub={fmt(p.valor)} statusLabel={p.parcelas || null} statusCor={['var(--info)', 'var(--info-dim)']} />
                              ))}
                            </div>
                          </div>
                        )}
                        {situacaoFiscal.dividas_ativas?.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Dívida Ativa (PGFN)</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {situacaoFiscal.dividas_ativas.map((d, i) => (
                                <ItemLista key={i} titulo={d.inscricao || 'Inscrição'} sub={fmt(d.valor)} statusLabel={d.situacao} statusCor={['var(--danger)', 'var(--danger-dim)']} />
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div style={{ marginTop: situacaoFiscal ? 16 : 0 }}>
                      <SecaoTitulo icone={<span>🛡️</span>}>Estadual e Municipal</SecaoTitulo>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                        <CardSituacaoCND label="Estadual" situacao={cndManual?.situacao_estadual}
                          anexo={cndManual?.anexo_estadual_path ? { storage_path: cndManual.anexo_estadual_path, nome_arquivo: cndManual.anexo_estadual_nome } : null}
                          onBaixarAnexo={baixarAnexo} />
                        <CardSituacaoCND label="Municipal" situacao={cndManual?.situacao_municipal}
                          anexo={cndManual?.anexo_municipal_path ? { storage_path: cndManual.anexo_municipal_path, nome_arquivo: cndManual.anexo_municipal_nome } : null}
                          onBaixarAnexo={baixarAnexo} />
                      </div>
                      {cndManual?.observacao && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>{cndManual.observacao}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ padding: '12px 26px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Gerado pelo Gestor — Escritório Contábil.
        </div>
      </div>
    </div>
  );
}

function SecaoTitulo({ children, icone }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>
      {icone} {children}
    </div>
  );
}

function ResumoCard({ titulo, icone, pct, linha1, alerta }) {
  const completo = pct === 100 && !alerta;
  return (
    <div style={{ background: completo ? 'var(--ok)' : 'var(--bg)', border: `1px solid ${completo ? 'var(--ok)' : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: completo ? 'rgba(255,255,255,.85)' : 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {titulo}
      </div>
      {completo ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <CheckCircleIcon size={20} color="#fff" />
          <span style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Completo</span>
        </div>
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, color: alerta ? 'var(--danger)' : 'var(--ok)', marginTop: 5 }}>{pct}%</div>
      )}
      <div style={{ fontSize: 11, color: completo ? 'rgba(255,255,255,.85)' : 'var(--text2)', marginTop: 2 }}>{linha1}</div>
      {alerta && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2, fontWeight: 600 }}>⚠ {alerta}</div>}
    </div>
  );
}

function ItemLista({ titulo, sub, statusLabel, statusCor, vencimentoTexto, vencimentoCor, valorTexto, anexo, onBaixarAnexo }) {
  const [cor, corDim] = statusCor || [];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
          {sub && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{sub}</span>}
          {vencimentoTexto && (
            <span style={{ fontSize: 10.5, color: vencimentoCor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {vencimentoTexto}
            </span>
          )}
        </div>
      </div>
      {valorTexto && (
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', flexShrink: 0 }}>{valorTexto}</span>
      )}
      {anexo && (
        <button onClick={() => onBaixarAnexo(anexo)} title={`Baixar ${anexo.nome_arquivo}`}
          style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 26, height: 26, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
          <DownloadIcon size={13} />
        </button>
      )}
      {statusLabel && (
        <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: corDim, borderRadius: 99, padding: '3px 9px', flexShrink: 0 }}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}

const MODULO_COR = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', empty: 'var(--text3)' };

function ModuloCard({ nome, icone, s, pct, val, onClick }) {
  const cor = MODULO_COR[s];
  return (
    <div onClick={onClick} style={{ background: 'var(--bg)', border: `1px solid ${s === 'empty' ? 'var(--border)' : cor}`,
      borderRadius: 'var(--r-md)', padding: '10px 6px', textAlign: 'center', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 16, marginBottom: 3 }}>{icone}</div>
      <div style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.02em', marginBottom: 4,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nome}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: cor }}>{s === 'empty' ? '—' : `${pct}%`}</div>
      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{val}</div>
    </div>
  );
}

// Linha do tempo vertical dos vencimentos da competência — `itens` já vem
// filtrado (só o que tem vencimento) e com `valor` preenchido quando
// conhecido (hoje só o DAS, casado por heurística de título em obs.itens).
function LinhaDoTempoVencimentos({ itens }) {
  const porData = {};
  itens.forEach((it) => { (porData[it.vencimento] ||= []).push(it); });
  const datas = Object.keys(porData).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {datas.map((data, i) => {
        const grupo = porData[data];
        const dias = diasParaVencer(data);
        const totalValor = grupo.reduce((s, it) => s + (it.valor || 0), 0);
        const todosConcluidos = grupo.every((it) => it.concluido);
        const cor = todosConcluidos ? 'var(--ok)' : dias < 0 ? 'var(--danger)' : dias <= 3 ? 'var(--warn)' : 'var(--accent)';
        return (
          <div key={data} style={{ display: 'flex', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: cor, flexShrink: 0, marginTop: 3 }} />
              {i < datas.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, paddingBottom: i < datas.length - 1 ? 14 : 0, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: cor }}>
                  {fmtData(data)} · {todosConcluidos ? 'concluído' : fmtDiasParaVencer(dias)}
                </span>
                {totalValor > 0 && <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text1)', flexShrink: 0 }}>{fmt(totalValor)}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
                {grupo.map((it) => (
                  <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, color: it.concluido ? 'var(--ok)' : 'var(--text2)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {it.concluido && <CheckCircleIcon size={11} color="var(--ok)" style={{ flexShrink: 0 }} />}
                      {it.titulo}{it.departamento ? ` · ${it.departamento}` : ''}
                    </span>
                    {it.valor != null && <span style={{ fontWeight: 600, color: it.concluido ? 'var(--ok)' : 'var(--text1)', flexShrink: 0 }}>{fmt(it.valor)}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardSituacaoCND({ label, situacao, anexo, onBaixarAnexo }) {
  const cor = situacao === 'regular' ? 'var(--ok)' : situacao === 'pendente' ? 'var(--danger)' : 'var(--text3)';
  const corDim = situacao === 'regular' ? 'var(--ok-dim)' : situacao === 'pendente' ? 'var(--danger-dim)' : 'var(--surface2)';
  const texto = situacao === 'regular' ? 'Regular' : situacao === 'pendente' ? 'Com pendências' : 'Não informado';
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
        {anexo && (
          <button onClick={() => onBaixarAnexo(anexo)} title={`Baixar ${anexo.nome_arquivo}`}
            style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 22, height: 22, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
            <DownloadIcon size={11} />
          </button>
        )}
      </div>
      <span style={{ display: 'inline-block', marginTop: 5, fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '3px 10px', color: cor, background: corDim }}>
        {texto}
      </span>
    </div>
  );
}

function Metrica({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 3 }}>{valor}</div>
    </div>
  );
}

// Gráfico de barras da evolução do faturamento — SVG à mão, sem lib de
// gráficos (o projeto não usa nenhuma hoje, mantém o mesmo estilo das
// barras de progresso já feitas à mão no resto do app). `dados` já vem
// ordenado cronologicamente de obterHistoricoFaturamento.
function GraficoFaturamento({ dados }) {
  const max = Math.max(...dados.map((d) => d.faturamento_periodo || 0), 1);
  const larguraBarra = 46, gap = 16, altura = 100;
  // Espaço reservado acima das barras pro rótulo do valor — sem essa margem,
  // a barra do mês com maior faturamento (a mais alta, geralmente a mais
  // relevante) empurra o rótulo pra fora do viewBox (y negativo) e o número
  // simplesmente não aparece.
  const margemTopo = 16, margemBaixo = 20;
  const larguraTotal = dados.length * (larguraBarra + gap);
  const alturaSvg = altura + margemTopo + margemBaixo;

  const fmtCurto = (v) => {
    if (v >= 1000000) return `${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
    if (v >= 1000) return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${larguraTotal} ${alturaSvg}`} width="100%" height={alturaSvg} style={{ minWidth: larguraTotal, display: 'block' }}>
        {dados.map((d, i) => {
          const valor = d.faturamento_periodo || 0;
          const alturaBarra = max > 0 ? Math.max((valor / max) * altura, 2) : 2;
          const x = i * (larguraBarra + gap);
          const yBase = margemTopo + altura;
          const [mes, ano] = d.competencia.split('/');
          return (
            <g key={d.competencia}>
              <text x={x + larguraBarra / 2} y={yBase - alturaBarra - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text2)">
                {fmtCurto(valor)}
              </text>
              <rect x={x} y={yBase - alturaBarra} width={larguraBarra} height={alturaBarra} rx="4" fill="var(--accent)" />
              <text x={x + larguraBarra / 2} y={yBase + 16} textAnchor="middle" fontSize="10" fill="var(--text3)">
                {mes}/{ano.slice(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

