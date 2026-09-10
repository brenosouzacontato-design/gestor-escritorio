import { useEffect, useState } from 'react';
import {
  WalletIcon, ClipboardListIcon, CheckSquareIcon, BarChart3Icon,
  CalendarIcon, DownloadIcon, CheckCircleIcon, FileTextIcon, TrendingUpIcon, LayersIcon,
  AlertTriangleIcon, Share2Icon, ClockIcon, SettingsIcon, EyeIcon, EyeOffIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { calcularAliquotaNominal } from '../../lib/simplesNacional';
import { listarLancamentosAIdentificar } from '../contabil/contabilApi';
import LancamentosIdentificar from '../contabil/LancamentosIdentificar';
import { abrirLinkAssinado } from '../documentos/documentosApi';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterResumoFinanceiro, obterDadosGerenciais,
  obterDocumentosPorObrigacao, obterSituacaoFiscal, obterHistoricoFaturamento, obterCndManual,
  obterPendenciasAnteriores, obterValoresDasPendencias, obterDocumentosFiscais, definirSecoesOcultasPainel,
} from './painelApi';

const STATUS_OBS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_OBS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

// Mesma lista de nomes marcada como eh_imposto em tipos_obrigacao (ver
// supabase-schema-tipos-obrigacao-imposto.sql), usada aqui como fallback
// pra obrigações antigas que não têm tipo_obrigacao_id (modelo legado,
// anterior à recorrência por tipo — ver supabase-schema-andamento-
// recorrencia.sql) e por isso não têm como resolver o join.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
  'INSS MENSAL',
]);
function ehImposto(o) {
  return o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase());
}

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

// Monta o texto da mensagem de WhatsApp com as notas fiscais do mês —
// lista item a item até um limite (clientes de alto volume, tipo varejo,
// podem ter milhares de notas/mês, o que estouraria o tamanho da URL do
// wa.me e viraria uma mensagem ilegível), com um resumo do restante.
const LIMITE_ITENS_MENSAGEM = 40;
function montarMensagemNotasFiscais({ nomeCliente, competencia, documentos, entradas, saidas, totalEntrada, totalSaida }) {
  const linhas = documentos.slice(0, LIMITE_ITENS_MENSAGEM).map((d) =>
    `${d.tipo_movimento === 'entrada' ? '↓' : '↑'} ${fmtData(d.data_emissao)} · ${d.razao_social_terceiro || 'Documento fiscal'} · ${fmt(d.valor_total)}`
  );
  const restante = documentos.length - LIMITE_ITENS_MENSAGEM;
  if (restante > 0) linhas.push(`… e mais ${restante} nota${restante !== 1 ? 's' : ''}.`);
  return `Olá! Notas fiscais de ${nomeCliente || 'sua empresa'} — competência ${competencia}:\n\n`
    + `↓ Entrada: ${entradas.length} nota${entradas.length !== 1 ? 's' : ''} — ${fmt(totalEntrada)}\n`
    + `↑ Saída: ${saidas.length} nota${saidas.length !== 1 ? 's' : ''} — ${fmt(totalSaida)}\n\n`
    + linhas.join('\n');
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
// Algumas competências pra trás e uma pra frente da que veio no link
// (ver opcoesCompetencia no seletor do cabeçalho) — o cliente pode querer
// olhar um mês anterior sem precisar de um link novo pra cada competência.
function opcoesCompetencia(base) {
  const [mesBase, anoBase] = base.split('/').map(Number);
  const opcoes = [];
  for (let i = 4; i >= -1; i--) {
    const d = new Date(anoBase, mesBase - 1 - i, 1);
    opcoes.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  return opcoes;
}

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
//
// `admin` só vem true quando aberto de dentro do app logado (ver
// PainelViewerModal.jsx/PaineisPage.jsx) — habilita o modo de edição que
// mostra/esconde seções do Resumo pro cliente. No link público (main.jsx)
// essa prop nunca é passada, então o cliente nunca vê o controle.
export default function PainelClientePage({ clienteId, competencia: competenciaInicial, admin = false }) {
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const opcoesComp = opcoesCompetencia(competenciaInicial);
  const [cliente, setCliente] = useState(null); // {nome, cnpj, regime, carteira, painel_secoes_ocultas}
  const [editandoPainel, setEditandoPainel] = useState(false);
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
        const [{ data: clienteData, error: errCliente }, resObs, resTarefas, resFinanceiro, itensIdentificar, dadosSimples, historico, situFiscal, cndManualData, pendenciasAnt, docsFiscais] = await Promise.all([
          supabase.from('clientes').select('nome, cnpj, regime, carteira, painel_secoes_ocultas').eq('id', clienteId).single(),
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
    await abrirLinkAssinado(documento.storage_path).catch(() => null);
  };

  const secoesOcultas = cliente?.painel_secoes_ocultas || [];
  const toggleSecao = async (chave) => {
    const proxima = secoesOcultas.includes(chave) ? secoesOcultas.filter((s) => s !== chave) : [...secoesOcultas, chave];
    setCliente((c) => ({ ...c, painel_secoes_ocultas: proxima }));
    await definirSecoesOcultasPainel(clienteId, proxima).catch(() => {});
  };

  // Status geral pra o selo em destaque no cabeçalho — "atrasado" pesa mais
  // que "pendente" (uma pendência de mês anterior sempre entra no cálculo,
  // o painel é histórico até ser resolvida, ver obterPendenciasAnteriores).
  // Calculado aqui em cima (não só dentro da aba Resumo) porque o selo mora
  // no cabeçalho, visível em qualquer aba.
  const heroStatus = (obs && pendenciasAnteriores) ? (() => {
    const vencidasAnteriores = pendenciasAnteriores.obrigacoes.filter((o) => o.status === 'vencido').length;
    const totalVencidas = obs.vencido + vencidasAnteriores;
    const totalPendentesAnteriores = pendenciasAnteriores.obrigacoes.length + pendenciasAnteriores.tarefas.length;
    return totalVencidas > 0
      ? { s: 'danger', titulo: 'Atenção', sub: `${totalVencidas} ${totalVencidas === 1 ? 'pendência vencida' : 'pendências vencidas'}` }
      : (obs.pendente > 0 || totalPendentesAnteriores > 0)
        ? { s: 'warn', titulo: 'Pendências em aberto', sub: `${obs.pendente + totalPendentesAnteriores} ${(obs.pendente + totalPendentesAnteriores) === 1 ? 'item pendente' : 'itens pendentes'}` }
        : { s: 'ok', titulo: 'Tudo em dia', sub: 'Nenhuma pendência nessa competência' };
  })() : null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 26px', background: 'var(--navy)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                📋 Painel do cliente
              </div>
              <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando ? '...' : cliente?.nome}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {heroStatus && <StatusBadge {...heroStatus} />}
              {admin && (
                <button type="button" onClick={() => setEditandoPainel((v) => !v)}
                  title={editandoPainel ? 'Sair do modo de edição' : 'Editar quais seções o cliente vê'}
                  style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', border: `1px solid ${editandoPainel ? 'var(--accent)' : 'rgba(255,255,255,.15)'}`,
                    background: editandoPainel ? 'var(--accent)' : 'rgba(255,255,255,.08)', color: '#fff' }}>
                  <SettingsIcon size={15} />
                </button>
              )}
            </div>
          </div>
          <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
            style={{ marginTop: 12, fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
              borderRadius: 6, padding: '3px 8px', fontWeight: 600 }}>
            {opcoesComp.map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
          </select>
          {admin && editandoPainel && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 10px' }}>
              Modo de edição — só você vê isso. Use o ícone {'👁'} em cada seção pra escolher o que o cliente enxerga no Resumo.
            </div>
          )}
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
            const cnd = moduloCND(situacaoFiscal, cndManual);
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

                {/* Barra de abas — Resumo + um módulo por área com obrigação na competência + CND, cada uma com o status em destaque */}
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                  {abas.map((a) => {
                    const m = a.id === 'cnd' ? cnd : modulos.find((mm) => mm.nome === a.id);
                    return (
                      <AbaPill key={a.id} icone={a.icone} label={a.label}
                        badge={a.id === 'resumo' ? null : m?.val} s={a.id === 'resumo' ? heroStatus.s : m?.s}
                        ativo={abaAtiva === a.id} onClick={() => setAba(a.id)} />
                    );
                  })}
                </div>

                {/* ── Aba Resumo ── */}
                {abaAtiva === 'resumo' && (() => {
                  const obrigDas = obs.itens.find((o) => `${o.titulo || ''} ${o.tipo || ''}`.toLowerCase().includes('das'));
                  const temValorDas = gerenciais?.valor_das != null && gerenciais.valor_das > 0;
                  // Impostos da competência atual + impostos vencidos de competências
                  // anteriores (pendenciasAnteriores) — sem isso um DAS vencido há
                  // meses (comum em obrigação legada sem tipo_obrigacao_id, que só
                  // aparecia na lista genérica de pendências) não entrava aqui.
                  const impostosPendentesAnteriores = pendenciasAnteriores.obrigacoes.filter((o) => o.vencimento && ehImposto(o));
                  const itensImpostos = [
                    ...impostosPendentesAnteriores.map((o) => ({
                      id: o.id,
                      titulo: o.titulo || o.tipo,
                      departamento: `${o.departamentos?.nome || 'Geral'} · ${o.competencia}`,
                      vencimento: o.vencimento,
                      concluido: false,
                      valor: valoresDasPendencias[o.competencia] ?? null,
                      anexo: null,
                    })),
                    ...obs.itens
                      .filter((o) => o.vencimento && ehImposto(o))
                      .map((o) => ({
                        id: o.id,
                        titulo: o.titulo || o.tipo,
                        departamento: o.departamentos?.nome,
                        vencimento: o.vencimento,
                        concluido: o.status === 'concluido' || o.status === 'nao_aplica',
                        valor: temValorDas && obrigDas && o.id === obrigDas.id ? gerenciais.valor_das : null,
                        anexo: anexosObrigacao[o.id] || null,
                      })),
                  ];
                  const semData = [
                    ...(temValorDas && !obrigDas ? [{ titulo: 'DAS — Simples Nacional', sub: 'Vencimento não cadastrado', valor: gerenciais.valor_das }] : []),
                    ...(situacaoFiscal?.debitos || []).map((d) => ({ titulo: d.tributo, sub: d.situacao, valor: d.valor })),
                  ];

                  const propsSecao = { secoesOcultas, editando: admin && editandoPainel, onToggle: toggleSecao };
                  const aliquotaReal = gerenciais ? calcularAliquotaNominal(gerenciais.anexo, gerenciais.rbt12) : null;

                  return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

                    {gerenciais && (
                      <SecaoToggleable chave="kpis" {...propsSecao}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                          <Metrica label="Faturamento do período" valor={fmt(gerenciais.faturamento_periodo)} />
                          <Metrica label="RBT12" valor={fmt(gerenciais.rbt12)} />
                          <Metrica label="Alíquota efetiva" valor={fmtPct(gerenciais.aliquota_efetiva)} cor="var(--accent)" />
                          <Metrica label="DAS a pagar" valor={fmt(gerenciais.valor_das)} />
                        </div>
                      </SecaoToggleable>
                    )}

                    {aliquotaReal != null && gerenciais.faturamento_periodo > 0 && gerenciais.valor_das != null && (
                      <SecaoToggleable chave="comparativo" {...propsSecao}>
                        <ComparativoDas aliquotaReal={aliquotaReal} faturamento={gerenciais.faturamento_periodo} dasPago={gerenciais.valor_das} />
                      </SecaoToggleable>
                    )}

                    {historicoFaturamento.length > 0 && (
                      <SecaoToggleable chave="grafico" {...propsSecao}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600 }}>
                              <TrendingUpIcon size={12} /> Evolução do faturamento
                            </div>
                            <button type="button"
                              onClick={() => window.open(`${window.location.origin}${window.location.pathname}?share=faturamento&empresa=${clienteId}`, '_blank')}
                              title="Gerar comprovante de faturamento (declaração pra banco, financiamento etc.)"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                                background: 'var(--accent-dim)', border: 'none', borderRadius: 99, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              <FileTextIcon size={12} /> Comprovante de faturamento
                            </button>
                          </div>
                          <GraficoFaturamento dados={historicoFaturamento} />
                        </div>
                      </SecaoToggleable>
                    )}

                    <SecaoToggleable chave="modulos" {...propsSecao}>
                      <div>
                        <SecaoTitulo icone={<LayersIcon size={14} />}>Módulos</SecaoTitulo>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(70px, 1fr))`, gap: 8 }}>
                          {[...modulos, cnd].map((m) => (
                            <RingCard key={m.nome} {...m} onClick={() => setAba(m.nome === 'CND' ? 'cnd' : m.nome)} />
                          ))}
                        </div>
                      </div>
                    </SecaoToggleable>

                    <SecaoToggleable chave="visao_geral" {...propsSecao}>
                      <div>
                        <SecaoTitulo icone={<ClipboardListIcon size={14} />}>Visão geral do mês</SecaoTitulo>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <ResumoCard titulo="Obrigações" icone={<ClipboardListIcon size={13} />} pct={obs.total ? Math.round((obs.ok / obs.total) * 100) : 0}
                            linha1={`${obs.ok}/${obs.total} concluídas`} alerta={obs.vencido > 0 ? `${obs.vencido} vencida${obs.vencido !== 1 ? 's' : ''}` : null} />
                          <ResumoCard titulo="Tarefas" icone={<CheckSquareIcon size={13} />} pct={tarefas.total ? Math.round((tarefas.concluidas / tarefas.total) * 100) : 0}
                            linha1={`${tarefas.concluidas}/${tarefas.total} concluídas`} alerta={null} />
                        </div>
                      </div>
                    </SecaoToggleable>

                    {(itensImpostos.length > 0 || semData.length > 0) && (
                      <SecaoToggleable chave="impostos" {...propsSecao}>
                        <div>
                          <SecaoTitulo icone={<CalendarIcon size={14} />}>Impostos a pagar</SecaoTitulo>
                          {itensImpostos.length > 0 && <ImpostosAVencer itens={itensImpostos} onBaixarAnexo={baixarAnexo} />}
                          {semData.length > 0 && (
                            <div style={{ marginTop: itensImpostos.length > 0 ? 14 : 0 }}>
                              <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Sem vencimento definido</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {semData.map((it, i) => (
                                  <ItemLista key={i} titulo={it.titulo} sub={it.sub} statusLabel={fmt(it.valor)} statusCor={['var(--warn)', 'var(--warn-dim)']} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </SecaoToggleable>
                    )}
                  </div>
                  );
                })()}

                {/* ── Aba de módulo (Fiscal/Folha/Legalização/Contábil/...) ── */}
                {moduloAtual && (() => {
                  // Contábil volta pro formato em linha de antes — os cards em
                  // grade (bons pra obrigação isolada) ficam apertados quando
                  // misturados com o resumo financeiro de conciliação.
                  const isContabil = moduloAtual.nome === 'Contábil';
                  const ItemComp = isContabil ? ItemLista : ObrigacaoCard;
                  const wrapStyle = isContabil ? { display: 'flex', flexDirection: 'column', gap: 6 } : CARDS_GRID;
                  return (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <SecaoTitulo icone={<span>{moduloAtual.icone}</span>}>{moduloAtual.nome}</SecaoTitulo>
                      <span style={{ fontSize: 18, fontWeight: 800, color: MODULO_COR[moduloAtual.s] }}>
                        {moduloAtual.s === 'empty' ? '—' : `${moduloAtual.pct}%`}
                      </span>
                    </div>
                    {isContabil && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                        <Metrica label="Conciliados" valor={financeiro.conciliados} />
                        <Metrica label="A conciliar" valor={financeiro.aConciliar} cor={financeiro.aConciliar > 0 ? 'var(--warn)' : 'var(--ok)'} />
                        <Metrica label="Resultado do período" valor={financeiro.resultado != null ? fmt(financeiro.resultado) : '—'}
                          cor={financeiro.resultado < 0 ? 'var(--danger)' : 'var(--ok)'} />
                      </div>
                    )}
                    {obsDoModulo.length === 0 && tarefasDoModulo.length === 0
                      && !(moduloAtual.nome === 'Contábil' && lancamentos.length > 0)
                      && !(moduloAtual.nome === 'Contábil' && documentosFiscais.length > 0) && (
                      <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, padding: '24px 0' }}>Nada nesse módulo por enquanto.</div>
                    )}
                    {obsDoModulo.length > 0 && (
                      <div style={{ ...wrapStyle, marginBottom: tarefasDoModulo.length > 0 ? 10 : 0 }}>
                        {obsDoModulo.map((o) => {
                          const dias = diasParaVencer(o.vencimento);
                          const anexo = anexosObrigacao[o.id];
                          return (
                            <ItemComp key={o.id} titulo={o.titulo || o.tipo} sub={o.departamentos?.nome}
                              statusLabel={STATUS_OBS_LABEL[o.status]} statusCor={STATUS_OBS_COR[o.status]}
                              vencimentoTexto={o.vencimento ? `${fmtData(o.vencimento)} · ${fmtDiasParaVencer(dias)}` : null}
                              vencimentoCor={dias != null && dias < 0 ? 'var(--danger)' : dias != null && dias <= 3 ? 'var(--warn)' : 'var(--text3)'}
                              anexo={anexo} onBaixarAnexo={baixarAnexo} />
                          );
                        })}
                      </div>
                    )}
                    {tarefasDoModulo.length > 0 && (
                      <div style={wrapStyle}>
                        {tarefasDoModulo.map((t) => {
                          const dias = diasParaVencer(t.vencimento);
                          return (
                            <ItemComp key={t.id} titulo={t.titulo} sub={t.departamento}
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
                      const compartilharNotasFiscais = () => {
                        const mensagem = montarMensagemNotasFiscais({
                          nomeCliente: cliente?.nome, competencia, documentos: documentosFiscais,
                          entradas, saidas, totalEntrada, totalSaida,
                        });
                        window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
                      };
                      return (
                        <div style={{ marginTop: (obsDoModulo.length > 0 || tarefasDoModulo.length > 0) ? 16 : 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <SecaoTitulo icone={<FileTextIcon size={14} />}>Notas fiscais</SecaoTitulo>
                            <button type="button" onClick={compartilharNotasFiscais} title="Compartilhar as notas fiscais do mês via WhatsApp"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--ok)',
                                background: 'var(--ok-dim)', border: 'none', borderRadius: 99, padding: '5px 10px', cursor: 'pointer', marginBottom: 10 }}>
                              <Share2Icon size={12} /> WhatsApp
                            </button>
                          </div>
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
                  );
                })()}

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

// Envolve uma seção do Resumo pra deixá-la mostrável/ocultável só pro
// administrador (`editando` só vem true quando `admin` e o modo de edição
// do cabeçalho estão ligados). Fora do modo de edição — inclusive pro
// cliente, que nunca tem `editando` true — uma seção oculta simplesmente
// não renderiza nada, igual antes dessa feature existir.
function SecaoToggleable({ chave, secoesOcultas, editando, onToggle, children }) {
  const oculta = secoesOcultas.includes(chave);
  if (!editando) return oculta ? null : children;
  return (
    <div style={{ position: 'relative', opacity: oculta ? 0.4 : 1, border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)', padding: 10 }}>
      <button type="button" onClick={() => onToggle(chave)}
        title={oculta ? 'Mostrar essa seção pro cliente' : 'Ocultar essa seção pro cliente'}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, width: 26, height: 26, borderRadius: 99, border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          background: oculta ? 'var(--surface3)' : 'var(--accent-dim)', color: oculta ? 'var(--text3)' : 'var(--accent)' }}>
        {oculta ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
      </button>
      {children}
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

// Card de obrigação/tarefa/nota fiscal dentro de uma aba de módulo — grade
// em vez da lista empilhada, faixa colorida na lateral já indica o status
// sem precisar ler o selo (mesma linguagem visual dos cartões do Resumo).
function ObrigacaoCard({ titulo, sub, statusLabel, statusCor, vencimentoTexto, vencimentoCor, valorTexto, anexo, onBaixarAnexo }) {
  const [cor, corDim] = statusCor || ['var(--border2)', 'var(--surface3)'];
  return (
    <div style={{ background: 'var(--surface2)', borderLeft: `3px solid ${cor}`, borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', lineHeight: 1.3 }}>{titulo}</div>
        {anexo && (
          <button onClick={() => onBaixarAnexo(anexo)} title={`Baixar ${anexo.nome_arquivo}`}
            style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 24, height: 24, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
            <DownloadIcon size={12} />
          </button>
        )}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3 }}>{sub}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {vencimentoTexto ? (
          <span style={{ fontSize: 10.5, color: vencimentoCor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
            <CalendarIcon size={10} /> {vencimentoTexto}
          </span>
        ) : <span />}
        {valorTexto && <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text1)' }}>{valorTexto}</span>}
      </div>
      {statusLabel && (
        <span style={{ display: 'inline-block', marginTop: 8, fontSize: 10, fontWeight: 700, color: cor, background: corDim, borderRadius: 99, padding: '3px 9px' }}>
          {statusLabel}
        </span>
      )}
    </div>
  );
}

const CARDS_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 };

const MODULO_COR = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', empty: 'var(--text3)' };
const MODULO_DIM = { ok: 'var(--ok-dim)', warn: 'var(--warn-dim)', danger: 'var(--danger-dim)', empty: 'var(--surface3)' };

// Aba em pílula — ícone + nome + selo com o estado do módulo (fração
// "3/4", "Com CND"/"Sem CND" etc, já vindo pronto de
// agruparPorModulo/moduloCND). O Resumo não tem selo próprio, o estado
// geral já aparece em destaque no HeroStatus dentro do conteúdo.
function AbaPill({ icone, label, badge, s, ativo, onClick }) {
  return (
    <button onClick={onClick} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
      background: ativo ? 'var(--navy)' : 'var(--surface2)',
      border: `1px solid ${ativo ? 'var(--navy)' : 'var(--border)'}`,
      borderRadius: 99, padding: '6px 12px', fontSize: 12, fontWeight: 600,
      color: ativo ? '#fff' : 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <span>{icone}</span> {label}
      {badge && (
        <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 99, padding: '2px 7px', flexShrink: 0,
          background: ativo ? 'rgba(255,255,255,.15)' : MODULO_DIM[s], color: ativo ? '#fff' : MODULO_COR[s] }}>
          {badge}
        </span>
      )}
    </button>
  );
}

const HERO_ICON = { ok: CheckCircleIcon, warn: ClockIcon, danger: AlertTriangleIcon };

// Selo de status em destaque no cabeçalho escuro — a resposta que o
// cliente mais procura ("tá tudo certo?") já ao lado do nome da empresa,
// visível em qualquer aba.
function StatusBadge({ s, titulo, sub }) {
  const Icone = HERO_ICON[s];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.08)',
      border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '7px 14px 7px 8px', flexShrink: 0 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: MODULO_COR[s], color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icone size={13} />
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>{titulo}</div>
        <div style={{ fontSize: 9.5, color: 'var(--navy-text-dim)' }}>{sub}</div>
      </div>
    </div>
  );
}

// Anel de progresso do módulo — mesma leitura da lista de "Tarefas" (ok/N),
// só que como card clicável pra abrir o módulo na trilha lateral.
function RingCard({ nome, icone, s, pct, val, onClick }) {
  const cor = MODULO_COR[s];
  const R = 22, C = 2 * Math.PI * R;
  const offset = s === 'empty' ? C : C - (pct / 100) * C;
  return (
    <div onClick={onClick} style={{ textAlign: 'center', padding: '6px 2px', cursor: onClick ? 'pointer' : 'default' }}>
      <svg viewBox="0 0 56 56" width="50" height="50" style={{ display: 'block', margin: '0 auto' }}>
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--surface3)" strokeWidth="5" />
        <circle cx="28" cy="28" r={R} fill="none" stroke={cor} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 28 28)" />
        <text x="28" y="32" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--text1)">
          {s === 'empty' ? '—' : `${pct}%`}
        </text>
      </svg>
      <div style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 700, marginTop: 5,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{icone} {nome}</div>
      <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>{val}</div>
    </div>
  );
}

// Comparação "Simples cheio x pago" em barras — mais fácil de comparar de
// relance do que dois números lado a lado.
function ComparativoDas({ aliquotaReal, faturamento, dasPago }) {
  const cheio = faturamento * (aliquotaReal / 100);
  const max = Math.max(cheio, dasPago, 1);
  const economia = cheio - dasPago;
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', marginBottom: 9 }}>
        Simples "cheio" (tabela) x Simples pago
      </div>
      <BarraComparativa label={`Cheio (${fmtPct(aliquotaReal)})`} valor={cheio} pct={(cheio / max) * 100} cor="var(--text3)" />
      <BarraComparativa label="Pago (DAS real)" valor={dasPago} pct={(dasPago / max) * 100} cor="var(--ok)" />
      {Math.abs(economia) > 0.01 && (
        <div style={{ fontSize: 11.5, color: economia > 0 ? 'var(--ok)' : 'var(--text2)', fontWeight: 600, marginTop: 9 }}>
          {economia > 0 ? `Economia de ${fmt(economia)} nessa competência (aproveitamento de crédito/segregação de receita).` : `${fmt(-economia)} a mais que o "cheio" nessa competência.`}
        </div>
      )}
    </div>
  );
}

function BarraComparativa({ label, valor, pct, cor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', width: 104, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: cor }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, width: 86, textAlign: 'right', flexShrink: 0 }}>{fmt(valor)}</span>
    </div>
  );
}

// Esteira rolável de impostos a vencer da competência — um cartão por
// imposto (já filtrado por tipos_obrigacao.eh_imposto), ordenados por data,
// com prazo e valor em destaque em vez de misturado numa lista com o resto
// das obrigações do mês.
function ImpostosAVencer({ itens, onBaixarAnexo }) {
  const ordenados = [...itens].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
      {ordenados.map((it) => {
        const dias = diasParaVencer(it.vencimento);
        const statusKey = it.concluido ? 'concluido' : dias < 0 ? 'vencido' : 'pendente';
        const [cor, corDim] = dias > 3 && !it.concluido ? ['var(--text3)', 'var(--surface3)'] : STATUS_OBS_COR[statusKey];
        return (
          <div key={it.id} style={{ flexShrink: 0, width: 156, background: 'var(--surface2)',
            borderLeft: `3px solid ${cor}`, borderRadius: 'var(--r-md)', padding: '11px 12px 11px 10px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.titulo}</div>
            {it.departamento && <div style={{ fontSize: 9.5, color: 'var(--text3)', marginTop: 1 }}>{it.departamento}</div>}
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 5 }}>{fmtData(it.vencimento)}</div>
            {it.valor != null && <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6, color: 'var(--text1)' }}>{fmt(it.valor)}</div>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 7 }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, borderRadius: 99, padding: '2px 8px', color: cor, background: corDim }}>
                {it.concluido ? 'concluído' : fmtDiasParaVencer(dias)}
              </span>
              {it.anexo && (
                <button onClick={() => onBaixarAnexo(it.anexo)} title={`Baixar ${it.anexo.nome_arquivo}`}
                  style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 22, height: 22, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
                  <DownloadIcon size={11} />
                </button>
              )}
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

