import React, { useEffect, useState, useCallback } from 'react';
import { listarContas, listarRegrasClassificacao, salvarRegraManual, excluirRegraClassificacao } from './contabilApi';
import ContaCombobox from './ContaCombobox';

export default function RegrasTab({ empresaId }) {
  const [contas, setContas] = useState([]);
  const [regras, setRegras] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [filtro, setFiltro] = useState('');

  const [novoPadrao, setNovoPadrao] = useState('');
  const [novaConta, setNovaConta] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [c, r] = await Promise.all([listarContas(empresaId), listarRegrasClassificacao(empresaId)]);
      setContas(c.filter((x) => x.aceita_lancamento));
      setRegras(r);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    if (!novoPadrao.trim() || !novaConta) return;
    setSalvando(true);
    setErro(null);
    try {
      await salvarRegraManual(empresaId, novoPadrao, novaConta);
      setNovoPadrao('');
      setNovaConta('');
      carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(id) {
    if (!window.confirm('Excluir esta regra?')) return;
    await excluirRegraClassificacao(id);
    carregar();
  }

  const regrasFiltradas = regras.filter((r) =>
    !filtro
    || r.padrao.toLowerCase().includes(filtro.toLowerCase())
    || r.contas_contabeis?.nome?.toLowerCase().includes(filtro.toLowerCase())
  );

  return (
    <div>
      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px auto', gap: 8, alignItems: 'center' }}>
          <input
            placeholder='Trecho do histórico (ex: "TH DISTRIBUIDORA")'
            value={novoPadrao}
            onChange={(e) => setNovoPadrao(e.target.value)}
            required
          />
          <ContaCombobox contas={contas} value={novaConta} onChange={setNovaConta} placeholder="Classificar em..." />
          <button type="submit" className="btn-navy" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Adicionar regra'}
          </button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
      </form>

      <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: 12 }}>
        Toda transação importada cujo histórico contenha o trecho cadastrado já entra classificada
        automaticamente na conta escolhida. Regras também são criadas sozinhas toda vez que você
        classifica um lançamento (manual, em lote ou na importação).
      </p>

      <input
        placeholder="Buscar por trecho ou conta..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, width: 280 }}
      />

      {carregando ? <p>Carregando regras...</p> : (
        <table className="contabil-tabela">
          <thead>
            <tr>
              <th>Trecho do histórico</th>
              <th>Conta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {regrasFiltradas.map((r) => (
              <tr key={r.id}>
                <td>{r.padrao}</td>
                <td>{r.contas_contabeis?.codigo} - {r.contas_contabeis?.nome}</td>
                <td><button className="btn-ghost" onClick={() => excluir(r.id)}>Excluir</button></td>
              </tr>
            ))}
            {regrasFiltradas.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--text2)' }}>
                  {regras.length === 0 ? 'Nenhuma regra cadastrada ainda.' : 'Nenhuma regra encontrada com esse filtro.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
