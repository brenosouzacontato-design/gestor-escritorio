import React, { useEffect, useState, useCallback } from 'react';
import { calcularBalancete } from './contabilApi';

const LABEL_TIPO = {
  ativo: 'Ativo',
  passivo: 'Passivo',
  patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receitas',
  despesa: 'Despesas',
  custo: 'Custos',
};

const ORDEM_TIPO = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'custo', 'despesa'];

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function BalanceteTab({ empresaId, periodo }) {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await calcularBalancete(empresaId, periodo);
      setLinhas(resultado);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <p>Calculando balancete...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;

  const porTipo = ORDEM_TIPO.map((tipo) => ({
    tipo,
    contas: linhas.filter((l) => l.conta.tipo === tipo && (l.saldoAnterior !== 0 || l.debito !== 0 || l.credito !== 0 || l.saldoAtual !== 0)),
  })).filter((g) => g.contas.length > 0);

  return (
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
        {porTipo.map((grupo) => (
          <React.Fragment key={grupo.tipo}>
            <tr className="grupo-row">
              <td colSpan={5}>{LABEL_TIPO[grupo.tipo]}</td>
            </tr>
            {grupo.contas.map((l) => (
              <tr key={l.conta.id}>
                <td style={{ paddingLeft: 24 }}>{l.conta.codigo} - {l.conta.nome}</td>
                <td className="num">{fmt(l.saldoAnterior)}</td>
                <td className="num">{fmt(l.debito)}</td>
                <td className="num">{fmt(l.credito)}</td>
                <td className={`num ${l.saldoAtual < 0 ? 'valor-negativo' : ''}`}>{fmt(l.saldoAtual)}</td>
              </tr>
            ))}
          </React.Fragment>
        ))}
        {porTipo.length === 0 && (
          <tr><td colSpan={5} style={{ color: 'var(--text2)' }}>Nenhuma movimentação no período.</td></tr>
        )}
      </tbody>
    </table>
  );
}
