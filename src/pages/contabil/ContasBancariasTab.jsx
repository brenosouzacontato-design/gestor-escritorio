import React, { useEffect, useState, useCallback } from 'react';
import { listarContasBancoGerenciamento, criarContaBanco, atualizarConta, excluirOuDesativarConta } from './contabilApi';

// Cadastro das contas bancárias (e caixa/aplicações) da empresa — é daqui
// que sai a lista do seletor "Conta bancária do extrato" na importação.
// Cada empresa pode ter quantas contas precisar (múltiplos bancos, caixa,
// aplicações etc).
export default function ContasBancariasTab({ empresaId }) {
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setContas(await listarContasBancoGerenciamento(empresaId)); }
    finally { setCarregando(false); }
  }, [empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function adicionar(e) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await criarContaBanco(empresaId, nome.trim());
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

  return (
    <div>
      <p style={{ color: 'var(--text2)', fontSize: '0.85rem', maxWidth: 640, marginTop: 0 }}>
        Cadastre aqui os bancos, caixa e aplicações de verdade dessa empresa — cada uma vira uma opção
        no seletor "Conta bancária do extrato" na hora de importar. Dá pra ter quantas contas precisar.
      </p>

      <form className="contabil-form" onSubmit={adicionar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="Nome da conta (ex: Bradesco, Sicoob Ag 1234 CC 56789...)" value={nome}
            onChange={(e) => setNome(e.target.value)} style={{ flex: 1 }} required />
          <button type="submit" className="btn-navy" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}
      </form>

      {carregando ? <p>Carregando contas bancárias...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16, maxWidth: 480 }}>
          {contas.length === 0 && <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Nenhuma conta cadastrada.</p>}
          {contas.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
              opacity: c.ativo ? 1 : 0.5 }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--text1)' }}>{c.nome}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="btn-ghost" onClick={() => alternarAtiva(c)} style={{ fontSize: '0.75rem' }}>
                  {c.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button className="btn-ghost" onClick={() => excluir(c)} style={{ fontSize: '0.75rem' }}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
