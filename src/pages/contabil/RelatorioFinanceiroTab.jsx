import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { listarLancamentos } from './contabilApi';
import { montarRelatorioFinanceiro } from '../../lib/relatorioFinanceiro';
import { rotuloMesCurto } from '../../lib/resumoFinanceiro';
import { exportarRelatorioFinanceiroExcel, exportarRelatorioFinanceiroPDF } from './exportarRelatorioFinanceiro';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '');

// Aba Relatório do Financeiro: resumo do dinheiro que entrou e saiu do banco
// no período, separado em receitas, adiantamentos, pagamentos a fornecedores
// (por fornecedor), despesas, impostos, sócios... Cálculo em
// src/lib/relatorioFinanceiro.js; PDF/Excel em exportarRelatorioFinanceiro.js.
export default function RelatorioFinanceiroTab({ empresaId, periodo, empresaNome, onIrPara }) {
  const [lancamentos, setLancamentos] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [exportando, setExportando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLancamentos(await listarLancamentos(empresaId, periodo));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const r = useMemo(() => (lancamentos ? montarRelatorioFinanceiro(lancamentos) : null), [lancamentos]);

  async function exportar(tipo) {
    setExportando(true);
    try {
      const args = { relatorio: r, periodo, empresaNome };
      if (tipo === 'pdf') await exportarRelatorioFinanceiroPDF(args);
      else exportarRelatorioFinanceiroExcel(args);
    } catch (e) {
      alert(`Não foi possível exportar: ${e.message}`);
    } finally {
      setExportando(false);
    }
  }

  if (carregando && !r) return <p>Carregando relatório...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;
  if (!r) return null;
  if (r.totais.qtd === 0) {
    return (
      <div className="dre-g-card fin-card">
        <p style={{ margin: 0, color: 'var(--text2)' }}>
          Nenhuma entrada ou saída de banco no período. Importe o extrato pela aba <b>Importar Extrato</b>.
        </p>
      </div>
    );
  }

  const d = r.destaques;
  const forn = r.saidas.find((g) => g.id === 'fornecedores');

  return (
    <div style={{ opacity: carregando ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" className="btn-ghost" disabled={exportando} onClick={() => exportar('pdf')}>Baixar PDF</button>
        <button type="button" className="btn-ghost" disabled={exportando} onClick={() => exportar('excel')}>Baixar Excel</button>
      </div>

      <div className="dre-g-kpis">
        <Kpi rotulo="Entradas" valor={fmt(r.totais.entradas)} cor="var(--ok)" />
        <Kpi rotulo="Saídas" valor={fmt(r.totais.saidas)} cor="var(--danger)" />
        <Kpi rotulo="Saldo do período" valor={fmt(r.totais.saldo)} cor={r.totais.saldo < 0 ? 'var(--danger)' : undefined}
          sub={r.totais.transferencias ? `${fmt(r.totais.transferencias)} em transferências entre contas (fora do saldo)` : 'entradas − saídas'} />
      </div>
      <div className="dre-g-kpis">
        <Kpi rotulo="Receitas" valor={fmt(d.receitas)} sub={pctDe(d.receitas, r.totais.entradas, 'das entradas')} />
        <Kpi rotulo="Pagamentos a fornecedores" valor={fmt(d.fornecedores)} sub={`${d.qtdFornecedores} fornecedor(es)`} />
        <Kpi rotulo="Adiantamentos" valor={fmt(d.adiantamentosConcedidos)}
          sub={`concedidos · ${fmt(d.adiantamentosRecebidos)} recebidos`} />
        <Kpi rotulo="A identificar" valor={fmt(d.identificar)} cor={d.identificar ? 'var(--warn)' : undefined}
          sub={d.identificar ? <a href="#" onClick={(e) => { e.preventDefault(); onIrPara?.('lancamentos'); }}>identificar nos lançamentos →</a> : 'tudo classificado'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
        <Lado titulo="Entradas" grupos={r.entradas} total={r.totais.entradas} cor="var(--ok)" />
        <Lado titulo="Saídas" grupos={r.saidas} total={r.totais.saidas} cor="var(--danger)" />
      </div>

      {forn && <Fornecedores grupo={forn} />}

      {r.porMes.length > 1 && <PorMes porMes={r.porMes} />}

      <p style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 12 }}>
        Considera só o movimento dos bancos (extrato) no período, pelo que cada lançamento foi classificado. Transferências entre contas
        da própria empresa ficam de fora. Fornecedor com conta própria aparece pelo nome da conta (e CNPJ); os demais, pelo nome no histórico do extrato.
      </p>
    </div>
  );
}

const pctDe = (v, total, txt) => (total ? `${Math.round((v / total) * 100)}% ${txt}` : '');

function Kpi({ rotulo, valor, sub, cor }) {
  return (
    <div className="dre-g-kpi">
      <div className="dre-g-kpi-rotulo">{rotulo}</div>
      <div className="dre-g-kpi-valor" style={cor ? { color: cor } : undefined}>{valor}</div>
      {sub && <div className="dre-g-kpi-var">{sub}</div>}
    </div>
  );
}

// Um lado (entradas ou saídas): categorias com barra e, ao abrir, quem/qual conta
function Lado({ titulo, grupos, total, cor }) {
  const [aberto, setAberto] = useState(null);
  return (
    <div className="dre-g-card fin-card">
      <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{titulo}</span><span style={{ color: cor }}>{fmt(total)}</span>
      </h3>
      <table className="dre-g-tabela fin-tabela">
        <tbody>
          {grupos.map((g) => {
            const ehPend = g.id === 'identificar';
            const open = aberto === g.id;
            return (
              <React.Fragment key={g.id}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(open ? null : g.id)} title="Clique para ver o detalhe">
                  <td className="txt" style={{ width: '55%' }}>
                    <span style={{ fontWeight: 600, color: ehPend ? 'var(--warn)' : undefined }}>{open ? '▾' : '▸'} {g.rotulo}</span>
                    {g.desc && <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{g.desc}</div>}
                    <div className="fin-barra"><i style={{ width: `${Math.max(g.pct, 1)}%`, background: ehPend ? 'var(--warn)' : cor }} /></div>
                  </td>
                  <td className="num" style={{ color: 'var(--text3)' }}>{g.qtd}×</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(g.total)}</td>
                  <td className="num" style={{ color: 'var(--text3)' }}>{g.pct.toLocaleString('pt-BR')}%</td>
                </tr>
                {open && g.itens.map((it) => (
                  <tr key={it.chave} style={{ fontSize: '0.8rem' }}>
                    <td className="txt" style={{ paddingLeft: 22 }} title={it.contas.join(', ')}>
                      {it.nome}
                      {it.cnpj && <span style={{ color: 'var(--text3)' }}> · {it.cnpj}</span>}
                    </td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{it.qtd}×</td>
                    <td className="num">{fmt(it.total)}</td>
                    <td className="num" style={{ color: 'var(--text3)' }}>{g.total ? Math.round((it.total / g.total) * 100) : 0}%</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Pagamentos a fornecedores, um por linha, com os pagamentos ao abrir
function Fornecedores({ grupo }) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);
  const q = busca.trim().toLowerCase();
  const itens = q ? grupo.itens.filter((it) => `${it.nome} ${it.cnpj ?? ''}`.toLowerCase().includes(q)) : grupo.itens;
  return (
    <div className="dre-g-card fin-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Pagamentos por fornecedor</h3>
        <input type="search" placeholder="Buscar fornecedor ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ minWidth: 240 }} />
      </div>
      <table className="dre-g-tabela fin-tabela" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Fornecedor</th>
            <th style={{ textAlign: 'left' }}>CNPJ</th>
            <th className="num">Pagamentos</th>
            <th className="num">Último</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((it) => {
            const open = aberto === it.chave;
            return (
              <React.Fragment key={it.chave}>
                <tr style={{ cursor: 'pointer' }} onClick={() => setAberto(open ? null : it.chave)}>
                  <td className="txt">{open ? '▾' : '▸'} {it.nome}</td>
                  <td className="txt" style={{ color: 'var(--text3)' }}>{it.cnpj ?? '—'}</td>
                  <td className="num">{it.qtd}</td>
                  <td className="num">{fmtData(it.ultimaData)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmt(it.total)}</td>
                </tr>
                {open && it.lancamentos.map((l) => (
                  <tr key={l.id} style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>
                    <td className="txt" style={{ paddingLeft: 22 }} colSpan={2}>{l.historico}</td>
                    <td className="num" colSpan={2}>{fmtData(l.data)}</td>
                    <td className="num">{fmt(l.valor)}</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
          {itens.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text3)' }}>Nenhum fornecedor encontrado.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td className="txt" style={{ fontWeight: 700 }} colSpan={4}>Total {q ? '(filtrado)' : ''}</td>
            <td className="num" style={{ fontWeight: 700 }}>{fmt(itens.reduce((s, it) => s + it.total, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PorMes({ porMes }) {
  const cols = [
    ['Receitas', (m) => m.entradas.receitas],
    ['Adiant. recebidos', (m) => m.entradas.adiantamentos],
    ['Total entradas', (m) => m.totalEntradas, true],
    ['Fornecedores', (m) => m.saidas.fornecedores],
    ['Adiant. concedidos', (m) => m.saidas.adiantamentos],
    ['Despesas', (m) => m.saidas.despesas],
    ['Total saídas', (m) => m.totalSaidas, true],
    ['Saldo', (m) => m.saldo, true],
  ];
  return (
    <div className="dre-g-card fin-card" style={{ marginTop: 16 }}>
      <h3>Por mês</h3>
      <table className="dre-g-tabela fin-tabela">
        <thead>
          <tr><th style={{ textAlign: 'left' }}>Mês</th>{cols.map(([c]) => <th key={c} className="num">{c}</th>)}</tr>
        </thead>
        <tbody>
          {porMes.map((m) => (
            <tr key={m.mes}>
              <td>{rotuloMesCurto(m.mes)}</td>
              {cols.map(([c, f, forte]) => {
                const v = f(m) ?? 0;
                return <td key={c} className="num" style={{ fontWeight: forte ? 600 : undefined, color: c === 'Saldo' && v < 0 ? 'var(--danger)' : undefined }}>{v ? fmt(v) : '—'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
