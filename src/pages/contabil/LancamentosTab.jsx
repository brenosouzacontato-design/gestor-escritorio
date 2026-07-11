import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  listarContas, listarLancamentos, excluirLancamento,
  reclassificarLancamento, reclassificarLancamentosEmLote, salvarRegraClassificacao,
} from './contabilApi';
import ContaCombobox from './ContaCombobox';
import NovoLancamentoModal from './NovoLancamentoModal';

// mesma conta transitória usada em ImportarExtratoTab.jsx pra transações
// que chegaram sem classificação (ver CODIGO_CONTA_PENDENTE lá)
const CODIGO_CONTA_PENDENTE = '1.1.01.001.002'; // "Valores a Identificar"

export default function LancamentosTab({ empresaId, periodo }) {
  const [contas, setContas] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);

  // filtros nos cabeçalhos da tabela de lançamentos
  const [filtroHistorico, setFiltroHistorico] = useState('');
  const [filtroContas, setFiltroContas] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  // seleção múltipla pra classificar vários lançamentos pendentes de uma vez
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [contaLote, setContaLote] = useState('');
  const [aplicandoLote, setAplicandoLote] = useState(false);

  // partida sendo editada agora (troca o pill por um combobox de busca)
  const [editandoPartidaId, setEditandoPartidaId] = useState(null);

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

  async function apagar(id) {
    if (!window.confirm('Excluir este lançamento?')) return;
    await excluirLancamento(id);
    carregar();
  }

  // edição de uma partida específica (D ou C) — funciona tanto pra
  // classificar um lançamento pendente quanto pra corrigir um já conciliado
  async function editarPartida(lancamento, partida, novaContaId) {
    if (!novaContaId || novaContaId === partida.conta_id) { setEditandoPartidaId(null); return; }
    setErro(null);
    try {
      await reclassificarLancamento(lancamento.id, partida.id, novaContaId);
      await salvarRegraClassificacao(empresaId, lancamento.historico, novaContaId).catch(() => {});
      setEditandoPartidaId(null);
      carregar();
    } catch (e) {
      setErro(e.message);
    }
  }

  // enriquece cada lançamento com o valor total e as partidas separadas por
  // tipo — usado tanto pra exibir quanto pros filtros/seleção em lote
  const lancamentosEnriquecidos = useMemo(() => lancamentos.map((l) => {
    const debitoPartidas = l.partidas_contabeis?.filter((p) => p.tipo === 'debito') ?? [];
    const creditoPartidas = l.partidas_contabeis?.filter((p) => p.tipo === 'credito') ?? [];
    const valor = debitoPartidas.reduce((s, p) => s + Number(p.valor), 0);
    const contasResumo = l.partidas_contabeis
      ?.map((p) => `${p.tipo === 'debito' ? 'D' : 'C'} ${p.contas_contabeis?.codigo} ${p.contas_contabeis?.nome ?? ''}`)
      .join(' / ') ?? '';
    const partidaPendente = l.partidas_contabeis?.find((p) => p.contas_contabeis?.codigo === CODIGO_CONTA_PENDENTE);
    return { ...l, valor, contasResumo, debitoPartidas, creditoPartidas, partidaPendente };
  }), [lancamentos]);

  const lancamentosFiltrados = useMemo(() => lancamentosEnriquecidos.filter((l) => {
    if (filtroHistorico && !l.historico?.toLowerCase().includes(filtroHistorico.toLowerCase())) return false;
    if (filtroContas && !l.contasResumo.toLowerCase().includes(filtroContas.toLowerCase())
      && !l.numero_documento?.toLowerCase().includes(filtroContas.toLowerCase())) return false;
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
      await Promise.all(
        selecionadosClassificaveis.map((l) => salvarRegraClassificacao(empresaId, l.historico, contaLote).catch(() => {}))
      );
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-navy" onClick={() => setModalAberto(true)}>+ Novo lançamento</button>
        {erro && <p style={{ color: 'var(--danger)', margin: 0 }}>{erro}</p>}
      </div>

      {modalAberto && (
        <NovoLancamentoModal
          empresaId={empresaId}
          contas={contas}
          dataInicial={periodo.dataFim}
          onClose={() => setModalAberto(false)}
          onSalvo={carregar}
        />
      )}

      {selecionados.size > 0 && (
        <div className="contabil-form" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 16px' }}>
          <strong>{selecionados.size} lançamento{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}</strong>
          <ContaCombobox contas={contas} value={contaLote} onChange={setContaLote}
            excluirCodigos={[CODIGO_CONTA_PENDENTE]} placeholder="Selecione a conta..." style={{ width: 280 }} />
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
        <div className="contabil-tabela-scroll">
          <table className="contabil-tabela">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" checked={todosSelecionados} onChange={toggleSelecionarTodos}
                    disabled={lancamentosClassificaveis.length === 0} title="Selecionar todos os pendentes" />
                </th>
                <th style={{ whiteSpace: 'nowrap' }}>Data</th>
                <th style={{ minWidth: 260 }}>
                  Histórico
                  <input placeholder="filtrar..." value={filtroHistorico} onChange={(e) => setFiltroHistorico(e.target.value)}
                    style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                </th>
                <th style={{ whiteSpace: 'nowrap' }}>Nº doc.</th>
                <th style={{ whiteSpace: 'nowrap', minWidth: 220 }}>
                  Débito / Crédito
                  <input placeholder="filtrar conta..." value={filtroContas} onChange={(e) => setFiltroContas(e.target.value)}
                    style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                </th>
                <th className="num" style={{ whiteSpace: 'nowrap' }}>Valor</th>
                <th style={{ whiteSpace: 'nowrap' }}>
                  Origem
                  <select value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}
                    style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <option value="">Todas</option>
                    <option value="manual">Manual</option>
                    <option value="importacao_extrato">Extrato</option>
                  </select>
                </th>
                <th style={{ whiteSpace: 'nowrap' }}>
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
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.historico}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{l.numero_documento || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      {[...l.debitoPartidas, ...l.creditoPartidas].map((p) => (
                        editandoPartidaId === p.id ? (
                          <ContaCombobox
                            key={p.id}
                            contas={contas}
                            value={p.conta_id}
                            onChange={(novoId) => editarPartida(l, p, novoId)}
                            excluirCodigos={[CODIGO_CONTA_PENDENTE]}
                            style={{ width: 240 }}
                          />
                        ) : (
                          <span key={p.id}
                            className={p.tipo === 'debito' ? 'pill-debito' : 'pill-credito'}
                            title={`${p.contas_contabeis?.nome ?? ''} — clique pra trocar`}
                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={() => setEditandoPartidaId(p.id)}>
                            {p.tipo === 'debito' ? <ArrowDownIcon size={11} /> : <ArrowUpIcon size={11} />}
                            {p.tipo === 'debito' ? 'D' : 'C'} {p.contas_contabeis?.codigo}
                          </span>
                        )
                      ))}
                    </div>
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>R$ {l.valor.toFixed(2)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span className="badge-origem">{l.origem === 'importacao_extrato' ? 'Extrato' : 'Manual'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {l.conciliado ? (
                      <span className="badge-origem" style={{ background: 'var(--ok-dim)', color: 'var(--ok)' }}>Conciliado</span>
                    ) : (
                      <span className="badge-origem" style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}>A conciliar</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><button className="btn-ghost" onClick={() => apagar(l.id)}>Excluir</button></td>
                </tr>
              ))}
              {lancamentosFiltrados.length === 0 && (
                <tr><td colSpan={9} style={{ color: 'var(--text2)' }}>Nenhum lançamento no período{lancamentos.length > 0 ? ' com esses filtros' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
