import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { listarContas, listarLancamentos, criarLancamento, excluirLancamento, reclassificarLancamento, reclassificarLancamentosEmLote } from './contabilApi';

// mesma conta transitória usada em ImportarExtratoTab.jsx pra transações
// que chegaram sem classificação (ver CODIGO_CONTA_PENDENTE lá)
const CODIGO_CONTA_PENDENTE = '1.1.01.001.002'; // "Valores a Identificar"

function linhaVazia() {
  return { conta_id: '', tipo: 'debito', valor: '' };
}

export default function LancamentosTab({ empresaId, periodo }) {
  const [contas, setContas] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  // filtros nos cabeçalhos da tabela de lançamentos
  const [filtroHistorico, setFiltroHistorico] = useState('');
  const [filtroContas, setFiltroContas] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  // seleção múltipla pra classificar vários lançamentos pendentes de uma vez
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [contaLote, setContaLote] = useState('');
  const [aplicandoLote, setAplicandoLote] = useState(false);

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

  async function classificar(lancamento, partidaPendenteId, novaContaId) {
    if (!novaContaId) return;
    setErro(null);
    try {
      await reclassificarLancamento(lancamento.id, partidaPendenteId, novaContaId);
      carregar();
    } catch (e) {
      setErro(e.message);
    }
  }

  // enriquece cada lançamento com o valor total, o resumo de contas e a
  // partida "Valores a Identificar" (se houver) — usado tanto pra exibir
  // quanto pros filtros/seleção em lote
  const lancamentosEnriquecidos = useMemo(() => lancamentos.map((l) => {
    const valor = l.partidas_contabeis
      ?.filter((p) => p.tipo === 'debito')
      .reduce((s, p) => s + Number(p.valor), 0) ?? 0;
    const contasResumo = l.partidas_contabeis
      ?.map((p) => `${p.tipo === 'debito' ? 'D' : 'C'} ${p.contas_contabeis?.codigo} ${p.contas_contabeis?.nome ?? ''}`)
      .join(' / ') ?? '';
    const partidaPendente = l.partidas_contabeis?.find((p) => p.contas_contabeis?.codigo === CODIGO_CONTA_PENDENTE);
    return { ...l, valor, contasResumo, partidaPendente };
  }), [lancamentos]);

  const lancamentosFiltrados = useMemo(() => lancamentosEnriquecidos.filter((l) => {
    if (filtroHistorico && !l.historico?.toLowerCase().includes(filtroHistorico.toLowerCase())) return false;
    if (filtroContas && !l.contasResumo.toLowerCase().includes(filtroContas.toLowerCase())) return false;
    if (filtroOrigem && l.origem !== filtroOrigem) return false;
    if (filtroStatus === 'conciliado' && !l.conciliado) return false;
    if (filtroStatus === 'a_conciliar' && l.conciliado) return false;
    return true;
  }), [lancamentosEnriquecidos, filtroHistorico, filtroContas, filtroOrigem, filtroStatus]);

  // só dá pra selecionar/classificar em lote quem ainda não foi conciliado
  const lancamentosClassificaveis = useMemo(
    () => lancamentosFiltrados.filter((l) => !l.conciliado && l.partidaPendente),
    [lancamentosFiltrados]
  );
  const todosSelecionados = lancamentosClassificaveis.length > 0
    && lancamentosClassificaveis.every((l) => selecionados.has(l.id));

  function toggleSelecionado(id) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelecionarTodos() {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosSelecionados) lancamentosClassificaveis.forEach((l) => next.delete(l.id));
      else lancamentosClassificaveis.forEach((l) => next.add(l.id));
      return next;
    });
  }

  async function aplicarClassificacaoLote() {
    if (!contaLote) return;
    setAplicandoLote(true);
    setErro(null);
    try {
      const selecionadosClassificaveis = lancamentosClassificaveis.filter((l) => selecionados.has(l.id));
      const partidaIds = selecionadosClassificaveis.map((l) => l.partidaPendente.id);
      const lancamentoIds = selecionadosClassificaveis.map((l) => l.id);
      await reclassificarLancamentosEmLote(partidaIds, lancamentoIds, contaLote);
      setSelecionados(new Set());
      setContaLote('');
      carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setAplicandoLote(false);
    }
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

      {selecionados.size > 0 && (
        <div className="contabil-form" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 16px' }}>
          <strong>{selecionados.size} lançamento{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}</strong>
          <select value={contaLote} onChange={(e) => setContaLote(e.target.value)}>
            <option value="">Selecione a conta...</option>
            {contas.filter((c) => c.codigo !== CODIGO_CONTA_PENDENTE).map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} - {c.nome}</option>
            ))}
          </select>
          <button type="button" className="btn-navy" onClick={aplicarClassificacaoLote} disabled={aplicandoLote || !contaLote}>
            {aplicandoLote ? 'Aplicando...' : 'Classificar selecionados'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSelecionados(new Set())} disabled={aplicandoLote}>
            Limpar seleção
          </button>
        </div>
      )}

      {carregando ? (
        <p>Carregando lançamentos...</p>
      ) : (
        <table className="contabil-tabela">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={todosSelecionados} onChange={toggleSelecionarTodos}
                  disabled={lancamentosClassificaveis.length === 0} title="Selecionar todos os pendentes" />
              </th>
              <th>Data</th>
              <th>
                Histórico
                <input placeholder="filtrar..." value={filtroHistorico} onChange={(e) => setFiltroHistorico(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
              </th>
              <th>
                Contas
                <input placeholder="filtrar..." value={filtroContas} onChange={(e) => setFiltroContas(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
              </th>
              <th className="num">Valor</th>
              <th>
                Origem
                <select value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <option value="">Todas</option>
                  <option value="manual">Manual</option>
                  <option value="importacao_extrato">Extrato</option>
                </select>
              </th>
              <th>
                Status
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
                  style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <option value="">Todos</option>
                  <option value="conciliado">Conciliado</option>
                  <option value="a_conciliar">A conciliar</option>
                </select>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lancamentosFiltrados.map((l) => (
              <tr key={l.id}>
                <td>
                  {!l.conciliado && l.partidaPendente && (
                    <input type="checkbox" checked={selecionados.has(l.id)} onChange={() => toggleSelecionado(l.id)} />
                  )}
                </td>
                <td>{new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                <td>{l.historico}</td>
                <td style={{ fontSize: '0.8rem' }}>
                  {l.partidas_contabeis?.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ' / '}
                      <span style={{ color: p.tipo === 'debito' ? 'var(--accent)' : 'var(--warn)', fontWeight: 700 }}>
                        {p.tipo === 'debito' ? 'D' : 'C'}
                      </span>
                      {' '}<span style={{ color: 'var(--text2)' }}>{p.contas_contabeis?.codigo}</span>
                    </span>
                  ))}
                </td>
                <td className="num">R$ {l.valor.toFixed(2)}</td>
                <td><span className="badge-origem">{l.origem === 'importacao_extrato' ? 'Extrato' : 'Manual'}</span></td>
                <td>
                  {l.conciliado ? (
                    <span className="badge-origem" style={{ background: 'var(--ok-dim)', color: 'var(--ok)' }}>Conciliado</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="badge-origem" style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}>A conciliar</span>
                      {l.partidaPendente && (
                        <select defaultValue="" onChange={(e) => classificar(l, l.partidaPendente.id, e.target.value)}>
                          <option value="" disabled>Classificar...</option>
                          {contas.filter((c) => c.codigo !== CODIGO_CONTA_PENDENTE).map((c) => (
                            <option key={c.id} value={c.id}>{c.codigo} - {c.nome}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </td>
                <td><button className="btn-ghost" onClick={() => apagar(l.id)}>Excluir</button></td>
              </tr>
            ))}
            {lancamentosFiltrados.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--text2)' }}>Nenhum lançamento no período{lancamentos.length > 0 ? ' com esses filtros' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
