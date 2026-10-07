import { useEffect, useState } from 'react';
import {
  CalendarIcon, DownloadIcon, CheckCircleIcon, FileTextIcon, AlertTriangleIcon, ClockIcon, ShieldCheckIcon,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { abrirLinkAssinado } from '../documentos/documentosApi';
import {
  obterResumoObrigacoes, obterResumoTarefas, obterDadosGerenciais, obterDocumentosPorObrigacao,
  obterSituacaoFiscalMaisRecente, obterCndManual, obterPendenciasAnteriores, obterValoresDasPendencias,
} from './painelApi';

// Página pública (link compartilhado com o cliente, ?painel=<id>&competencia=MM/YYYY
// — ver main.jsx). Diferente do painel interno (PainelClientePage.jsx, que
// continua sendo o que o escritório vê de dentro do app), aqui é tudo numa
// página só, sem abas, e só com o que interessa ao cliente de Fiscal e
// Folha: impostos em aberto (Relatório de Situação Fiscal + guias vencidas),
// impostos a vencer (guias anexadas às obrigações, com valor e download) e
// o andamento das obrigações dessas duas áreas no mês.

const STATUS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };
const STATUS_COR = {
  pendente: ['var(--warn)', 'var(--warn-dim)'],
  concluido: ['var(--ok)', 'var(--ok-dim)'],
  nao_aplica: ['var(--info)', 'var(--info-dim)'],
  vencido: ['var(--danger)', 'var(--danger-dim)'],
};

// Mesmo fallback de PainelClientePage.jsx pra obrigações legadas sem
// tipo_obrigacao_id (não resolvem o join com tipos_obrigacao.eh_imposto).
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
  'INSS MENSAL',
]);
// Além da marcação eh_imposto, reconhece guia de imposto pelo nome (FGTS,
// DARF etc. nem sempre estão marcados) — anexo de obrigação que não é
// imposto (ex: holerites na obrigação "Folha") não é guia a pagar.
const TITULO_IMPOSTO = /(pg)?das|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i;
function ehImposto(o) {
  return o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`);
}
function ehDas(o) {
  return /\b(pg)?das\b/i.test(`${o.titulo || ''} ${o.tipo || ''}`);
}

// Área (Fiscal/Folha) da obrigação pelo nome do departamento. Imposto
// legado sem departamento cai em Fiscal; qualquer outra área (Contábil,
// Societário...) fica de fora da página compartilhada.
function areaObrigacao(o) {
  const nome = (o.departamentos?.nome || '').toLowerCase();
  if (/folha|pessoal|dp\b/.test(nome)) return 'Folha';
  if (/fiscal/.test(nome)) return 'Fiscal';
  if (!nome && ehImposto(o)) return 'Fiscal';
  return null;
}
function areaTarefa(t) {
  const d = (t.departamento || '').toLowerCase();
  if (d === 'folha' || d === 'pessoal') return 'Folha';
  if (d === 'fiscal') return 'Fiscal';
  return null;
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
const somaValores = (itens) => itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
const temValor = (itens) => itens.some((it) => it.valor != null);
// Total em R$ quando ao menos um item tem valor conhecido; senão a
// contagem (só DAS/débitos da RFB trazem valor — "R$ 0,00" enganaria).
const resumoItens = (itens, singular, plural) => (temValor(itens)
  ? fmt(somaValores(itens))
  : `${itens.length} ${itens.length === 1 ? singular : plural}`);

export default function PainelCompartilhadoPage({ clienteId, competencia: competenciaInicial }) {
  const [competencia, setCompetencia] = useState(competenciaInicial);
  const opcoesComp = opcoesCompetencia(competenciaInicial);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, obs, tarefas, gerenciais, situacaoFiscal, cndManual, pendenciasAnt] = await Promise.all([
          supabase.from('clientes').select('nome, cnpj, regime').eq('id', clienteId).single(),
          obterResumoObrigacoes(clienteId, competencia),
          obterResumoTarefas(clienteId, competencia),
          // tabelas novas toleram ainda não existir no banco, igual ao painel interno
          obterDadosGerenciais(clienteId, competencia).catch(() => null),
          obterSituacaoFiscalMaisRecente(clienteId, competencia).catch(() => null),
          obterCndManual(clienteId, competencia).catch(() => null),
          obterPendenciasAnteriores(clienteId, competencia).catch(() => ({ obrigacoes: [], tarefas: [] })),
        ]);
        if (errCliente) throw errCliente;

        const obrigacoesMes = obs.itens.filter((o) => areaObrigacao(o));
        const obrigacoesAnteriores = pendenciasAnt.obrigacoes.filter((o) => areaObrigacao(o));
        const todas = [...obrigacoesAnteriores, ...obrigacoesMes];

        const [anexos, valoresDas] = await Promise.all([
          obterDocumentosPorObrigacao(todas.map((o) => o.id)).catch(() => ({})),
          obterValoresDasPendencias(clienteId, [...new Set(todas.filter(ehDas).map((o) => o.competencia || competencia))]).catch(() => ({})),
        ]);
        if (gerenciais?.valor_das != null) valoresDas[competencia] = gerenciais.valor_das;

        setDados({
          cliente, gerenciais, situacaoFiscal, cndManual, anexos, valoresDas,
          obrigacoesMes, obrigacoesAnteriores,
          tarefasMes: tarefas.itens.filter((t) => areaTarefa(t)),
          tarefasAnteriores: pendenciasAnt.tarefas.filter((t) => areaTarefa(t)),
        });
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [clienteId, competencia]);

  const baixar = (storagePath) => abrirLinkAssinado(storagePath).catch(() => null);

  const calc = dados && montarImpostos(dados, competencia);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 12px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>

        {/* ── Cabeçalho ── */}
        <div style={{ padding: '20px 22px', background: 'var(--navy)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Resumo fiscal e folha
              </div>
              <div style={{ fontSize: 19, color: '#fff', fontWeight: 700, marginTop: 4 }}>{carregando && !dados ? '...' : dados?.cliente?.nome}</div>
              {dados?.cliente && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {dados.cliente.cnpj && <ChipCabecalho>{dados.cliente.cnpj}</ChipCabecalho>}
                  <ChipCabecalho>{dados.cliente.regime || 'SN'}</ChipCabecalho>
                </div>
              )}
            </div>
            <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
              style={{ fontSize: 12, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
                borderRadius: 6, padding: '5px 8px', fontWeight: 600 }}>
              {opcoesComp.map((c) => <option key={c} value={c} style={{ color: '#000' }}>Competência {c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ padding: 22 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && calc && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* ── Indicadores ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                <Indicador
                  icone={<AlertTriangleIcon size={13} />} titulo="Impostos em aberto"
                  valor={calc.emAberto.length === 0 ? 'Nenhum' : resumoItens(calc.emAberto, 'item', 'itens')}
                  sub={calc.emAberto.length === 0 ? 'Nada vencido ou em débito' : temValor(calc.emAberto) ? `${calc.emAberto.length} ${calc.emAberto.length === 1 ? 'item' : 'itens'}${calc.emAberto.some((i) => i.valor == null) ? ' · alguns sem valor informado' : ''}` : 'valores nas guias/relatório'}
                  s={calc.emAberto.length > 0 ? 'danger' : 'ok'} />
                <Indicador
                  icone={<ClockIcon size={13} />} titulo="Impostos a vencer"
                  valor={calc.aVencer.length === 0 ? 'Nenhum' : resumoItens(calc.aVencer, 'guia', 'guias')}
                  sub={calc.aVencer.length === 0 ? 'Nenhuma guia pendente' : calc.proximoVencimento ? `Próximo: ${fmtData(calc.proximoVencimento)}` : `${calc.aVencer.length} guia${calc.aVencer.length !== 1 ? 's' : ''}`}
                  s={calc.aVencer.length === 0 ? 'ok' : calc.aVencer.some((i) => i.dias != null && i.dias <= 3) ? 'warn' : 'neutral'} />
                <IndicadorSituacao situacaoFiscal={dados.situacaoFiscal} cndManual={dados.cndManual} />
              </div>

              {/* ── Impostos a vencer ── */}
              <Secao titulo="Impostos a vencer" icone={<CalendarIcon size={14} />}
                extra={temValor(calc.aVencer) && <TotalSecao valor={somaValores(calc.aVencer)} />}>
                {calc.aVencer.length === 0
                  ? <Vazio>Nenhuma guia a vencer anexada para essa competência.</Vazio>
                  : <div style={LISTA}>{calc.aVencer.map((it) => <LinhaImposto key={it.id} it={it} onBaixar={baixar} />)}</div>}
              </Secao>

              {/* ── Impostos em aberto ── */}
              <Secao titulo="Impostos em aberto" icone={<AlertTriangleIcon size={14} />}
                extra={temValor(calc.emAberto) && <TotalSecao valor={somaValores(calc.emAberto)} cor="var(--danger)" />}>
                {calc.emAberto.length === 0
                  ? <Vazio ok>Nenhum imposto em aberto{dados.situacaoFiscal ? ' na Receita Federal nem guias vencidas' : ''}.</Vazio>
                  : <div style={LISTA}>{calc.emAberto.map((it) => <LinhaImposto key={it.id} it={it} onBaixar={baixar} aberto />)}</div>}

                {dados.situacaoFiscal?.parcelamentos?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Subtitulo>Parcelamentos ativos</Subtitulo>
                    <div style={LISTA}>
                      {dados.situacaoFiscal.parcelamentos.map((p, i) => (
                        <LinhaSimples key={i} titulo={p.modalidade || 'Parcelamento'} sub={p.parcelas || null} valor={p.valor} />
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--text3)' }}>
                  <span>
                    {dados.situacaoFiscal
                      ? `Base: Relatório de Situação Fiscal (RFB)${dados.situacaoFiscal.data_emissao ? ` emitido em ${fmtData(dados.situacaoFiscal.data_emissao)}` : ` de ${dados.situacaoFiscal.competencia}`} e guias anexadas.`
                      : 'Relatório de Situação Fiscal ainda não enviado — exibindo só as guias vencidas.'}
                  </span>
                  {dados.situacaoFiscal?.storage_path && (
                    <BotaoLink onClick={() => baixar(dados.situacaoFiscal.storage_path)}>Baixar relatório</BotaoLink>
                  )}
                </div>
              </Secao>

              {/* ── Fiscal + Folha ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
                <CardArea titulo="Fiscal" icone="🧾"
                  obrigacoes={dados.obrigacoesMes.filter((o) => areaObrigacao(o) === 'Fiscal')}
                  tarefas={dados.tarefasMes.filter((t) => areaTarefa(t) === 'Fiscal' && !t.concluida)}
                  anexos={dados.anexos} onBaixar={baixar}>
                  {dados.gerenciais && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <Subtitulo semMargem>Declaração do Simples{dados.gerenciais.anexo ? ` · Anexo ${dados.gerenciais.anexo}` : ''}</Subtitulo>
                        {dados.gerenciais.storage_path && (
                          <BotaoLink onClick={() => baixar(dados.gerenciais.storage_path)}>Baixar</BotaoLink>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <Mini label="Faturamento" valor={fmt(dados.gerenciais.faturamento_periodo)} />
                        <Mini label="RBT12" valor={fmt(dados.gerenciais.rbt12)} />
                        <Mini label="Alíquota efetiva" valor={fmtPct(dados.gerenciais.aliquota_efetiva)} cor="var(--accent)" />
                        <Mini label="DAS" valor={fmt(dados.gerenciais.valor_das)} />
                      </div>
                    </div>
                  )}
                </CardArea>
                <CardArea titulo="Folha" icone="👥"
                  obrigacoes={dados.obrigacoesMes.filter((o) => areaObrigacao(o) === 'Folha')}
                  tarefas={dados.tarefasMes.filter((t) => areaTarefa(t) === 'Folha' && !t.concluida)}
                  anexos={dados.anexos} onBaixar={baixar} />
              </div>

              {(calc.pendenciasAnteriores.length > 0 || dados.tarefasAnteriores.length > 0) && (
                <Secao titulo="Pendências de meses anteriores" icone={<ClockIcon size={14} />}>
                  <div style={LISTA}>
                    {calc.pendenciasAnteriores.map((o) => (
                      <LinhaSimples key={o.id} titulo={o.titulo || o.tipo} sub={`${areaObrigacao(o)} · ${o.competencia}`}
                        status={o.status} vencimento={o.vencimento} />
                    ))}
                    {dados.tarefasAnteriores.map((t) => (
                      <LinhaSimples key={t.id} titulo={t.titulo} sub={`${areaTarefa(t)} · ${t.competencia}`} status="pendente" vencimento={t.vencimento} />
                    ))}
                  </div>
                </Secao>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Gerado pelo Gestor — Escritório Contábil. Valores das guias conforme documentos anexados pelo escritório.
        </div>
      </div>
    </div>
  );
}

// Separa os impostos em "a vencer" (guia anexada, ainda no prazo) e "em
// aberto" (guia/imposto vencido sem baixa + débitos e dívida ativa do
// Relatório de Situação Fiscal). Valor da guia: só o DAS tem valor
// conhecido (vem da Declaração do Simples da mesma competência) — as
// demais guias mostram "valor na guia" e o cliente baixa o PDF.
function montarImpostos(dados, competencia) {
  const { obrigacoesMes, obrigacoesAnteriores, anexos, valoresDas, gerenciais, situacaoFiscal } = dados;
  const aVencer = [];
  const emAberto = [];

  [...obrigacoesAnteriores, ...obrigacoesMes].forEach((o) => {
    if (!ehImposto(o)) return;
    const anexo = anexos[o.id] || null;
    const dias = diasParaVencer(o.vencimento);
    const concluida = o.status === 'concluido' || o.status === 'nao_aplica';
    const comp = o.competencia || competencia;
    const item = {
      id: o.id,
      titulo: o.titulo || o.tipo,
      sub: `${areaObrigacao(o)} · competência ${comp}`,
      vencimento: o.vencimento,
      dias,
      valor: ehDas(o) ? (valoresDas[comp] ?? null) : null,
      anexo,
    };
    if (dias != null && dias < 0) {
      if (!concluida) emAberto.push({ ...item, origem: anexo ? 'Guia vencida' : 'Imposto vencido' });
    } else if (anexo) {
      aVencer.push(item);
    }
  });

  // Declaração do Simples enviada mas sem obrigação de DAS cadastrada no
  // mês — o valor ainda é informação útil, só não tem guia pra baixar.
  const temDasNoMes = obrigacoesMes.some(ehDas);
  if (gerenciais?.valor_das > 0 && !temDasNoMes) {
    aVencer.push({ id: 'das-declaracao', titulo: 'DAS — Simples Nacional', sub: `Fiscal · competência ${competencia}`,
      vencimento: null, dias: null, valor: gerenciais.valor_das, anexo: null, semGuia: true });
  }

  (situacaoFiscal?.debitos || []).forEach((d, i) => {
    emAberto.push({ id: `deb-${i}`, titulo: d.tributo || 'Débito', sub: d.situacao || null, valor: d.valor ?? null, origem: 'Receita Federal' });
  });
  (situacaoFiscal?.dividas_ativas || []).forEach((d, i) => {
    emAberto.push({ id: `pgfn-${i}`, titulo: d.inscricao ? `Inscrição ${d.inscricao}` : 'Dívida ativa', sub: d.situacao || null, valor: d.valor ?? null, origem: 'Dívida Ativa (PGFN)' });
  });

  aVencer.sort((a, b) => (a.vencimento || '9999-99-99').localeCompare(b.vencimento || '9999-99-99'));
  emAberto.sort((a, b) => (a.vencimento || '9999-99-99').localeCompare(b.vencimento || '9999-99-99'));
  const proximoVencimento = aVencer.find((i) => i.vencimento)?.vencimento || null;
  // impostos/guias de meses anteriores já listados acima não se repetem aqui
  const jaListados = new Set([...aVencer, ...emAberto].map((i) => i.id));
  const pendenciasAnteriores = obrigacoesAnteriores.filter((o) => !jaListados.has(o.id));
  return { aVencer, emAberto, proximoVencimento, pendenciasAnteriores };
}

const LISTA = { display: 'flex', flexDirection: 'column', gap: 6 };
const COR_S = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', neutral: 'var(--text1)' };

function ChipCabecalho({ children }) {
  return (
    <span style={{ fontSize: 10.5, color: 'var(--navy-text)', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 99, padding: '3px 9px' }}>
      {children}
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

function Subtitulo({ children, semMargem }) {
  return <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, marginBottom: semMargem ? 0 : 6 }}>{children}</div>;
}

function TotalSecao({ valor, cor }) {
  return <span style={{ fontSize: 13, fontWeight: 800, color: cor || 'var(--text1)' }}>{fmt(valor)}</span>;
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

// Situação perante o fisco nas 3 esferas — federal vem do Relatório de
// Situação Fiscal (IA), estadual/municipal da marcação manual (cnd_manual).
function IndicadorSituacao({ situacaoFiscal, cndManual }) {
  const esferas = [
    { label: 'Federal', s: situacaoFiscal?.situacao_geral, anexo: null },
    { label: 'Estadual', s: cndManual?.situacao_estadual, anexo: cndManual?.anexo_estadual_path },
    { label: 'Municipal', s: cndManual?.situacao_municipal, anexo: cndManual?.anexo_municipal_path },
  ];
  const informadas = esferas.filter((e) => e.s);
  const s = informadas.length === 0 ? 'neutral' : informadas.some((e) => e.s === 'pendente') ? 'danger' : 'ok';
  const valor = informadas.length === 0 ? '—' : s === 'danger' ? 'Com pendências' : 'Regular';
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderTop: `3px solid ${s === 'neutral' ? 'var(--border2)' : COR_S[s]}`,
      borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        <ShieldCheckIcon size={13} /> Situação fiscal
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: COR_S[s], marginTop: 6 }}>{valor}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
        {esferas.map((e) => {
          const cor = e.s === 'regular' ? 'var(--ok)' : e.s === 'pendente' ? 'var(--danger)' : 'var(--text3)';
          const dim = e.s === 'regular' ? 'var(--ok-dim)' : e.s === 'pendente' ? 'var(--danger-dim)' : 'var(--surface2)';
          return (
            <span key={e.label} title={e.s === 'regular' ? 'Regular' : e.s === 'pendente' ? 'Com pendências' : 'Não informado'}
              style={{ fontSize: 9.5, fontWeight: 700, color: cor, background: dim, borderRadius: 99, padding: '2px 7px' }}>
              {e.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LinhaImposto({ it, onBaixar, aberto }) {
  const urgente = aberto || (it.dias != null && it.dias <= 3);
  const corPrazo = aberto ? 'var(--danger)' : it.dias != null && it.dias <= 3 ? 'var(--warn)' : 'var(--text3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${aberto ? 'var(--danger)' : urgente ? 'var(--warn)' : 'var(--accent)'}`, borderRadius: 'var(--r-md)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--text1)', fontWeight: 700 }}>{it.titulo}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap', fontSize: 10.5 }}>
          {it.origem && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{it.origem}</span>}
          {it.sub && <span style={{ color: 'var(--text3)' }}>{it.sub}</span>}
          {it.vencimento && (
            <span style={{ color: corPrazo, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CalendarIcon size={10} /> {fmtData(it.vencimento)} · {fmtDias(it.dias)}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <span style={{ fontSize: it.valor != null ? 14 : 11, fontWeight: it.valor != null ? 800 : 500, color: it.valor != null ? 'var(--text1)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
          {it.valor != null ? fmt(it.valor) : it.anexo ? 'valor na guia' : '—'}
        </span>
        {it.anexo ? (
          <button type="button" onClick={() => onBaixar(it.anexo.storage_path)} title={`Baixar ${it.anexo.nome_arquivo}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'var(--accent)',
              border: 'none', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <DownloadIcon size={13} /> Guia
          </button>
        ) : it.semGuia ? (
          <span style={{ fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>guia ainda não anexada</span>
        ) : null}
      </div>
    </div>
  );
}

function LinhaSimples({ titulo, sub, valor, status, vencimento, anexo, onBaixar }) {
  const [cor, dim] = STATUS_COR[status] || [];
  const dias = diasParaVencer(vencimento);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titulo}</div>
        {(sub || vencimento) && (
          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 1 }}>
            {sub}{sub && vencimento ? ' · ' : ''}{vencimento ? `${fmtData(vencimento)}${status !== 'concluido' && status !== 'nao_aplica' ? ` (${fmtDias(dias)})` : ''}` : ''}
          </div>
        )}
      </div>
      {valor != null && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text1)', whiteSpace: 'nowrap' }}>{fmt(valor)}</span>}
      {anexo && (
        <button type="button" onClick={() => onBaixar(anexo.storage_path)} title={`Baixar ${anexo.nome_arquivo}`}
          style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 24, height: 24, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
          <DownloadIcon size={12} />
        </button>
      )}
      {status && (
        <span style={{ fontSize: 10, fontWeight: 700, color: cor, background: dim, borderRadius: 99, padding: '3px 9px', flexShrink: 0 }}>
          {STATUS_LABEL[status]}
        </span>
      )}
    </div>
  );
}

function Mini({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 9px' }}>
      <div style={{ fontSize: 9.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: cor || 'var(--text1)', marginTop: 2 }}>{valor}</div>
    </div>
  );
}

// Card de uma área (Fiscal/Folha) com o andamento das obrigações do mês —
// barra de progresso + lista com status e download do que já foi anexado.
function CardArea({ titulo, icone, obrigacoes, tarefas, anexos, onBaixar, children }) {
  const ok = obrigacoes.filter((o) => o.status === 'concluido' || o.status === 'nao_aplica').length;
  const vencidas = obrigacoes.filter((o) => o.status === 'vencido').length;
  const pct = obrigacoes.length ? Math.round((ok / obrigacoes.length) * 100) : null;
  const cor = vencidas > 0 ? 'var(--danger)' : pct === 100 ? 'var(--ok)' : 'var(--warn)';
  const ordenadas = [...obrigacoes].sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text1)' }}>{icone} {titulo}</div>
        {pct != null && <span style={{ fontSize: 12, fontWeight: 700, color: cor }}>{ok}/{obrigacoes.length} concluídas</span>}
      </div>
      {pct != null && (
        <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 99, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: cor, borderRadius: 99 }} />
        </div>
      )}
      {children}
      {obrigacoes.length === 0 && tarefas.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 0' }}>Nenhuma obrigação de {titulo.toLowerCase()} nessa competência.</div>
      ) : (
        <>
          {obrigacoes.length > 0 && <Subtitulo>Obrigações do mês</Subtitulo>}
          <div style={LISTA}>
            {ordenadas.map((o) => (
              <LinhaSimples key={o.id} titulo={o.titulo || o.tipo} status={o.status} vencimento={o.vencimento}
                anexo={anexos[o.id]} onBaixar={onBaixar} />
            ))}
          </div>
          {tarefas.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Subtitulo>Em andamento</Subtitulo>
              <div style={LISTA}>
                {tarefas.map((t) => <LinhaSimples key={t.id} titulo={t.titulo} status="pendente" vencimento={t.vencimento} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
