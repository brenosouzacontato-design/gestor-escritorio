import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { listarLancamentos, idsLancamentosDoFiscal } from './contabilApi';
import { montarResumoFinanceiro, rotuloMesCurto } from '../../lib/resumoFinanceiro';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function atalhos() {
  const h = new Date();
  const ini = (a, m) => iso(new Date(a, m, 1));
  const fim = (a, m) => iso(new Date(a, m + 1, 0));
  const a = h.getFullYear();
  const m = h.getMonth();
  return [
    { rotulo: 'Mês atual', inicio: ini(a, m), fim: fim(a, m) },
    { rotulo: 'Mês anterior', inicio: ini(a, m - 1), fim: fim(a, m - 1) },
    { rotulo: 'Últimos 3 meses', inicio: ini(a, m - 2), fim: fim(a, m) },
    { rotulo: 'Ano atual', inicio: `${a}-01-01`, fim: `${a}-12-31` },
  ];
}

// Aba Resumo do Financeiro: retrato do extrato no período e em que pé está a
// ponte com o OneFlow (importado → classificado → lançado no OneFlow).
// DRE e demais demonstrações ficam no OneFlow. Cálculo em src/lib/resumoFinanceiro.js.
export default function ResumoTab({ empresaId, periodo, onPeriodo, onIrPara }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [lancamentos, idsDoFiscal] = await Promise.all([
        listarLancamentos(empresaId, periodo),
        idsLancamentosDoFiscal(empresaId).catch(() => new Set()),
      ]);
      setDados({ lancamentos, idsDoFiscal });
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const r = useMemo(() => (dados ? montarResumoFinanceiro(dados.lancamentos, { idsDoFiscal: dados.idsDoFiscal }) : null), [dados]);

  return (
    <div>
      <div className="dre-g-atalhos" style={{ marginBottom: 14 }}>
        {onPeriodo && atalhos().map((a) => {
          const ativo = periodo.dataInicio === a.inicio && periodo.dataFim === a.fim;
          return (
            <button key={a.rotulo} type="button" className="btn-ghost"
              style={{ fontSize: '0.78rem', fontWeight: ativo ? 700 : 400, borderColor: ativo ? 'var(--accent)' : undefined }}
              onClick={() => onPeriodo({ dataInicio: a.inicio, dataFim: a.fim })}>
              {a.rotulo}
            </button>
          );
        })}
      </div>

      {carregando && !r && <p>Carregando resumo...</p>}
      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}
      {r && r.totais.qtd === 0 && !carregando && (
        <div className="dre-g-card">
          <p style={{ margin: 0, color: 'var(--text2)' }}>
            Nenhum lançamento no período. Importe o extrato pela aba <b>Importar Extrato</b> ou mande o arquivo no grupo
            <b> Documentos</b> do WhatsApp.
          </p>
        </div>
      )}
      {r && r.totais.qtd > 0 && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <div className="dre-g-kpis">
            <Kpi rotulo="Entradas" valor={fmt(r.totais.entradas)} sub={`${r.totais.qtdEntradas} lançamento(s)`} cor="var(--ok)" />
            <Kpi rotulo="Saídas" valor={fmt(r.totais.saidas)} sub={`${r.totais.qtdSaidas} lançamento(s)`} cor="var(--danger)" />
            <Kpi rotulo="Saldo do período" valor={fmt(r.totais.saldo)} sub={r.totais.transferencias ? `${fmt(r.totais.transferencias)} em transferências entre contas` : 'entradas − saídas'} />
            <Kpi rotulo="A identificar" valor={fmt(r.identificacao.valorPendente)}
              sub={`${r.identificacao.qtdPendentes} lançamento(s) · ${r.identificacao.pctClassificado}% classificado`}
              cor={r.identificacao.qtdPendentes ? 'var(--warn)' : undefined} />
          </div>

          <Ponte r={r} onIrPara={onIrPara} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
            <div className="dre-g-card">
              <h3>Por mês</h3>
              <table className="dre-g-tabela">
                <thead><tr><th style={{ textAlign: 'left' }}>Mês</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Saldo</th></tr></thead>
                <tbody>
                  {r.porMes.map((m) => (
                    <tr key={m.mes}>
                      <td>{rotuloMesCurto(m.mes)}</td>
                      <td className="num">{fmt(m.entradas)}</td>
                      <td className="num">{fmt(m.saidas)}</td>
                      <td className="num" style={{ color: m.saldo < 0 ? 'var(--danger)' : undefined }}>{fmt(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dre-g-card">
              <h3>Por conta bancária</h3>
              <table className="dre-g-tabela">
                <thead><tr><th style={{ textAlign: 'left' }}>Conta</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Saldo</th></tr></thead>
                <tbody>
                  {r.porBanco.map((b) => (
                    <tr key={b.codigo}>
                      <td title={b.codigo}>{b.nome}</td>
                      <td className="num">{fmt(b.entradas)}</td>
                      <td className="num">{fmt(b.saidas)}</td>
                      <td className="num" style={{ color: b.saldo < 0 ? 'var(--danger)' : undefined }}>{fmt(b.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PorConta titulo="Saídas por conta" itens={r.saidasPorConta} total={r.totais.saidas} cor="var(--danger)" />
            <PorConta titulo="Entradas por conta" itens={r.entradasPorConta} total={r.totais.entradas} cor="var(--ok)" />
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, sub, cor }) {
  return (
    <div className="dre-g-kpi">
      <div className="dre-g-kpi-rotulo">{rotulo}</div>
      <div className="dre-g-kpi-valor" style={cor ? { color: cor } : undefined}>{valor}</div>
      {sub && <div className="dre-g-kpi-var">{sub}</div>}
    </div>
  );
}

// importado → classificado → lançado no OneFlow
function Ponte({ r, onIrPara }) {
  const o = r.oneflow;
  const base = o.qtdEnviados + o.qtdProntos + o.qtdBloqueados;
  const etapas = [
    { rotulo: 'Extrato importado', valor: `${r.totais.qtd} lançamento(s)`, ok: true },
    { rotulo: 'Classificado', valor: `${r.identificacao.pctClassificado}%`, ok: r.identificacao.qtdPendentes === 0,
      acao: r.identificacao.qtdPendentes ? { rotulo: `Identificar ${r.identificacao.qtdPendentes}`, aba: 'lancamentos' } : null },
    { rotulo: 'Lançado no OneFlow', valor: base ? `${o.qtdEnviados} de ${base}` : '—', ok: base > 0 && o.qtdEnviados === base,
      acao: o.qtdProntos ? { rotulo: `Lançar ${o.qtdProntos} no OneFlow`, aba: 'oneflow' } : null },
  ];
  return (
    <div className="dre-g-card">
      <h3>Ponte com o OneFlow</h3>
      <div className="fin-ponte">
        {etapas.map((e, i) => (
          <div key={e.rotulo} className="fin-ponte-etapa" data-ok={e.ok}>
            <span className="fin-ponte-num">{e.ok ? '✓' : i + 1}</span>
            <div>
              <div className="fin-ponte-rotulo">{e.rotulo}</div>
              <div className="fin-ponte-valor">{e.valor}</div>
              {e.acao && onIrPara && (
                <button type="button" className="btn-ghost" style={{ fontSize: '0.75rem', marginTop: 6 }} onClick={() => onIrPara(e.acao.aba)}>
                  {e.acao.rotulo} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text3)', margin: '10px 0 0' }}>
        DRE, balancete e demais demonstrações ficam no OneFlow (módulo Contábil).
        {o.qtdDoFiscal ? ` ${o.qtdDoFiscal} lançamento(s) de nota fiscal não entram: o OneFlow já recebe pelo Fiscal.` : ''}
        {o.ultimoEnvio ? ` Último envio: ${new Date(o.ultimoEnvio).toLocaleDateString('pt-BR')}.` : ''}
      </p>
    </div>
  );
}

function PorConta({ titulo, itens, total, cor }) {
  const [todos, setTodos] = useState(false);
  const lista = todos ? itens : itens.slice(0, 8);
  return (
    <div className="dre-g-card">
      <h3>{titulo}</h3>
      {itens.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text3)', margin: 0 }}>Nada no período.</p> : (
        <table className="dre-g-tabela">
          <tbody>
            {lista.map((c) => {
              const pct = total ? (c.total / total) * 100 : 0;
              return (
                <tr key={c.codigo || c.nome}>
                  <td style={{ width: '50%' }}>
                    <span style={{ color: c.pendente ? 'var(--warn)' : undefined, fontWeight: c.pendente ? 600 : undefined }} title={c.codigo}>{c.nome}</span>
                    <div className="fin-barra"><i style={{ width: `${Math.max(pct, 1)}%`, background: c.pendente ? 'var(--warn)' : cor }} /></div>
                  </td>
                  <td className="num" style={{ color: 'var(--text3)' }}>{c.qtd}×</td>
                  <td className="num">{fmt(c.total)}</td>
                  <td className="num" style={{ color: 'var(--text3)' }}>{pct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {itens.length > 8 && (
        <button type="button" className="btn-ghost" style={{ fontSize: '0.75rem', marginTop: 8 }} onClick={() => setTodos(!todos)}>
          {todos ? 'Mostrar menos' : `Ver todas (${itens.length})`}
        </button>
      )}
    </div>
  );
}
