import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  listarContasTodasGerenciamento, criarContaQualquerTipo, criarContaFilha,
  atualizarConta, excluirOuDesativarConta,
} from './contabilApi';
import ContaCombobox from './ContaCombobox';

const TIPO_LABEL = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receita', custo: 'Custo', despesa: 'Despesa',
};
const TIPO_COLOR = {
  ativo: { bg: 'var(--surface2)', color: 'var(--accent)' },
  passivo: { bg: 'var(--warn-dim)', color: 'var(--warn)' },
  patrimonio_liquido: { bg: 'var(--surface2)', color: 'var(--navy2)' },
  receita: { bg: 'var(--ok-dim)', color: 'var(--ok)' },
  custo: { bg: 'var(--warn-dim)', color: 'var(--warn)' },
  despesa: { bg: 'var(--danger-dim)', color: 'var(--danger)' },
};

// Plano de contas no modelo clássico: uma lista única (não mais separada
// em caixas por tipo), ordenada por código — como uma folha de plano de
// contas de verdade — com a classificação (tipo) visível em cada linha.
// Criar conta parte da seleção de uma conta já existente como base (herda
// tipo/natureza, vira filha de verdade via conta_pai_id — ver
// criarContaFilha), ou, sem base selecionada, direto por tipo pra uma
// conta raiz nova.
export default function PlanoContasTab({ empresaId }) {
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [nome, setNome] = useState('');
  const [contaBaseId, setContaBaseId] = useState('');
  const [tipo, setTipo] = useState('despesa');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setContas(await listarContasTodasGerenciamento(empresaId)); }
    finally { setCarregando(false); }
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const contasPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);

  async function adicionar(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      if (contaBaseId) {
        await criarContaFilha(empresaId, nome.trim(), contaBaseId);
      } else {
        await criarContaQualquerTipo(empresaId, nome.trim(), tipo);
      }
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

  const contasFiltradas = contas
    .filter((c) => !filtro || c.nome.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));

  return (
    <div>
      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ContaCombobox contas={contas} value={contaBaseId} onChange={setContaBaseId}
            placeholder="Conta base (opcional) — deixe em branco pra criar uma raiz nova" style={{ flex: '1 1 320px' }} />
          <input placeholder="Nome da nova conta" value={nome}
            onChange={(e) => setNome(e.target.value)} style={{ flex: '1 1 220px' }} required />
          {!contaBaseId && (
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ width: 180 }}>
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
              <option value="custo">Custo</option>
              <option value="ativo">Ativo</option>
              <option value="passivo">Passivo</option>
              <option value="patrimonio_liquido">Patrimônio Líquido</option>
            </select>
          )}
          <button type="submit" className="btn-navy" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
        {contaBaseId && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 6, marginBottom: 0 }}>
            A nova conta nasce como filha de "{contasPorId.get(contaBaseId)?.nome}" — mesmo tipo e natureza, código estendido.
          </p>
        )}
        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
      </form>

      <input
        placeholder="Buscar conta..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        style={{ margin: '12px 0', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, width: 280 }}
      />

      {carregando ? <p>Carregando plano de contas...</p> : (
        <div className="contabil-tabela-scroll">
          <table className="contabil-tabela">
            <thead>
              <tr>
                <th>Código</th>
                <th>Conta</th>
                <th>Classificação</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {contasFiltradas.map((c) => {
                const cfg = TIPO_COLOR[c.tipo];
                const pai = c.conta_pai_id ? contasPorId.get(c.conta_pai_id) : null;
                return (
                  <tr key={c.id} style={{ opacity: c.ativo ? 1 : 0.5 }}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem', color: 'var(--text2)' }}>{c.codigo}</td>
                    <td style={{ paddingLeft: pai ? 24 : undefined }}>
                      <span style={{ fontSize: '0.88rem', color: 'var(--text1)' }}>{pai ? '↳ ' : ''}{c.nome}</span>
                      {pai && <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}> — de {pai.nome}</span>}
                    </td>
                    <td>
                      <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 99, padding: '2px 8px', fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {TIPO_LABEL[c.tipo]}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" onClick={() => alternarAtiva(c)} style={{ fontSize: '0.72rem' }}>
                        {c.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button className="btn-ghost" onClick={() => excluir(c)} style={{ fontSize: '0.72rem', marginLeft: 6 }}>
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
              {contasFiltradas.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--text3)' }}>Nenhuma conta encontrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
