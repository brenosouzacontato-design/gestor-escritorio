import React, { useEffect, useState, useCallback } from 'react';
import { listarContasTodasGerenciamento, criarContaQualquerTipo, atualizarConta, excluirOuDesativarConta } from './contabilApi';

const TIPO_LABEL = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receita', custo: 'Custo', despesa: 'Despesa',
};
const TIPO_COLOR = {
  ativo: { bg: 'var(--accent-dim, var(--surface2))', color: 'var(--accent)' },
  passivo: { bg: 'var(--warn-dim)', color: 'var(--warn)' },
  patrimonio_liquido: { bg: 'var(--surface2)', color: 'var(--navy2)' },
  receita: { bg: 'var(--ok-dim)', color: 'var(--ok)' },
  custo: { bg: 'var(--warn-dim)', color: 'var(--warn)' },
  despesa: { bg: 'var(--danger-dim)', color: 'var(--danger)' },
};
const GRUPOS = [
  ['ativo', 'passivo', 'patrimonio_liquido'],
  ['receita', 'custo', 'despesa'],
];

// Plano de contas completo, porém simples: mostra os 6 tipos de conta em
// lista plana por tipo (sem hierarquia/código manual do plano padrão
// original importado) — é aqui que se cadastra qualquer conta nova, de
// qualquer tipo, pra empresa.
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
    try { setContas(await listarContasTodasGerenciamento(empresaId)); }
    finally { setCarregando(false); }
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await criarContaQualquerTipo(empresaId, nome.trim(), tipo);
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

  return (
    <div>
      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Nome da conta (ex: Aluguel, Venda de produtos, Empréstimos...)" value={nome}
            onChange={(e) => setNome(e.target.value)} style={{ flex: 1 }} required />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 180 }}>
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="custo">Custo</option>
            <option value="ativo">Ativo</option>
            <option value="passivo">Passivo</option>
            <option value="patrimonio_liquido">Patrimônio Líquido</option>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {GRUPOS.map((linha, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
              {linha.map((t) => (
                <ContaGrupo key={t} tipo={t} contas={contasFiltradas.filter((c) => c.tipo === t)}
                  onToggle={alternarAtiva} onExcluir={excluir} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContaGrupo({ tipo, contas, onToggle, onExcluir }) {
  const cfg = TIPO_COLOR[tipo];
  return (
    <div>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {TIPO_LABEL[tipo]} ({contas.length})
      </div>
      {contas.length === 0 && <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Nenhuma conta cadastrada.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {contas.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
            opacity: c.ativo ? 1 : 0.5 }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text1)' }}>{c.nome}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 99, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {TIPO_LABEL[tipo]}
              </span>
              <button className="btn-ghost" onClick={() => onToggle(c)} style={{ fontSize: '0.72rem' }}>
                {c.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button className="btn-ghost" onClick={() => onExcluir(c)} style={{ fontSize: '0.72rem' }}>
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
