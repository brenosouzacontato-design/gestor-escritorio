import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { calcularDREPorConta, calcularBalancete } from './contabilApi';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

const LABEL_TIPO_BALANCETE = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receitas', custo: 'Custos', despesa: 'Despesas',
};
const ORDEM_TIPO_BALANCETE = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'custo', 'despesa'];

// Página pública (sem login) pra compartilhar Balancete ou DRE com o
// cliente via link — só leitura, sem sidebar de lançamentos nem edição.
// Acessada via ?share=dre|balancete&empresa=<id>&inicio=&fim= (ver App.jsx,
// que renderiza essa página no lugar do app inteiro quando detecta o param).
export default function RelatorioCompartilhadoPage({ tipo, empresaId, dataInicio, dataFim }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [dre, setDre] = useState(null);
  const [balancete, setBalancete] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, resultado] = await Promise.all([
          supabase.from('clientes').select('nome').eq('id', empresaId).single(),
          tipo === 'dre'
            ? calcularDREPorConta(empresaId, { dataInicio, dataFim })
            : calcularBalancete(empresaId, { dataInicio, dataFim }),
        ]);
        if (errCliente) throw errCliente;
        setEmpresaNome(cliente?.nome ?? '');
        if (tipo === 'dre') setDre(resultado); else setBalancete(resultado);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [tipo, empresaId, dataInicio, dataFim]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: '#1B2B4B' }}>
          <div style={{ fontSize: 11, color: '#8fadd4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {tipo === 'dre' ? 'DRE — Demonstração de Resultado' : 'Balancete'}
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: '#8fadd4', marginTop: 2 }}>
            Período de {fmtData(dataInicio)} até {fmtData(dataFim)}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && tipo === 'dre' && dre && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <GrupoDRE titulo="Receitas" total={dre.totalReceitas} linhas={dre.receitas} cor="var(--ok)" />
                <GrupoDRE titulo="Despesas" total={dre.totalDespesas} linhas={dre.despesas} cor="var(--danger)" />
              </div>
              <div style={{ marginTop: 20, padding: '14px 18px', background: 'var(--bg)', border: '2px solid var(--navy)',
                borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>Resultado do período</span>
                <span className="num" style={{ fontSize: '1.1rem', fontWeight: 800, color: dre.resultado < 0 ? 'var(--danger)' : 'var(--ok)' }}>
                  {fmt(dre.resultado)}
                </span>
              </div>
            </>
          )}

          {!carregando && !erro && tipo === 'balancete' && balancete && (
            <table className="contabil-tabela">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th className="num">Saldo Anterior</th>
                  <th className="num">Débito</th>
                  <th className="num">Crédito</th>
                  <th className="num">Saldo Atual</th>
                </tr>
              </thead>
              <tbody>
                {ORDEM_TIPO_BALANCETE.map((t) => {
                  const linhas = balancete.filter((l) => l.conta.tipo === t
                    && (l.saldoAnterior !== 0 || l.debito !== 0 || l.credito !== 0 || l.saldoAtual !== 0));
                  if (linhas.length === 0) return null;
                  return (
                    <React.Fragment key={t}>
                      <tr className="grupo-row"><td colSpan={5}>{LABEL_TIPO_BALANCETE[t]}</td></tr>
                      {linhas.map((l) => (
                        <tr key={l.conta.id}>
                          <td style={{ paddingLeft: 24 }}>{l.conta.codigo} - {l.conta.nome}</td>
                          <td className="num">{fmt(l.saldoAnterior)}</td>
                          <td className="num">{fmt(l.debito)}</td>
                          <td className="num">{fmt(l.credito)}</td>
                          <td className={`num ${l.saldoAtual < 0 ? 'valor-negativo' : ''}`}>{fmt(l.saldoAtual)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Relatório gerado pelo Gestor — Escritório Contábil, só pra conferência.
        </div>
      </div>
    </div>
  );
}

function GrupoDRE({ titulo, total, linhas, cor }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: `2px solid ${cor}` }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{titulo}</span>
        <span className="num" style={{ fontWeight: 700, color: cor }}>{fmt(total)}</span>
      </div>
      {linhas.length === 0 && <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Sem movimento no período.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {linhas.map(({ conta, valor }) => (
          <div key={conta.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>{conta.nome}</span>
            <span className="num" style={{ fontSize: '0.85rem', fontWeight: 500 }}>{fmt(valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
