import React, { useEffect, useState, useCallback } from 'react';
import { listarContasReceitaDespesa, criarContaReceitaDespesa, atualizarConta, excluirOuDesativarConta } from './contabilApi';

const TIPO_LABEL = { receita: 'Receita', despesa: 'Despesa' };
const TIPO_COLOR = {
  receita: { bg: 'var(--ok-dim)', color: 'var(--ok)' },
  despesa: { bg: 'var(--danger-dim)', color: 'var(--danger)' },
};

// Plano de contas simplificado: só Receita e Despesa, lista plana (sem
// hierarquia/código manual) — é a base da classificação do extrato e da
// DRE. Contas de Ativo/Passivo/PL (banco, "Valores a Identificar") não
// aparecem aqui — continuam existindo por baixo, sustentando a partida
// dobrada da importação, mas não são gerenciadas nessa tela.
export default function PlanoContasTab({ empresaId }) {
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('despesa');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setContas(await listarContasReceitaDespesa(empresaId)); }
    finally { setCarregando(false); }
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await criarContaReceitaDespesa(empresaId, nome.trim(), tipo);
      setNome('');
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtiva(conta) {
    setErro(null);
    try {
      await atualizarConta(conta.id, { ativo: !conta.ativo });
      await carregar();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function excluir(conta) {
    if (!window.confirm(`Excluir "${conta.nome}"? Se já tiver lançamento, só será desativada.`)) return;
    setErro(null);
    try {
      const { desativada } = await excluirOuDesativarConta(conta.id);
      if (desativada) await carregar();
      else setContas((prev) => prev.filter((c) => c.id !== conta.id));
    } catch (e) {
      setErro(e.message);
    }
  }

  const contasFiltradas = contas.filter((c) =>
    !filtro || c.nome.toLowerCase().includes(filtro.toLowerCase())
  );
  const receitas = contasFiltradas.filter((c) => c.tipo === 'receita');
  const despesas = contasFiltradas.filter((c) => c.tipo === 'despesa');

  return (
    <div>
      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Nome da conta (ex: Aluguel, Venda de produtos...)" value={nome}
            onChange={(e) => setNome(e.target.value)} style={{ flex: 1 }} required />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 140 }}>
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
          <button type="submit" className="btn-navy" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
      </form>

      <input
        placeholder="Buscar conta..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ margin: '12px 0', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, width: 280 }}
      />

      {carregando ? <p>Carregando plano de contas...</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <ContaGrupo titulo="Receitas" contas={receitas} onToggle={alternarAtiva} onExcluir={excluir} />
          <ContaGrupo titulo="Despesas" contas={despesas} onToggle={alternarAtiva} onExcluir={excluir} />
        </div>
      )}
    </div>
  );
}

function ContaGrupo({ titulo, contas, onToggle, onExcluir }) {
  const cfg = TIPO_COLOR[titulo === 'Receitas' ? 'receita' : 'despesa'];
  return (
    <div>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {titulo} ({contas.length})
      </div>
      {contas.length === 0 && <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Nenhuma conta cadastrada.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {contas.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
            opacity: c.ativo ? 1 : 0.5 }}>
            <span style={{ fontSize: '0.88rem', color: 'var(--text1)' }}>{c.nome}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 99, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600 }}>
                {TIPO_LABEL[c.tipo]}
              </span>
              <button className="btn-ghost" onClick={() => onToggle(c)} style={{ fontSize: '0.75rem' }}>
                {c.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button className="btn-ghost" onClick={() => onExcluir(c)} style={{ fontSize: '0.75rem' }}>
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
