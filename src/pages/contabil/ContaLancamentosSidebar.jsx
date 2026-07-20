import React, { useState } from 'react';
import { XIcon, PencilIcon, FileTextIcon, FileSpreadsheetIcon } from 'lucide-react';
import { editarContaBasico, contaTemLancamentos } from './contabilApi';
import { exportarLancamentosPDF, exportarLancamentosExcel } from './exportarRelatorio';

const TIPO_LABEL = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receita', custo: 'Custo', despesa: 'Despesa',
};

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Abre ao clicar numa linha da DRE ou do Balancete: lista os lançamentos
// individuais que compõem o total daquela conta no período selecionado.
// Também permite editar a própria conta (nome/tipo) e exportar essa lista
// em PDF ou Excel.
export default function ContaLancamentosSidebar({ conta, lancamentos, carregando, onClose, periodo, empresaNome, onContaAtualizada }) {
  const [editando, setEditando] = useState(false);
  const [editNome, setEditNome] = useState(conta.nome);
  const [editTipo, setEditTipo] = useState(conta.tipo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  function iniciarEdicao() {
    setEditNome(conta.nome);
    setEditTipo(conta.tipo);
    setErro(null);
    setEditando(true);
  }

  async function salvarEdicao() {
    if (!editNome.trim()) return;
    if (editTipo !== conta.tipo) {
      const temLancamento = await contaTemLancamentos(conta.id);
      if (temLancamento && !window.confirm(
        `"${conta.nome}" já tem lançamento. Mudar o tipo pra "${TIPO_LABEL[editTipo]}" muda a natureza contábil e recalcula o sinal de todo o histórico dela. Continuar?`
      )) return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const contaAtualizada = await editarContaBasico(conta.id, { nome: editNome.trim(), tipo: editTipo });
      setEditando(false);
      onContaAtualizada?.(contaAtualizada);
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 1000,
        background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 20px rgba(27,43,75,.15)' }}>

        <div style={{ padding: '14px 16px', background: '#1B2B4B', borderBottom: '1px solid #243660', flexShrink: 0 }}>
          {editando ? (
            <div>
              <input value={editNome} onChange={(e) => setEditNome(e.target.value)} autoFocus
                style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #3a5488', fontSize: 12.5 }} />
              <select value={editTipo} onChange={(e) => setEditTipo(e.target.value)}
                style={{ width: '100%', marginTop: 6, padding: '5px 8px', borderRadius: 6, border: '1px solid #3a5488', fontSize: 12.5 }}>
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
                <option value="custo">Custo</option>
                <option value="ativo">Ativo</option>
                <option value="passivo">Passivo</option>
                <option value="patrimonio_liquido">Patrimônio Líquido</option>
              </select>
              {erro && <p style={{ fontSize: 10.5, color: '#ff9b9b', marginTop: 4 }}>{erro}</p>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={salvarEdicao} disabled={salvando}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#3a5488', color: '#fff', cursor: 'pointer' }}>
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
                <button onClick={() => setEditando(false)}
                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: '#8fadd4', cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conta.nome}
                </div>
                <div style={{ fontSize: 10, color: '#8fadd4', marginTop: 2 }}>
                  {lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'} no período
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={iniciarEdicao} title="Editar conta"
                  style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 24, height: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4' }}>
                  <PencilIcon size={12} />
                </button>
                <button onClick={onClose} title="Fechar"
                  style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 24, height: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4' }}>
                  <XIcon size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {periodo && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <button onClick={() => exportarLancamentosPDF({ conta, lancamentos, periodo, empresaNome })}
              className="btn-ghost" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FileTextIcon size={12} /> PDF
            </button>
            <button onClick={() => exportarLancamentosExcel({ conta, lancamentos, periodo, empresaNome })}
              className="btn-ghost" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <FileSpreadsheetIcon size={12} /> Excel
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', background: 'var(--bg)' }}>
          {carregando && <p style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando...</p>}
          {!carregando && lancamentos.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>Nenhum lançamento nesse período.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {lancamentos.map((l) => (
              <div key={l.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: l.tipo === 'debito' ? 'var(--accent)' : 'var(--warn)' }}>
                    {l.tipo === 'debito' ? 'D' : 'C'} {fmt(l.valor)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text1)', marginTop: 3 }}>{l.historico}</div>
                {l.numeroDocumento && (
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>Doc. {l.numeroDocumento}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
