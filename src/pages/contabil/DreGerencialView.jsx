import React, { useState } from 'react';
import { rotuloMes, fraseResumo } from '../../lib/dreGerencial';
import './contabil.css';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCurto = (v) => { const n = Math.round(Number(v) || 0); return (n === 0 ? 0 : n).toLocaleString('pt-BR'); };
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const sinal = (v) => (v > 0 ? '+' : '');

// Visualização da DRE gerencial (src/lib/dreGerencial.js): frase-resumo,
// indicadores, gráfico mensal, tabela por mês com detalhamento por
// contraparte e pontos de atenção. Usada na aba DRE e no link público.
export default function DreGerencialView({ dre, onAbrirLancamentos }) {
  const [aba, setAba] = useState('dre');
  if (!dre || dre.meses.length === 0) return <p style={{ color: 'var(--text2)' }}>Sem período selecionado.</p>;
  return (
    <div className="dre-g">
      <p className="dre-g-frase">{fraseResumo(dre)}</p>
      <Kpis dre={dre} />
      <div className="contabil-tabs" style={{ marginBottom: 12 }}>
        <button className="contabil-tab" data-active={aba === 'dre'} onClick={() => setAba('dre')}>DRE mensal</button>
        <button className="contabil-tab" data-active={aba === 'pontos'} onClick={() => setAba('pontos')}>
          Pontos de atenção e plano de ação ({dre.pontos.length})
        </button>
      </div>
      {aba === 'dre' ? (
        <>
          <Indicadores dre={dre} />
          <Grafico dre={dre} />
          <Tabela dre={dre} onAbrirLancamentos={onAbrirLancamentos} />
          <p style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 8 }}>
            DRE gerencial pelo regime de caixa dos extratos: receita bruta e DAS pelo PGDAS-D da competência (quando importado);
            não considera estoque nem depreciação. Clique numa linha com › para ver o detalhamento por contraparte.
          </p>
        </>
      ) : (
        <Pontos pontos={dre.pontos} />
      )}
    </div>
  );
}

function Kpis({ dre }) {
  const i = dre.indicadores;
  const m = i.mesReferencia;
  const ant = i.mesAnterior ? ` vs ${rotuloMes(i.mesAnterior)}` : '';
  const varTxt = (v, bomQuandoSobe = true) => (v == null ? { txt: 'sem mês anterior' } : { txt: `${sinal(v)}${fmtPct(v)}${ant}`, bom: bomQuandoSobe ? v >= 0 : v <= 0 });
  const tiles = [
    { rotulo: `Receita bruta — ${rotuloMes(m)}`, valor: fmt(i.receitaBruta.ultimo), ...varTxt(i.receitaBruta.variacao) },
    { rotulo: `Resultado operacional — ${rotuloMes(m)}`, valor: fmt(i.resultadoOperacional.ultimo), ...varTxt(i.resultadoOperacional.variacao) },
    {
      rotulo: 'Margem operacional', valor: fmtPct(i.margemOperacional.ultimo),
      ...(i.margemOperacional.variacaoPp == null ? { txt: 'sem mês anterior' } : { txt: `${sinal(i.margemOperacional.variacaoPp)}${i.margemOperacional.variacaoPp.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.${ant}`, bom: i.margemOperacional.variacaoPp >= 0 }),
    },
    { rotulo: `Saídas fora do resultado — ${rotuloMes(m)}`, valor: fmt(i.foraDoResultado.ultimo), ...varTxt(i.foraDoResultado.variacao, false) },
    { rotulo: 'Saldo em conta no fim do mês', valor: fmt(i.saldoEmConta.ultimo), txt: `variação no período: ${fmt(i.saldoEmConta.variacaoCaixaPeriodo)}` },
    {
      rotulo: 'Saídas identificadas', valor: fmtPct(i.identificacao.pctSaidasIdentificadas),
      txt: `${fmt(i.identificacao.valorAIdentificar)} a identificar`, bom: (i.identificacao.pctSaidasIdentificadas ?? 100) >= 90,
    },
  ];
  return (
    <div className="dre-g-kpis">
      {tiles.map((t) => (
        <div key={t.rotulo} className="dre-g-kpi">
          <div className="dre-g-kpi-rotulo">{t.rotulo}</div>
          <div className="dre-g-kpi-valor">{t.valor}</div>
          <div className="dre-g-kpi-var" data-bom={t.bom == null ? undefined : String(t.bom)}>
            {t.bom != null && (t.bom ? '▲ ' : '▼ ')}{t.txt}
          </div>
        </div>
      ))}
    </div>
  );
}

function Indicadores({ dre }) {
  const i = dre.indicadores;
  const itens = [
    ['Receita bruta no período', fmt(i.receitaBruta.periodo)],
    ['Resultado operacional no período', fmt(i.resultadoOperacional.periodo)],
    ['Margem bruta', fmtPct(i.margemBruta.periodo)],
    ['Margem operacional (período)', fmtPct(i.margemOperacional.periodo)],
    ['CMV / receita', fmtPct(i.cmvSobreReceita.periodo)],
    ['Despesas operacionais / receita', fmtPct(i.despesasSobreReceita.periodo)],
    ['Carga tributária (DAS / receita)', fmtPct(i.cargaTributaria.periodo)],
    ['Ponto de equilíbrio mensal', i.pontoEquilibrio.mensal == null ? '—' : fmt(i.pontoEquilibrio.mensal)],
    ['Saídas fora do resultado (período)', fmt(i.foraDoResultado.periodo)],
    ['Lançamentos a identificar', `${i.identificacao.qtdAIdentificar} de ${i.identificacao.qtdLancamentos}`],
  ];
  return (
    <div className="dre-g-indicadores">
      {itens.map(([r, v]) => <div key={r} className="dre-g-ind"><span>{r}</span><b>{v}</b></div>)}
    </div>
  );
}

const SERIES = [
  { chave: 'receitaBruta', rotulo: 'Receita bruta', cor: 'var(--serie-1)' },
  { chave: 'custosDespesas', rotulo: 'Custos e despesas', cor: 'var(--serie-2)' },
  { chave: 'resultadoOperacional', rotulo: 'Resultado operacional', cor: 'var(--serie-3)' },
  { chave: 'fora', rotulo: 'Fora do resultado', cor: 'var(--serie-4)' },
];

function Grafico({ dre }) {
  const [hover, setHover] = useState(null);
  const { meses, serie } = dre;
  const valor = (k, m) => (k === 'custosDespesas' ? (serie.custos[m] ?? 0) + (serie.despesas[m] ?? 0) : serie[k][m] ?? 0);
  const todos = meses.flatMap((m) => SERIES.map((s) => valor(s.chave, m)));
  const max = Math.max(1, ...todos);
  const min = Math.min(0, ...todos);
  const W = 1100; const H = 250; const top = 10; const bottom = 26; const left = 64;
  const plotH = H - top - bottom;
  const y = (v) => top + ((max - v) / (max - min)) * plotH;
  const grupoW = (W - left) / meses.length;
  const barW = Math.max(4, Math.min(26, (grupoW - 16) / SERIES.length - 2));
  const ticks = [min, (max + min) / 2, max].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="dre-g-card" style={{ position: 'relative' }}>
      <h3>Receita, custos e resultado por mês</h3>
      <div className="dre-g-legenda">
        {SERIES.map((s) => <span key={s.chave}><i style={{ background: s.cor }} />{s.rotulo}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Gráfico de barras mensal" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--text3)">{fmtCurto(t)}</text>
          </g>
        ))}
        <line x1={left} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border2)" strokeWidth="1" />
        {meses.map((m, gi) => {
          const x0 = left + gi * grupoW + (grupoW - SERIES.length * (barW + 2)) / 2;
          return (
            <g key={m} onMouseEnter={() => setHover({ m, x: ((left + gi * grupoW + grupoW / 2) / W) * 100 })}>
              <rect x={left + gi * grupoW} y={top} width={grupoW} height={plotH} fill={hover?.m === m ? 'var(--surface2)' : 'transparent'} />
              {SERIES.map((s, si) => {
                const v = valor(s.chave, m);
                const yy = Math.min(y(v), y(0));
                const h = Math.max(1, Math.abs(y(v) - y(0)));
                return <rect key={s.chave} x={x0 + si * (barW + 2)} y={yy} width={barW} height={h} rx="3" fill={s.cor} />;
              })}
              <text x={left + gi * grupoW + grupoW / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text2)">{rotuloMes(m)}</text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="dre-g-tooltip" style={{ left: `calc(${Math.min(hover.x, 75)}% )`, top: 40 }}>
          <b>{rotuloMes(hover.m)}</b>
          {SERIES.map((s) => (
            <div key={s.chave} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
              <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.cor, marginRight: 5 }} />{s.rotulo}</span>
              <b>{fmt(valor(s.chave, hover.m))}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tabela({ dre, onAbrirLancamentos }) {
  const [abertas, setAbertas] = useState({});
  const { meses, linhas } = dre;
  const toggle = (id) => setAbertas((a) => ({ ...a, [id]: !a[id] }));
  return (
    <div className="dre-g-card" style={{ overflowX: 'auto', padding: 0 }}>
      <table className="dre-g-tabela">
        <thead>
          <tr>
            <th>DRE gerencial</th>
            {meses.map((m) => <th key={m}>{rotuloMes(m)}</th>)}
            <th>Total</th>
            <th>% receita</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            if (l.tipo === 'secao') {
              return <tr key={l.id} data-tipo="secao"><td colSpan={meses.length + 3}>{l.rotulo}</td></tr>;
            }
            const temDetalhe = l.detalhe && l.detalhe.length > 0;
            const totalExib = l.semTotal ? l.totalExibido : l.total;
            return (
              <React.Fragment key={l.id}>
                <tr data-tipo={l.tipo} data-clicavel={temDetalhe ? 'true' : undefined} data-alerta={l.alerta && l.total > 0 ? 'true' : undefined}
                  onClick={temDetalhe ? () => toggle(l.id) : undefined}>
                  <td>{temDetalhe ? (abertas[l.id] ? '⌄ ' : '› ') : ''}{l.rotulo}</td>
                  {meses.map((m) => (
                    <td key={m} className={l.valores[m] < -0.004 ? 'dre-g-neg' : undefined}>
                      {fmtCurto(l.valores[m])}
                      {l.fonte && <span className="dre-g-fonte">{rotuloFonte(l.fonte[m])}</span>}
                    </td>
                  ))}
                  <td className={totalExib < -0.004 ? 'dre-g-neg' : undefined}>{fmtCurto(totalExib)}</td>
                  <td>{l.pctReceita == null ? '' : fmtPct(l.pctReceita)}</td>
                </tr>
                {temDetalhe && abertas[l.id] && <Detalhe linha={l} meses={meses} onAbrirLancamentos={onAbrirLancamentos} />}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function rotuloFonte(f) {
  if (f === 'pgdas') return 'PGDAS';
  if (f === 'lancamentos') return 'lançamentos';
  return f ?? '';
}

const LIMITE_DETALHE = 25;
function Detalhe({ linha, meses, onAbrirLancamentos }) {
  const [todos, setTodos] = useState(false);
  const itens = todos ? linha.detalhe : linha.detalhe.slice(0, LIMITE_DETALHE);
  return (
    <>
      <tr className="dre-g-detalhe">
        <td colSpan={meses.length + 3} style={{ fontWeight: 600 }}>
          Detalhamento por contraparte — {linha.detalhe.length} contraparte(s)
        </td>
      </tr>
      {itens.map((d) => (
        <tr key={d.contraparte} className="dre-g-detalhe">
          <td>
            {onAbrirLancamentos ? (
              <button type="button" className="btn-ghost" style={{ padding: 0, fontSize: 'inherit', textAlign: 'left' }}
                onClick={() => onAbrirLancamentos({ titulo: `${linha.rotulo} — ${d.contraparte}`, ids: d.lancamentoIds })}>
                {d.contraparte}
              </button>
            ) : d.contraparte}
            <span className="dre-g-fonte">{d.qtd} lançamento(s)</span>
          </td>
          {meses.map((m) => <td key={m}>{d.valores[m] ? fmtCurto(d.valores[m]) : ''}</td>)}
          <td>{fmtCurto(d.total)}</td>
          <td />
        </tr>
      ))}
      {!todos && linha.detalhe.length > LIMITE_DETALHE && (
        <tr className="dre-g-detalhe">
          <td colSpan={meses.length + 3}>
            <button type="button" className="btn-ghost" style={{ fontSize: '0.75rem' }} onClick={() => setTodos(true)}>
              Ver as outras {linha.detalhe.length - LIMITE_DETALHE} contrapartes
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function Pontos({ pontos }) {
  if (pontos.length === 0) return <p style={{ color: 'var(--text2)' }}>Nenhum ponto de atenção no período. 👍</p>;
  return (
    <div className="dre-g-pontos">
      {pontos.map((p) => (
        <div key={p.id} className="dre-g-ponto" data-sev={p.severidade}>
          <span className="dre-g-sev" style={{ color: p.severidade === 'Alta' ? 'var(--danger)' : p.severidade === 'Média' ? 'var(--warn)' : 'var(--accent)' }}>
            {p.severidade === 'Alta' ? '● ' : p.severidade === 'Média' ? '▲ ' : '◆ '}{p.severidade} · {p.status}
          </span>
          <h4>{p.titulo}</h4>
          <p><b>Achado:</b> {p.achado}</p>
          <p><b>Impacto:</b> {p.impacto}</p>
          <p><b>Ação:</b> {p.acao}</p>
          <p style={{ color: 'var(--text3)' }}>Responsável: {p.responsavel} · Prazo: {p.prazo}</p>
        </div>
      ))}
    </div>
  );
}
