import React, { useEffect, useState, useCallback } from 'react';
import { calcularDREPorConta } from './contabilApi';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Calculadora simples de precificação: pega o total de despesas do período
// (mesmo cálculo da DRE) e rateia pelo volume de vendas esperado informado
// pelo usuário — sem cadastro de produto, é só um ponto de partida rápido
// pra saber o preço mínimo que cobre o custo + a margem desejada.
export default function PrecificacaoTab({ empresaId, periodo }) {
  const [dre, setDre] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const [nomeProduto, setNomeProduto] = useState('');
  const [volume, setVolume] = useState('');
  const [margem, setMargem] = useState('30');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDre(await calcularDREPorConta(empresaId, periodo));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <p>Calculando...</p>;
  if (erro) return <p style={{ color: 'var(--danger)' }}>{erro}</p>;
  if (!dre) return null;

  const volumeNum = Number(volume);
  const margemNum = Number(margem);
  const temEntrada = volumeNum > 0 && margemNum >= 0 && margemNum < 100;
  const custoUnitario = temEntrada ? dre.totalDespesas / volumeNum : null;
  const precoSugerido = temEntrada ? custoUnitario / (1 - margemNum / 100) : null;
  const lucroUnitario = temEntrada ? precoSugerido - custoUnitario : null;

  return (
    <div>
      <p style={{ color: 'var(--text2)', fontSize: '0.85rem', maxWidth: 640, marginTop: 0 }}>
        Usa o total de despesas do período selecionado (o mesmo da DRE) como base de custo, dilui pelo
        volume de vendas esperado e aplica a margem desejada sobre o preço final.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', maxWidth: 420, marginBottom: 20 }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.03em', fontWeight: 600 }}>
          Despesas do período
        </div>
        <div className="num" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--danger)', marginTop: 4 }}>
          {fmt(dre.totalDespesas)}
        </div>
      </div>

      <div className="contabil-form" style={{ maxWidth: 420 }}>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text2)', marginBottom: 4 }}>Produto/serviço (opcional, só rótulo)</span>
          <input value={nomeProduto} onChange={(e) => setNomeProduto(e.target.value)} placeholder="Ex: Hora de consultoria" style={{ width: '100%' }} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text2)', marginBottom: 4 }}>Volume esperado no período</span>
            <input type="number" min="0" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Ex: 50" style={{ width: '100%' }} />
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text2)', marginBottom: 4 }}>Margem desejada (%)</span>
            <input type="number" min="0" max="99" value={margem} onChange={(e) => setMargem(e.target.value)} placeholder="Ex: 30" style={{ width: '100%' }} />
          </label>
        </div>
      </div>

      {volume !== '' && !temEntrada && (
        <p style={{ color: 'var(--danger)', marginTop: 12, maxWidth: 420 }}>
          Informe um volume maior que zero e uma margem entre 0% e 99%.
        </p>
      )}

      {temEntrada && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, maxWidth: 640, marginTop: 20 }}>
          <ResultadoCard label="Custo unitário rateado" valor={fmt(custoUnitario)} cor="var(--text1)" />
          <ResultadoCard label="Preço sugerido" valor={fmt(precoSugerido)} cor="var(--ok)" destaque />
          <ResultadoCard label="Lucro por unidade" valor={fmt(lucroUnitario)} cor="var(--navy2)" />
        </div>
      )}

      {temEntrada && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 14, maxWidth: 640 }}>
          {nomeProduto ? `"${nomeProduto}": ` : ''}
          vendendo {volumeNum} unidade{volumeNum === 1 ? '' : 's'} no período a {fmt(precoSugerido)} cada,
          a receita ({fmt(precoSugerido * volumeNum)}) cobre as despesas do período e deixa {margemNum}% de margem sobre o preço de venda.
          Esse cálculo dilui só as despesas já lançadas — não considera custo direto de material/insumo por unidade, se houver.
        </p>
      )}
    </div>
  );
}

function ResultadoCard({ label, valor, cor, destaque }) {
  return (
    <div style={{
      background: 'var(--surface)', border: destaque ? '2px solid var(--ok)' : '1px solid var(--border)',
      borderRadius: 10, padding: '12px 14px',
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.02em', fontWeight: 600 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: '1.2rem', fontWeight: 800, color: cor, marginTop: 4 }}>{valor}</div>
    </div>
  );
}
