import React, { useEffect, useState, useCallback } from 'react';
import { listarContas, criarConta, atualizarConta } from './contabilApi';

const GRUPOS_DRE = [
  { value: '', label: '—' },
  { value: 'receita_bruta', label: 'Receita Bruta' },
  { value: 'deducao', label: 'Dedução' },
  { value: 'custo', label: 'Custo' },
  { value: 'despesa_administrativa', label: 'Despesa Administrativa' },
  { value: 'despesa_comercial', label: 'Despesa Comercial' },
  { value: 'despesa_financeira', label: 'Despesa Financeira' },
  { value: 'outras_receitas', label: 'Outras Receitas' },
  { value: 'outras_despesas', label: 'Outras Despesas' },
  { value: 'ir_csll', label: 'IR / CSLL' },
];

function contaVazia() {
  return { codigo: '', nome: '', tipo: 'ativo', natureza: 'devedora', aceita_lancamento: true, grupo_dre: '' };
}

export default function PlanoContasTab({ empresaId }) {
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [novaConta, setNovaConta] = useState(contaVazia());
  const [filtro, setFiltro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    const c = await listarContas(empresaId);
    setContas(c);
    setCarregando(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    await criarConta({
      empresa_id: empresaId,
      codigo: novaConta.codigo,
      nome: novaConta.nome,
      tipo: novaConta.tipo,
      natureza: novaConta.natureza,
      nivel: novaConta.codigo.split('.').length,
      aceita_lancamento: novaConta.aceita_lancamento,
      grupo_dre: novaConta.grupo_dre || null,
    });
    setNovaConta(contaVazia());
    carregar();
  }

  async function mudarGrupoDre(conta, grupo_dre) {
    await atualizarConta(conta.id, { grupo_dre: grupo_dre || null });
    carregar();
  }

  const contasFiltradas = contas.filter((c) =>
    !filtro || c.codigo.includes(filtro) || c.nome.toLowerCase().includes(filtro.toLowerCase())
  );

  return (
    <div>
      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 160px 140px 100px 180px auto', gap: 8, alignItems: 'center' }}>
          <input placeholder="Código (1.1.01.001)" value={novaConta.codigo}
            onChange={(e) => setNovaConta({ ...novaConta, codigo: e.target.value })} required />
          <input placeholder="Nome da conta" value={novaConta.nome}
            onChange={(e) => setNovaConta({ ...novaConta, nome: e.target.value })} required />
          <select value={novaConta.tipo} onChange={(e) => setNovaConta({ ...novaConta, tipo: e.target.value })}>
            <option value="ativo">Ativo</option>
            <option value="passivo">Passivo</option>
            <option value="patrimonio_liquido">Patrimônio Líquido</option>
            <option value="receita">Receita</option>
            <option value="custo">Custo</option>
            <option value="despesa">Despesa</option>
          </select>
          <select value={novaConta.natureza} onChange={(e) => setNovaConta({ ...novaConta, natureza: e.target.value })}>
            <option value="devedora">Devedora</option>
            <option value="credora">Credora</option>
          </select>
          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={novaConta.aceita_lancamento}
              onChange={(e) => setNovaConta({ ...novaConta, aceita_lancamento: e.target.checked })} />
            Analítica
          </label>
          <select value={novaConta.grupo_dre} onChange={(e) => setNovaConta({ ...novaConta, grupo_dre: e.target.value })}>
            {GRUPOS_DRE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <button type="submit" className="btn-navy">Adicionar</button>
        </div>
      </form>

      <input
        placeholder="Buscar por código ou nome..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, width: 280 }}
      />

      {carregando ? <p>Carregando plano de contas...</p> : (
        <table className="contabil-tabela">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Natureza</th>
              <th>Analítica</th>
              <th>Grupo DRE</th>
            </tr>
          </thead>
          <tbody>
            {contasFiltradas.map((c) => (
              <tr key={c.id}>
                <td>{c.codigo}</td>
                <td>{c.nome}</td>
                <td>{c.tipo}</td>
                <td>{c.natureza}</td>
                <td>{c.aceita_lancamento ? 'Sim' : 'Não (sintética)'}</td>
                <td>
                  {(c.tipo === 'receita' || c.tipo === 'despesa' || c.tipo === 'custo') ? (
                    <select value={c.grupo_dre ?? ''} onChange={(e) => mudarGrupoDre(c, e.target.value)}>
                      {GRUPOS_DRE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
