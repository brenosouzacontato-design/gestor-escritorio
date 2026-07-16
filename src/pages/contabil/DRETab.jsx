import React, { useEffect, useState, useCallback } from 'react';
import { calcularDREPorConta, listarLancamentosPorConta } from './contabilApi';
import ContaLancamentosSidebar from './ContaLancamentosSidebar';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// DRE simplificada: uma linha por conta de Receita/Despesa (sem os grupos
// fixos de antes) — clicar numa linha abre os lançamentos daquela conta no
// período, pra conferir o que compõe o total.
export default function DRETab({ empresaId, periodo }) {
  const [dre, setDre] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const [sidebar, setSidebar] = useState(null); // { conta, lancamentos, carregando }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await calcularDREPorConta(empresaId, periodo);
      setDre(resultado);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  async function abrirConta(conta) {
    setSidebar({ conta, lancamentos: [], carregando: true });
    try {
      const lancamentos = await listarLancamentosPorConta(empresaId, conta.id, periodo);
      setSidebar({ conta, lancamentos, carregando: false });
    } catch (e) {
      setErro(e.message);
      setSidebar(null);
    }
  }

  if (carregando) return <p>Calculando DRE...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;
  if (!dre) return null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 760 }}>
        <LinhaGrupo titulo="Receitas" total={dre.totalReceitas} linhas={dre.receitas} cor="var(--ok)" onClick={abrirConta} />
        <LinhaGrupo titulo="Despesas" total={dre.totalDespesas} linhas={dre.despesas} cor="var(--danger)" onClick={abrirConta} />
      </div>

      <div style={{ maxWidth: 760, marginTop: 20, padding: '14px 18px', background: 'var(--surface)',
        border: '2px solid var(--navy)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text1)' }}>Resultado do período</span>
        <span className={`num ${dre.resultado < 0 ? 'valor-negativo' : 'valor-positivo'}`} style={{ fontSize: '1.1rem', fontWeight: 800 }}>
          {fmt(dre.resultado)}
        </span>
      </div>

      {sidebar && (
        <ContaLancamentosSidebar
          conta={sidebar.conta}
          lancamentos={sidebar.lancamentos}
          carregando={sidebar.carregando}
          onClose={() => setSidebar(null)}
        />
      )}
    </div>
  );
}

function LinhaGrupo({ titulo, total, linhas, cor, onClick }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
        paddingBottom: 6, borderBottom: `2px solid ${cor}` }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text1)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
          {titulo}
        </span>
        <span className="num" style={{ fontWeight: 700, color: cor }}>{fmt(total)}</span>
      </div>
      {linhas.length === 0 && <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Sem movimento no período.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {linhas.map(({ conta, valor }) => (
          <button key={conta.id} onClick={() => onClick(conta)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', borderBottom: '1px solid var(--border)', padding: '7px 2px',
              cursor: 'pointer', textAlign: 'left', width: '100%' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>{conta.nome}</span>
            <span className="num" style={{ fontSize: '0.85rem', color: 'var(--text1)', fontWeight: 500 }}>{fmt(valor)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
