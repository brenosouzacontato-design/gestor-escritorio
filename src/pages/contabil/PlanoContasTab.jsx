import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { listarContas, criarConta, atualizarConta, atualizarContasEmLote } from './contabilApi';

const TIPOS_COM_GRUPO_DRE = ['receita', 'despesa', 'custo'];

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
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [grupoDreLote, setGrupoDreLote] = useState('');
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const c = await listarContas(empresaId);
    setContas(c);
    setCarregando(false);
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    setErro(null);
    try {
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
    } catch (e) {
      setErro(e.code === '23505'
        ? `Já existe uma conta com o código "${novaConta.codigo}" nesta empresa.`
        : e.message);
    }
  }

  async function mudarGrupoDre(conta, grupo_dre) {
    setErro(null);
    try {
      await atualizarConta(conta.id, { grupo_dre: grupo_dre || null });
      carregar();
    } catch (e) {
      setErro(e.message);
    }
  }

  const contasFiltradas = contas.filter((c) =>
    !filtro || c.codigo.includes(filtro) || c.nome.toLowerCase().includes(filtro.toLowerCase())
  );

  // só contas de receita/despesa/custo têm Grupo DRE pra classificar
  const contasClassificaveis = useMemo(
    () => contasFiltradas.filter((c) => TIPOS_COM_GRUPO_DRE.includes(c.tipo)),
    [contasFiltradas]
  );
  const todasSelecionadas = contasClassificaveis.length > 0
    && contasClassificaveis.every((c) => selecionadas.has(c.id));

  function toggleSelecionada(id) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelecionarTodas() {
    setSelecionadas((prev) => {
      if (todasSelecionadas) {
        const next = new Set(prev);
        contasClassificaveis.forEach((c) => next.delete(c.id));
        return next;
      }
      const next = new Set(prev);
      contasClassificaveis.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function aplicarGrupoDreLote() {
    setAplicandoLote(true);
    setErro(null);
    try {
      await atualizarContasEmLote([...selecionadas], { grupo_dre: grupoDreLote || null });
      setSelecionadas(new Set());
      setGrupoDreLote('');
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setAplicandoLote(false);
    }
  }

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
        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
      </form>

      <input
        placeholder="Buscar por código ou nome..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ marginBottom: 12, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, width: 280 }}
      />

      {selecionadas.size > 0 && (
        <div className="contabil-form" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 16px' }}>
          <strong>{selecionadas.size} conta{selecionadas.size > 1 ? 's' : ''} selecionada{selecionadas.size > 1 ? 's' : ''}</strong>
          <select value={grupoDreLote} onChange={(e) => setGrupoDreLote(e.target.value)}>
            {GRUPOS_DRE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <button type="button" className="btn-navy" onClick={aplicarGrupoDreLote} disabled={aplicandoLote}>
            {aplicandoLote ? 'Aplicando...' : 'Aplicar Grupo DRE'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSelecionadas(new Set())} disabled={aplicandoLote}>
            Limpar seleção
          </button>
        </div>
      )}

      {carregando ? <p>Carregando plano de contas...</p> : (
        <table className="contabil-tabela">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={todasSelecionadas} onChange={toggleSelecionarTodas}
                  disabled={contasClassificaveis.length === 0} title="Selecionar todas (receita/despesa/custo)" />
              </th>
              <th>Código</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Natureza</th>
              <th>Analítica</th>
              <th>Grupo DRE</th>
            </tr>
          </thead>
          <tbody>
            {contasFiltradas.map((c) => {
              const classificavel = TIPOS_COM_GRUPO_DRE.includes(c.tipo);
              return (
                <tr key={c.id}>
                  <td>
                    {classificavel && (
                      <input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => toggleSelecionada(c.id)} />
                    )}
                  </td>
                  <td>{c.codigo}</td>
                  <td>{c.nome}</td>
                  <td>{c.tipo}</td>
                  <td>{c.natureza}</td>
                  <td>{c.aceita_lancamento ? 'Sim' : 'Não (sintética)'}</td>
                  <td>
                    {classificavel ? (
                      <select value={c.grupo_dre ?? ''} onChange={(e) => mudarGrupoDre(c, e.target.value)}>
                        {GRUPOS_DRE.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                      </select>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
