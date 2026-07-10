import React, { useEffect, useState, useCallback } from 'react';
import { listarContas, listarLancamentos, criarLancamento, excluirLancamento } from './contabilApi';

function linhaVazia() {
  return { conta_id: '', tipo: 'debito', valor: '' };
}

export default function LancamentosTab({ empresaId, periodo }) {
  const [contas, setContas] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // formulário simples: 1 débito + 1 crédito por padrão, com opção de
  // virar lançamento composto (mais linhas) quando precisar
  const [data, setData] = useState(periodo.dataFim);
  const [historico, setHistorico] = useState('');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [linhas, setLinhas] = useState([
    { conta_id: '', tipo: 'debito', valor: '' },
    { conta_id: '', tipo: 'credito', valor: '' },
  ]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [c, l] = await Promise.all([
        listarContas(empresaId),
        listarLancamentos(empresaId, periodo),
      ]);
      setContas(c.filter((conta) => conta.aceita_lancamento));
      setLancamentos(l);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  function atualizarLinha(idx, campo, valor) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l)));
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, linhaVazia()]);
  }

  function removerLinha(idx) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalDebito = linhas.filter(l => l.tipo === 'debito').reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const totalCredito = linhas.filter(l => l.tipo === 'credito').reduce((s, l) => s + (Number(l.valor) || 0), 0);
  const bate = Math.abs(totalDebito - totalCredito) < 0.005 && totalDebito > 0;

  async function salvar(e) {
    e.preventDefault();
    setErro(null);
    try {
      const partidas = linhas
        .filter((l) => l.conta_id && Number(l.valor) > 0)
        .map((l) => ({ conta_id: l.conta_id, tipo: l.tipo, valor: Number(l.valor) }));

      await criarLancamento({
        empresaId,
        data,
        historico,
        numeroDocumento,
        partidas,
      });

      setHistorico('');
      setNumeroDocumento('');
      setLinhas([{ conta_id: '', tipo: 'debito', valor: '' }, { conta_id: '', tipo: 'credito', valor: '' }]);
      carregar();
    } catch (e) {
      setErro(e.message);
    }
  }

  async function apagar(id) {
    if (!window.confirm('Excluir este lançamento?')) return;
    await excluirLancamento(id);
    carregar();
  }

  return (
    <div>
      <form className="contabil-form" onSubmit={salvar}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 160px', gap: 8, marginBottom: 12 }}>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          <input
            type="text"
            placeholder="Histórico (ex: Pagamento de fornecedor XYZ)"
            value={historico}
            onChange={(e) => setHistorico(e.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Nº documento (opcional)"
            value={numeroDocumento}
            onChange={(e) => setNumeroDocumento(e.target.value)}
          />
        </div>

        {linhas.map((linha, idx) => (
          <div className="contabil-form-linha" key={idx}>
            <select value={linha.conta_id} onChange={(e) => atualizarLinha(idx, 'conta_id', e.target.value)} required>
              <option value="">Selecione a conta...</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} - {c.nome}</option>
              ))}
            </select>
            <select value={linha.tipo} onChange={(e) => atualizarLinha(idx, 'tipo', e.target.value)}>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Valor"
              value={linha.valor}
              onChange={(e) => atualizarLinha(idx, 'valor', e.target.value)}
              required
            />
            {linhas.length > 2 && (
              <button type="button" className="btn-ghost" onClick={() => removerLinha(idx)}>Remover</button>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <button type="button" className="btn-ghost" onClick={adicionarLinha}>+ Adicionar linha (lançamento composto)</button>
          <div style={{ fontSize: '0.85rem', color: bate ? 'var(--ok)' : 'var(--danger)' }}>
            Débito: R$ {totalDebito.toFixed(2)} &nbsp;|&nbsp; Crédito: R$ {totalCredito.toFixed(2)}
            {!bate && ' — não bate ainda'}
          </div>
        </div>

        {erro && <p style={{ color: 'var(--danger)', marginTop: 8 }}>{erro}</p>}

        <button type="submit" className="btn-navy" style={{ marginTop: 12 }} disabled={!bate}>
          Lançar
        </button>
      </form>

      {carregando ? (
        <p>Carregando lançamentos...</p>
      ) : (
        <table className="contabil-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Histórico</th>
              <th>Contas</th>
              <th className="num">Valor</th>
              <th>Origem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lancamentos.map((l) => {
              const valor = l.partidas_contabeis
                ?.filter((p) => p.tipo === 'debito')
                .reduce((s, p) => s + Number(p.valor), 0) ?? 0;
              const contasResumo = l.partidas_contabeis
                ?.map((p) => `${p.tipo === 'debito' ? 'D' : 'C'} ${p.contas_contabeis?.codigo}`)
                .join(' / ');
              return (
                <tr key={l.id}>
                  <td>{new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td>{l.historico}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{contasResumo}</td>
                  <td className="num">R$ {valor.toFixed(2)}</td>
                  <td><span className="badge-origem">{l.origem === 'importacao_extrato' ? 'Extrato' : 'Manual'}</span></td>
                  <td><button className="btn-ghost" onClick={() => apagar(l.id)}>Excluir</button></td>
                </tr>
              );
            })}
            {lancamentos.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--text2)' }}>Nenhum lançamento no período.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
