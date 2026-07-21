import React, { useState, useEffect } from 'react';
import { XIcon, PencilIcon, FileTextIcon, FileSpreadsheetIcon } from 'lucide-react';
import { editarContaBasico, contaTemLancamentos, atualizarLancamento, reclassificarLancamento } from './contabilApi';
import { exportarLancamentosPDF, exportarLancamentosExcel } from './exportarRelatorio';
import ContaCombobox from './ContaCombobox';

const CODIGO_CONTA_PENDENTE = '1.1.01.001.002';

const TIPO_LABEL = {
  ativo: 'Ativo', passivo: 'Passivo', patrimonio_liquido: 'Patrimônio Líquido',
  receita: 'Receita', custo: 'Custo', despesa: 'Despesa',
};

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDataInput(iso) {
  return iso;
}

// Abre de baixo pra cima ao clicar numa conta na DRE ou no Balancete: é o
// razão contábil daquela conta no período — data, histórico, contrapartida,
// D/C, valor e saldo corrente — e cada linha é editável (reclassificar a
// contrapartida, corrigir histórico/data), sem precisar ir até a aba
// Lançamentos. Também permite editar a própria conta (nome/tipo) e exportar
// a lista em PDF ou Excel.
export default function ContaLancamentosSidebar({
  conta, lancamentos, carregando, onClose, periodo, empresaNome, contas,
  saldoAnterior = 0, onContaAtualizada, onAlterado,
}) {
  const [editando, setEditando] = useState(false);
  const [editNome, setEditNome] = useState(conta.nome);
  const [editTipo, setEditTipo] = useState(conta.tipo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMontado(true));
    return () => cancelAnimationFrame(t);
  }, []);

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

  async function salvarHistorico(linha, novoHistorico) {
    if (novoHistorico === linha.historico) return;
    try {
      await atualizarLancamento(linha.lancamentoId, { historico: novoHistorico });
      await onAlterado?.();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function salvarData(linha, novaData) {
    if (!novaData || novaData === linha.data) return;
    try {
      await atualizarLancamento(linha.lancamentoId, { data: novaData });
      await onAlterado?.();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function reclassificarContrapartida(linha, novaContaId) {
    if (!linha.contrapartida || !novaContaId || novaContaId === linha.contrapartida.contaId) return;
    try {
      await reclassificarLancamento(linha.lancamentoId, linha.contrapartida.partidaId, novaContaId);
      await onAlterado?.();
    } catch (e) {
      setErro(e.message);
    }
  }

  let saldoCorrente = saldoAnterior;
  const linhasComSaldo = lancamentos.map((l) => {
    const delta = conta.natureza === 'devedora'
      ? (l.tipo === 'debito' ? l.valor : -l.valor)
      : (l.tipo === 'credito' ? l.valor : -l.valor);
    saldoCorrente += delta;
    return { ...l, saldoCorrente };
  });

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: montado ? 'rgba(15,23,42,.35)' : 'transparent',
        transition: 'background .2s ease' }} onClick={onClose} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, height: 'min(680px, 82vh)',
        background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: '0 -8px 30px rgba(15,23,42,.25)',
        transform: montado ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .22s ease-out' }}>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 0', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--border)' }} />
        </div>

        <div style={{ padding: '10px 20px 14px', background: '#1B2B4B', borderBottom: '1px solid #243660',
          borderTopLeftRadius: 16, borderTopRightRadius: 16, flexShrink: 0 }}>
          {editando ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', maxWidth: 560 }}>
              <input value={editNome} onChange={(e) => setEditNome(e.target.value)} autoFocus
                style={{ flex: '1 1 220px', padding: '6px 9px', borderRadius: 6, border: '1px solid #3a5488', fontSize: 13 }} />
              <select value={editTipo} onChange={(e) => setEditTipo(e.target.value)}
                style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid #3a5488', fontSize: 13 }}>
                <option value="despesa">Despesa</option>
                <option value="receita">Receita</option>
                <option value="custo">Custo</option>
                <option value="ativo">Ativo</option>
                <option value="passivo">Passivo</option>
                <option value="patrimonio_liquido">Patrimônio Líquido</option>
              </select>
              <button onClick={salvarEdicao} disabled={salvando}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#3a5488', color: '#fff', cursor: 'pointer' }}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
              <button onClick={() => setEditando(false)}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: '#8fadd4', cursor: 'pointer' }}>
                Cancelar
              </button>
              {erro && <p style={{ fontSize: 11, color: '#ff9b9b', width: '100%', margin: 0 }}>{erro}</p>}
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
                  Razão — {conta.codigo} {conta.nome}
                </div>
                <div style={{ fontSize: 11, color: '#8fadd4', marginTop: 3 }}>
                  {lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'} no período · saldo final{' '}
                  {fmt(linhasComSaldo.length ? linhasComSaldo[linhasComSaldo.length - 1].saldoCorrente : saldoAnterior)}
                </div>
                {erro && <p style={{ fontSize: 11, color: '#ff9b9b', marginTop: 4 }}>{erro}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                {periodo && (
                  <>
                    <button onClick={() => exportarLancamentosPDF({ conta, lancamentos, periodo, empresaNome })}
                      title="Exportar PDF"
                      style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, padding: '5px 9px',
                        display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#8fadd4', fontSize: 11 }}>
                      <FileTextIcon size={12} /> PDF
                    </button>
                    <button onClick={() => exportarLancamentosExcel({ conta, lancamentos, periodo, empresaNome })}
                      title="Exportar Excel"
                      style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, padding: '5px 9px',
                        display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#8fadd4', fontSize: 11 }}>
                      <FileSpreadsheetIcon size={12} /> Excel
                    </button>
                  </>
                )}
                <button onClick={iniciarEdicao} title="Editar conta"
                  style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4' }}>
                  <PencilIcon size={13} />
                </button>
                <button onClick={onClose} title="Fechar"
                  style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 28, height: 28,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4' }}>
                  <XIcon size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', background: 'var(--bg)' }}>
          {carregando && <p style={{ fontSize: 12, color: 'var(--text3)', padding: '14px 20px' }}>Carregando...</p>}
          {!carregando && lancamentos.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '28px 0' }}>Nenhum lançamento nesse período.</p>
          )}
          {!carregando && lancamentos.length > 0 && (
            <table className="contabil-tabela" style={{ width: '100%', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Data</th>
                  <th>Histórico</th>
                  <th style={{ width: 230 }}>Contrapartida</th>
                  <th className="num" style={{ width: 130 }}>Valor</th>
                  <th className="num" style={{ width: 130 }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {linhasComSaldo.map((l) => (
                  <LinhaRazao key={l.id} linha={l} contas={contas}
                    onSalvarHistorico={salvarHistorico} onSalvarData={salvarData}
                    onReclassificarContrapartida={reclassificarContrapartida} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function LinhaRazao({ linha, contas, onSalvarHistorico, onSalvarData, onReclassificarContrapartida }) {
  const [historico, setHistorico] = useState(linha.historico);
  const [data, setData] = useState(linha.data);

  useEffect(() => { setHistorico(linha.historico); }, [linha.historico]);
  useEffect(() => { setData(linha.data); }, [linha.data]);

  return (
    <tr>
      <td>
        <input type="date" value={fmtDataInput(data)} onChange={(e) => { setData(e.target.value); onSalvarData(linha, e.target.value); }}
          style={{ fontSize: '0.78rem', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, width: '100%' }} />
      </td>
      <td>
        <input value={historico} onChange={(e) => setHistorico(e.target.value)}
          onBlur={() => onSalvarHistorico(linha, historico)}
          style={{ fontSize: '0.82rem', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6, width: '100%' }} />
        {linha.numeroDocumento && (
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Doc. {linha.numeroDocumento}</div>
        )}
      </td>
      <td>
        {linha.contrapartida ? (
          <ContaCombobox contas={contas ?? []} value={linha.contrapartida.contaId}
            onChange={(novoId) => onReclassificarContrapartida(linha, novoId)}
            excluirCodigos={[CODIGO_CONTA_PENDENTE]} style={{ width: '100%' }} />
        ) : <span style={{ color: 'var(--text3)' }}>—</span>}
      </td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700, color: linha.tipo === 'debito' ? 'var(--accent)' : 'var(--warn)' }}>
          {linha.tipo === 'debito' ? 'D' : 'C'} {fmt(linha.valor)}
        </span>
      </td>
      <td className={`num ${linha.saldoCorrente < 0 ? 'valor-negativo' : ''}`} style={{ whiteSpace: 'nowrap' }}>
        {fmt(linha.saldoCorrente)}
      </td>
    </tr>
  );
}
