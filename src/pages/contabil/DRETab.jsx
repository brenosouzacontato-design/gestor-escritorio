import React, { useEffect, useState, useCallback } from 'react';
import { calcularDRE } from './contabilApi';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function DRETab({ empresaId, periodo }) {
  const [dre, setDre] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await calcularDRE(empresaId, periodo);
      setDre(resultado);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <p>Calculando DRE...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;
  if (!dre) return null;

  const linhaTotal = (label, valor, destaque = false) => (
    <tr className={destaque ? 'grupo-row' : ''}>
      <td>{label}</td>
      <td className={`num ${valor < 0 ? 'valor-negativo' : 'valor-positivo'}`}>{fmt(valor)}</td>
    </tr>
  );

  return (
    <table className="contabil-tabela" style={{ maxWidth: 560 }}>
      <tbody>
        {dre.linhas.slice(0, 2).map((l) => (
          <tr key={l.grupo}><td>{l.label}</td><td className="num">{fmt(l.valor)}</td></tr>
        ))}
        {linhaTotal('(=) Receita Líquida', dre.totais.receitaLiquida, true)}

        {dre.linhas.filter(l => l.grupo === 'custo').map((l) => (
          <tr key={l.grupo}><td>{l.label}</td><td className="num">{fmt(l.valor)}</td></tr>
        ))}
        {linhaTotal('(=) Lucro Bruto', dre.totais.lucroBruto, true)}

        {dre.linhas.filter(l => ['despesa_administrativa', 'despesa_comercial', 'despesa_financeira'].includes(l.grupo)).map((l) => (
          <tr key={l.grupo}><td>{l.label}</td><td className="num">{fmt(l.valor)}</td></tr>
        ))}
        {linhaTotal('(=) Resultado Operacional', dre.totais.resultadoOperacional, true)}

        {dre.linhas.filter(l => ['outras_receitas', 'outras_despesas'].includes(l.grupo)).map((l) => (
          <tr key={l.grupo}><td>{l.label}</td><td className="num">{fmt(l.valor)}</td></tr>
        ))}
        {linhaTotal('(=) Resultado Antes do IR/CSLL', dre.totais.resultadoAntesIR, true)}

        {dre.linhas.filter(l => l.grupo === 'ir_csll').map((l) => (
          <tr key={l.grupo}><td>{l.label}</td><td className="num">{fmt(l.valor)}</td></tr>
        ))}
        {linhaTotal('(=) Resultado Líquido do Período', dre.totais.resultadoLiquido, true)}
      </tbody>
    </table>
  );
}
