import { useEffect, useState } from 'react';
import {
  CalendarIcon, DownloadIcon, CheckCircleIcon, AlertTriangleIcon, ClockIcon, TrendingUpIcon,
  ClipboardListIcon, EyeIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { abrirLinkAssinado } from '../documentos/documentosApi';
import { GraficoFaturamento } from './PainelClientePage';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterDadosGerenciais, obterDocumentosPorObrigacao,
  obterDocumentosPorTarefa, obterSituacaoFiscalMaisRecente, obterCndManual, obterHistoricoFaturamento,
  obterUltimaVisualizacaoPainel,
} from './painelApi';

// Nova versão do painel do cliente (link compartilhado, ?painel=<id>&competencia=MM/YYYY
// — ver main.jsx; a versão completa antiga continua em PainelClientePage.jsx,
// acessível com &versao=1). Página única, nessa ordem:
//   1. Fiscal: números da Declaração do Simples do mês + evolução do faturamento;
//   2. cards de impostos em aberto (Relatório de Situação Fiscal), a vencer e
//      vencidos (guias anexadas);
//   3. impostos da competência com guia anexada (valor + download) — o DAS de
//      mês com faturamento zerado aparece como "Sem movimento";
//   4. pendências do Relatório de Situação Fiscal (RFB/PGFN), com nome legível
//      do tributo, competência e valor atualizado;
//   5. demais obrigações/tarefas de Fiscal e Folha — concluídas só aparecem
//      se tiverem anexo pra baixar.
// `admin` (prévia de dentro do app) mostra a última vez que o cliente abriu o link.

// Mesmo fallback de PainelClientePage.jsx pra obrigações legadas sem
// tipo_obrigacao_id, mais reconhecimento pelo nome (FGTS, DARF etc. nem
// sempre estão marcados como eh_imposto) — anexo de obrigação que não é
// imposto (ex: holerites na obrigação "Folha") não é guia a pagar.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
  'INSS MENSAL',
]);
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i;
function ehImposto(o) {
  return o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`);
}
// Recálculo do PGDAS não é o DAS do mês: não herda o valor da declaração
// nem a regra de "Sem movimento" — só aparece se tiver guia anexada.
function ehDas(o) {
  const texto = `${o.titulo || ''} ${o.tipo || ''}`;
  return /\b(pg)?das\b/i.test(texto) && !/rec[aá]lculo/i.test(texto);
}

// Área (Fiscal/Folha) pelo departamento — o resto (Contábil, Societário...)
// fica de fora da lista de obrigações/tarefas.
function areaObrigacao(o) {
  const nome = (o.departamentos?.nome || '').toLowerCase();
  if (/folha|pessoal|dp\b/.test(nome)) return 'Folha';
  if (/fiscal/.test(nome)) return 'Fiscal';
  return null;
}
function areaTarefa(t) {
  const d = (t.departamento || '').toLowerCase();
  if (d === 'folha' || d === 'pessoal') return 'Folha';
  if (d === 'fiscal') return 'Fiscal';
  return null;
}

// O relatório da RFB traz o código da receita ("1099-01 - CP-SEGUR.") —
// traduz pro nome que o cliente reconhece. Sem correspondência, usa o
// texto original sem o período (que já aparece ao lado do nome).
const NOMES_TRIBUTO = [
  [/CP[\s.-]*SEGUR|1099/i, 'INSS Mensal'],
  [/CP[\s.-]*PATRONAL|1138/i, 'INSS Patronal'],
  [/CP[\s.-]*TERCEIROS|1170|1176|1191|1196|1200/i, 'INSS Terceiros'],
  [/CP[\s.-]*(GIL)?RAT|CP[\s.-]*SAT|1646/i, 'INSS RAT'],
  [/SIMPLES\s*NAC|\bDAS\b|\bSN\b/i, 'DAS — Simples Nacional'],
  [/\bMEI\b|SIMEI/i, 'DAS MEI'],
  [/IRRF|0561/i, 'IRRF'],
  [/IRPJ/i, 'IRPJ'],
  [/CSLL/i, 'CSLL'],
  [/COFINS/i, 'COFINS'],
  [/\bPIS\b/i, 'PIS'],
  [/FGTS/i, 'FGTS'],
];
function nomeTributo(texto) {
  const t = texto || '';
  const achado = NOMES_TRIBUTO.find(([re]) => re.test(t));
  if (achado) return achado[1];
  return t.replace(/\s*(PA\s*)?\d{2}\/\d{4}\s*$/i, '').trim() || 'Débito';
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
function fmtDataHora(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
function fmtHaQuanto(ts) {
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24);
  return `há ${dias} dia${dias !== 1 ? 's' : ''}`;
}
function diasParaVencer(vencimento) {
  if (!vencimento) return null;
  const hoje = new Date(new Date().toDateString());
  return Math.round((new Date(vencimento + 'T00:00:00') - hoje) / 86400000);
}
function fmtDias(dias) {
  if (dias == null) return null;
  if (dias === 0) return 'vence hoje';
  if (dias > 0) return `vence em ${dias} dia${dias !== 1 ? 's' : ''}`;
  return `venceu há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`;
}
function opcoesCompetencia(base) {
  const [mesBase, anoBase] = base.split('/').map(Number);
  const opcoes = [];
  for (let i = 4; i >= -1; i--) {
    const d = new Date(anoBase, mesBase - 1 - i, 1);
    opcoes.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
  }
  return opcoes;
}
function competenciaOrdinal(c) {
  if (!c) return 0;
  const [mes, ano] = c.split('/').map(Number);
  return ano * 100 + mes;
}
// Relatórios extraídos antes do campo "competencia" existir só trazem o
// período dentro do texto do tributo (ex: "1099-01 - CP-SEGUR. 06/2026").
function competenciaDoTexto(texto) {
  const m = /(\d{2})\/(\d{4})/.exec(texto || '');
  return m ? `${m[1]}/${m[2]}` : null;
}
const somaValores = (itens) => itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
const temValor = (itens) => itens.some((it) => it.valor != null);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export default function PainelCompartilhadoPage({ clienteId, competencia: competenciaInicial, admin = false }) {
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const opcoesComp = opcoesCompetencia(competenciaInicial);
  const [dados, setDados] = useState(null);
  const [ultimaVisualizacao, setUltimaVisualizacao] = useState(undefined); // undefined = carregando/indisponível
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (!admin) return;
    obterUltimaVisualizacaoPainel(clienteId).then(setUltimaVisualizacao).catch(() => setUltimaVisualizacao(undefined));
  }, [clienteId, admin]);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, obs, tarefas, gerenciais, historico, situacaoFiscal, cndManual] = await Promise.all([
          supabase.from('clientes').select('nome, cnpj, regime').eq('id', clienteId).single(),
          obterResumoObrigacoes(clienteId, competencia),
          obterResumoTarefas(clienteId, competencia),
          // tabelas novas toleram ainda não existir no banco, igual ao painel completo
          obterDadosGerenciais(clienteId, competencia).catch(() => null),
          obterHistoricoFaturamento(clienteId).catch(() => []),
          obterSituacaoFiscalMaisRecente(clienteId, competencia).catch(() => null),
          obterCndManual(clienteId, competencia).catch(() => null),
        ]);
        if (errCliente) throw errCliente;
        const impostos = obs.itens.filter(ehImposto);
        const outrasObrigacoes = obs.itens.filter((o) => !ehImposto(o) && areaObrigacao(o));
        const tarefasArea = tarefas.itens.filter((t) => areaTarefa(t));
        const [anexos, anexosTarefa] = await Promise.all([
          obterDocumentosPorObrigacao([...impostos, ...outrasObrigacoes].map((o) => o.id)).catch(() => ({})),
          obterDocumentosPorTarefa(tarefasArea.map((t) => t.id)).catch(() => ({})),
        ]);
        setDados({ cliente, impostos, outrasObrigacoes, tarefasArea, anexos, anexosTarefa, gerenciais, historico, situacaoFiscal, cndManual });
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [clienteId, competencia]);

  const baixar = (storagePath) => abrirLinkAssinado(storagePath).catch(() => null);
  const guias = dados && montarGuias(dados, competencia);
  const pendencias = dados && montarPendencias(dados.situacaoFiscal);
  const itensArea = dados && montarObrigacoesTarefas(dados, competencia);
  const aVencer = guias ? guias.filter((g) => !g.semMovimento && !alertaVencida(g) && !(g.concluida && g.dias != null && g.dias < 0)) : [];
  const guiasVencidas = guias ? guias.filter(alertaVencida) : [];
  // "Vencidos" junta as guias vencidas sem baixa com os débitos do
  // Relatório de Situação Fiscal (que por definição já passaram do prazo)
  const vencidos = [...guiasVencidas, ...(pendencias || [])];
  const proximoVencimento = aVencer.find((g) => g.vencimento && g.dias >= 0)?.vencimento;
  const datasAVencer = new Set(aVencer.filter((g) => g.vencimento).map((g) => g.vencimento));
  const semMovimento = dados?.gerenciais?.faturamento_periodo != null && Number(dados.gerenciais.faturamento_periodo) === 0;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 12px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>

        {/* ── Cabeçalho ── */}
        <div style={{ padding: '20px 22px', background: 'var(--navy)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Painel fiscal
              </div>
              <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando && !dados ? '...' : dados?.cliente?.nome}</div>
              {dados?.cliente && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {dados.cliente.cnpj && <ChipCabecalho>{dados.cliente.cnpj}</ChipCabecalho>}
                  <ChipCabecalho>{dados.cliente.regime || 'SN'}</ChipCabecalho>
                  <ChipSituacao situacaoFiscal={dados.situacaoFiscal} cndManual={dados.cndManual} />
                </div>
              )}
            </div>
            <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                borderRadius: 6, padding: '5px 8px', fontWeight: 600 }}>
              {opcoesComp.map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
            </select>
          </div>
          {admin && ultimaVisualizacao !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: 'var(--navy-text)',
              background: 'rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 10px' }}>
              <EyeIcon size={12} />
              {ultimaVisualizacao
                ? <span>Última visualização do cliente: <b style={{ color: '#fff' }}>{fmtDataHora(ultimaVisualizacao.visualizado_em)}</b> ({fmtHaQuanto(ultimaVisualizacao.visualizado_em)}){ultimaVisualizacao.competencia ? ` · competência ${ultimaVisualizacao.competencia}` : ''}</span>
                : <span>O cliente ainda não abriu o link do painel.</span>}
            </div>
          )}
        </div>

        <div style={{ padding: 22 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && dados && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* ── 1. Fiscal: Declaração do Simples + evolução do faturamento ── */}
              {(dados.gerenciais || dados.historico.length > 0) && (
                <Secao titulo={`Fiscal — competência ${competencia}`} icone={<TrendingUpIcon size={14} />}
                  extra={dados.gerenciais?.storage_path && <BotaoLink onClick={() => baixar(dados.gerenciais.storage_path)}>Declaração</BotaoLink>}>
                  {dados.gerenciais && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: dados.historico.length > 0 ? 14 : 0 }}>
                      <Mini label="Faturamento do mês" valor={fmt(dados.gerenciais.faturamento_periodo)} />
                      <Mini label="RBT12" valor={fmt(dados.gerenciais.rbt12)} />
                      <Mini label="Alíquota efetiva" valor={semMovimento ? '—' : fmtPct(dados.gerenciais.aliquota_efetiva)} cor="var(--accent)" />
                      <Mini label="DAS" valor={semMovimento ? 'Sem movimento' : fmt(dados.gerenciais.valor_das)} cor={semMovimento ? 'var(--ok)' : undefined} />
                    </div>
                  )}
                  {dados.historico.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: 6 }}>Evolução do faturamento</div>
                      <GraficoFaturamento dados={dados.historico} />
                    </div>
                  )}
                </Secao>
              )}

              {/* ── 2. Cards: vencidos / a vencer (valor total) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <Indicador icone={<AlertTriangleIcon size={13} />} titulo="Vencidos"
                  valor={vencidos.length === 0 ? 'Nenhum' : temValor(vencidos) ? fmt(somaValores(vencidos)) : 'Valor na guia'}
                  sub={vencidos.length === 0 ? 'Nada vencido' : [
                    pendencias.length > 0 && plural(pendencias.length, 'débito na Receita/PGFN', 'débitos na Receita/PGFN'),
                    guiasVencidas.length > 0 && plural(guiasVencidas.length, 'guia vencida', 'guias vencidas'),
                  ].filter(Boolean).join(' · ') + (vencidos.some((v) => v.valor == null) && temValor(vencidos) ? ' · + valores nas guias' : '')}
                  s={vencidos.length > 0 ? 'danger' : 'ok'} />
                <Indicador icone={<ClockIcon size={13} />} titulo="A vencer"
                  valor={aVencer.length === 0 ? 'Nenhum' : temValor(aVencer) ? fmt(somaValores(aVencer)) : 'Valor na guia'}
                  sub={aVencer.length === 0 ? 'Nenhuma guia a vencer' : proximoVencimento
                    ? `${datasAVencer.size > 1 ? 'Próximo vencimento' : 'Vencimento'}: ${fmtData(proximoVencimento)}${aVencer.some((g) => g.valor == null) && temValor(aVencer) ? ' · + valores nas guias' : ''}`
                    : plural(aVencer.length, 'guia', 'guias')}
                  s={aVencer.length === 0 ? 'ok' : aVencer.some(alertaUrgente) ? 'warn' : 'neutral'} />
              </div>

              {/* ── 3. Impostos (guias anexadas) ── */}
              <Secao titulo={`Impostos da competência ${competencia}`} icone={<CalendarIcon size={14} />}
                extra={temValor(guias) && <Total valor={somaValores(guias)} />}>
                {guias.length === 0
                  ? <Vazio>Nenhuma guia de imposto anexada para essa competência.</Vazio>
                  : <div style={LISTA}>{guias.map((g) => <LinhaGuia key={g.id} g={g} onBaixar={baixar} />)}</div>}
              </Secao>

              {/* ── 4. Pendências (Relatório de Situação Fiscal) ── */}
              <Secao titulo="Pendências — Relatório de Situação Fiscal" icone={<AlertTriangleIcon size={14} />}
                extra={pendencias.length > 0 && <Total valor={somaValores(pendencias)} cor="var(--danger)" />}>
                {!dados.situacaoFiscal
                  ? <Vazio>Relatório de Situação Fiscal ainda não enviado.</Vazio>
                  : pendencias.length === 0
                    ? <Vazio ok>Nenhuma pendência na Receita Federal nem em Dívida Ativa.</Vazio>
                    : <div style={LISTA}>{pendencias.map((p) => <LinhaPendencia key={p.id} p={p} />)}</div>}
                {dados.situacaoFiscal && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
                    <span>
                      Relatório emitido em {dados.situacaoFiscal.data_emissao ? fmtData(dados.situacaoFiscal.data_emissao) : dados.situacaoFiscal.competencia}
                      {pendencias.length > 0 ? ' · saldo atualizado conforme o relatório.' : '.'}
                    </span>
                    {dados.situacaoFiscal.storage_path && (
                      <BotaoLink onClick={() => baixar(dados.situacaoFiscal.storage_path)}>Baixar relatório</BotaoLink>
                    )}
                  </div>
                )}
              </Secao>

              {/* ── 5. Obrigações e tarefas (Fiscal/Folha) ── */}
              {itensArea.length > 0 && (
                <Secao titulo="Obrigações e tarefas do mês" icone={<ClipboardListIcon size={14} />}>
                  <div style={LISTA}>{itensArea.map((it) => <LinhaObrigacao key={it.id} it={it} onBaixar={baixar} />)}</div>
                </Secao>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Gerado pelo Gestor — Escritório Contábil.
        </div>
      </div>
    </div>
  );
}

// Só impostos da competência com guia anexada. Exceção: o DAS de um mês
// com faturamento zerado na Declaração do Simples não tem guia (não há o
// que pagar) — entra como "Sem movimento" pro cliente saber que está ok.
function montarGuias({ impostos, anexos, gerenciais }, competencia) {
  const semMovimento = gerenciais != null && gerenciais.faturamento_periodo != null && Number(gerenciais.faturamento_periodo) === 0;
  const guias = impostos
    .filter((o) => anexos[o.id] || (semMovimento && ehDas(o)))
    .map((o) => {
      const das = ehDas(o);
      return {
        id: o.id,
        titulo: o.titulo || o.tipo,
        competencia: o.competencia || competencia,
        area: o.departamentos?.nome || null,
        vencimento: o.vencimento,
        // vencida + concluída = o escritório já deu baixa, não é alerta
        dias: diasParaVencer(o.vencimento),
        concluida: o.status === 'concluido' || o.status === 'nao_aplica',
        semMovimento: das && semMovimento,
        valor: das && !semMovimento && gerenciais?.valor_das != null ? Number(gerenciais.valor_das) : null,
        anexo: anexos[o.id] || null,
      };
    });
  if (semMovimento && !impostos.some(ehDas)) {
    guias.push({ id: 'das-sem-movimento', titulo: 'DAS — Simples Nacional', competencia, area: 'Fiscal',
      vencimento: null, dias: null, concluida: true, semMovimento: true, valor: null, anexo: null });
  }
  return guias.sort((a, b) => (a.vencimento || '9999-99-99').localeCompare(b.vencimento || '9999-99-99'));
}

// Débitos (RFB) + inscrições em Dívida Ativa (PGFN) do relatório mais
// recente, ordenados por competência. `valor` já é o saldo atualizado
// (ver extrair-situacao-fiscal.js).
function montarPendencias(situacaoFiscal) {
  if (!situacaoFiscal) return [];
  const debitos = (situacaoFiscal.debitos || []).map((d, i) => ({
    id: `deb-${i}`, origem: 'Receita Federal', nome: nomeTributo(d.tributo), codigo: d.tributo || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: d.vencimento || null,
    valorOriginal: d.valorOriginal ?? null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  const dividas = (situacaoFiscal.dividas_ativas || []).map((d, i) => ({
    id: `pgfn-${i}`, origem: 'Dívida Ativa (PGFN)', nome: d.tributo ? nomeTributo(d.tributo) : 'Dívida ativa',
    codigo: [d.tributo, d.inscricao ? `Inscrição ${d.inscricao}` : null].filter(Boolean).join(' · ') || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: null,
    valorOriginal: null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  return [...debitos, ...dividas].sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia));
}

// Obrigações (não-imposto) e tarefas de Fiscal/Folha do mês. Concluída sem
// anexo não interessa ao cliente (não há nada pra ele ver/baixar) — só
// entra concluída se tiver documento anexado; pendente entra sempre.
function montarObrigacoesTarefas({ outrasObrigacoes, tarefasArea, anexos, anexosTarefa }, competencia) {
  const obrigacoes = outrasObrigacoes
    .filter((o) => !(o.status === 'concluido' || o.status === 'nao_aplica') || anexos[o.id])
    .map((o) => ({
      id: o.id, titulo: o.titulo || o.tipo, area: areaObrigacao(o), competencia: o.competencia || competencia,
      status: o.status, vencimento: o.vencimento, anexo: anexos[o.id] || null,
    }));
  const tarefas = tarefasArea
    .filter((t) => !t.concluida || anexosTarefa[t.id])
    .map((t) => ({
      id: t.id, titulo: t.titulo, area: areaTarefa(t), competencia,
      status: t.concluida ? 'concluido' : 'pendente', vencimento: t.vencimento, anexo: anexosTarefa[t.id] || null,
    }));
  const ordemStatus = { vencido: 0, pendente: 1, concluido: 2, nao_aplica: 3 };
  return [...obrigacoes, ...tarefas].sort((a, b) => (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9)
    || (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
}

const alertaVencida = (g) => !g.semMovimento && !g.concluida && g.dias != null && g.dias < 0;
const alertaUrgente = (g) => !g.semMovimento && g.dias != null && g.dias >= 0 && g.dias <= 3;

const LISTA = { display: 'flex', flexDirection: 'column', gap: 6 };
const COR_S = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', neutral: 'var(--text1)' };
const STATUS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

function ChipCabecalho({ children }) {
  return (
    <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
      {children}
    </span>
  );
}

// Situação perante o fisco nas 3 esferas — federal vem do Relatório de
// Situação Fiscal (IA), estadual/municipal da marcação manual (cnd_manual).
function ChipSituacao({ situacaoFiscal, cndManual }) {
  const esferas = [situacaoFiscal?.situacao_geral, cndManual?.situacao_estadual, cndManual?.situacao_municipal].filter(Boolean);
  if (esferas.length === 0) return null;
  const pendente = esferas.includes('pendente');
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: '3px 9px', color: '#fff',
      background: pendente ? 'var(--danger)' : 'var(--ok)' }}>
      {pendente ? 'Situação fiscal: com pendências' : 'Situação fiscal: regular'}
    </span>
  );
}

function Secao({ titulo, icone, extra, children }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {icone} {titulo}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Total({ valor, cor }) {
  return <span style={{ fontSize: 13, fontWeight: 800, color: cor || 'var(--text1)', whiteSpace: 'nowrap' }}>{fmt(valor)}</span>;
}

function Vazio({ children, ok }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 'var(--r-md)', fontSize: 12.5,
      background: ok ? 'var(--ok-dim)' : 'var(--bg)', color: ok ? 'var(--ok)' : 'var(--text3)', border: ok ? 'none' : '1px dashed var(--border)' }}>
      {ok && <CheckCircleIcon size={15} />} {children}
    </div>
  );
}

function BotaoLink({ onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--accent)',
        background: 'var(--accent-dim)', border: 'none', borderRadius: 99, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <DownloadIcon size={11} /> {children}
    </button>
  );
}

function BotaoGuia({ anexo, onBaixar, label = 'Guia' }) {
  return (
    <button type="button" onClick={() => onBaixar(anexo.storage_path)} title={`Baixar ${anexo.nome_arquivo}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'var(--accent)',
        border: 'none', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <DownloadIcon size={13} /> {label}
    </button>
  );
}

function Mini({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '9px 11px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 3 }}>{valor}</div>
    </div>
  );
}

function Indicador({ icone, titulo, valor, sub, s }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: `3px solid ${s === 'neutral' ? 'var(--border2)' : COR_S[s]}`,
      borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {titulo}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: COR_S[s], marginTop: 6 }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// Linha base: título com a competência ao lado ("INSS Mensal 06/2026"),
// detalhes embaixo, valor/ações à direita.
function Linha({ corBorda, titulo, competencia, detalhes, direita }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${corBorda}`, borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 700 }}>
          {titulo}{competencia && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>{competencia}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap', fontSize: 10.5 }}>{detalhes}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>{direita}</div>
    </div>
  );
}

function LinhaGuia({ g, onBaixar }) {
  const vencida = alertaVencida(g);
  const urgente = alertaUrgente(g);
  const corBorda = g.semMovimento ? 'var(--ok)' : vencida ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--accent)';
  return (
    <Linha corBorda={corBorda} titulo={g.titulo} competencia={g.competencia}
      detalhes={(
        <>
          {g.area && <span style={{ color: 'var(--text3)' }}>{g.area}</span>}
          {g.vencimento && !g.semMovimento && (
            <span style={{ color: vencida ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--text3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {fmtData(g.vencimento)}{g.concluida && g.dias < 0 ? '' : ` · ${fmtDias(g.dias)}`}
            </span>
          )}
        </>
      )}
      direita={(
        <>
          {g.semMovimento ? (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ok)', background: 'var(--ok-dim)', borderRadius: 99, padding: '4px 10px', whiteSpace: 'nowrap' }}>
              Sem movimento
            </span>
          ) : (
            <span style={{ fontSize: g.valor != null ? 14 : 11, fontWeight: g.valor != null ? 800 : 500, color: g.valor != null ? 'var(--text1)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
              {g.valor != null ? fmt(g.valor) : 'valor na guia'}
            </span>
          )}
          {g.anexo && <BotaoGuia anexo={g.anexo} onBaixar={onBaixar} />}
        </>
      )} />
  );
}

function LinhaPendencia({ p }) {
  return (
    <Linha corBorda="var(--danger)" titulo={p.nome} competencia={p.competencia}
      detalhes={(
        <>
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{p.origem}</span>
          {p.situacao && <span style={{ color: 'var(--text3)' }}>{p.situacao}</span>}
          {p.vencimento && <span style={{ color: 'var(--text3)' }}>venc. {fmtData(p.vencimento)}</span>}
          {p.codigo && <span style={{ color: 'var(--text3)', opacity: 0.8 }}>{p.codigo}</span>}
        </>
      )}
      direita={(
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)', whiteSpace: 'nowrap' }}>{p.valor != null ? fmt(p.valor) : '—'}</div>
          {p.valorOriginal != null && Number(p.valorOriginal) !== Number(p.valor) && (
            <div style={{ fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>original {fmt(p.valorOriginal)}</div>
          )}
        </div>
      )} />
  );
}

function LinhaObrigacao({ it, onBaixar }) {
  const [cor, dim] = STATUS_COR[it.status] || ['var(--text3)', 'var(--surface2)'];
  const dias = diasParaVencer(it.vencimento);
  const aberta = it.status === 'pendente' || it.status === 'vencido';
  return (
    <Linha corBorda={cor} titulo={it.titulo} competencia={it.competencia}
      detalhes={(
        <>
          {it.area && <span style={{ color: 'var(--text3)' }}>{it.area}</span>}
          {it.vencimento && (
            <span style={{ color: aberta && dias < 0 ? 'var(--danger)' : 'var(--text3)', fontWeight: aberta ? 600 : 400, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {fmtData(it.vencimento)}{aberta ? ` · ${fmtDias(dias)}` : ''}
            </span>
          )}
        </>
      )}
      direita={(
        <>
          {it.anexo && <BotaoGuia anexo={it.anexo} onBaixar={onBaixar} label="Baixar" />}
          <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: dim, borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
            {STATUS_LABEL[it.status] || it.status}
          </span>
        </>
      )} />
  );
}
