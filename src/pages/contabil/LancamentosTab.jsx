import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ArrowDownCircleIcon, ArrowUpCircleIcon } from 'lucide-react';
import {
  listarContas, listarLancamentos, excluirLancamento, excluirLancamentosEmLote,
  reclassificarLancamento, reclassificarLancamentosEmLote, salvarRegraClassificacao,
} from './contabilApi';
import ContaCombobox from './ContaCombobox';
import NovoLancamentoModal from './NovoLancamentoModal';

// mesma conta transitória usada em ImportarExtratoTab.jsx pra transações
// que chegaram sem classificação (ver CODIGO_CONTA_PENDENTE lá)
const CODIGO_CONTA_PENDENTE = '1.1.01.001.002'; // "Valores a Identificar"

// grupo "Disponibilidades" (caixa, bancos, aplicações) no plano de contas
// padrão — usado pra inferir a natureza (entrada/saída) de cada lançamento
// olhando se é o lado debitado ou creditado, igual já é feito na importação
const PREFIXO_DISPONIVEL = '1.1.01';

export default function LancamentosTab({ empresaId, periodo }) {
  const [contas, setContas] = useState([]);
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [modalAberto, setModalAberto] = useState(false);

  // filtros nos cabeçalhos da tabela de lançamentos
  const [filtroHistorico, setFiltroHistorico] = useState('');
  const [filtroContas, setFiltroContas] = useState('');
  const [filtroNatureza, setFiltroNatureza] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  // seleção múltipla pra classificar ou excluir vários lançamentos de uma vez
  const [selecionados, setSelecionados] = useState(() => new Set());
  const [contaLote, setContaLote] = useState('');
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const [excluindoLote, setExcluindoLote] = useState(false);

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
    if (!novaContaId || novaContaId === partida.conta_id) return;
    setErro(null);
    try {
      await reclassificarLancamento(lancamento.id, partida.id, novaContaId);
      await salvarRegraClassificacao(empresaId, lancamento.historico, novaContaId).catch(() => {});
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
    // natureza: entrou ou saiu dinheiro de caixa/banco? olha em qual lado
    // (débito ou crédito) tem conta do grupo Disponibilidades — se os dois
    // lados tocam disponibilidades (transferência entre contas) ou nenhum
    // toca (reclassificação interna), não dá pra definir uma natureza única.
    // "Valores a Identificar" também mora no grupo 1.1.01 mas é só uma conta
    // transitória pra transação ainda não classificada — não conta como
    // banco/caixa de verdade, senão toda transação pendente vira ambígua
    const ehContaDisponivelReal = (codigo) => codigo?.startsWith(PREFIXO_DISPONIVEL) && codigo !== CODIGO_CONTA_PENDENTE;
    const tocaDisponivelDebito = debitoPartidas.some((p) => ehContaDisponivelReal(p.contas_contabeis?.codigo));
    const tocaDisponivelCredito = creditoPartidas.some((p) => ehContaDisponivelReal(p.contas_contabeis?.codigo));
    const natureza = tocaDisponivelDebito === tocaDisponivelCredito ? null : (tocaDisponivelDebito ? 'entrada' : 'saida');
    return { ...l, valor, contasResumo, debitoPartidas, creditoPartidas, partidaPendente, natureza };
  }), [lancamentos]);

  const lancamentosFiltrados = useMemo(() => lancamentosEnriquecidos.filter((l) => {
    if (filtroHistorico && !l.historico?.toLowerCase().includes(filtroHistorico.toLowerCase())) return false;
    if (filtroContas && !l.contasResumo.toLowerCase().includes(filtroContas.toLowerCase())
      && !l.numero_documento?.toLowerCase().includes(filtroContas.toLowerCase())) return false;
    if (filtroNatureza && l.natureza !== filtroNatureza) return false;
    if (filtroStatus === 'conciliado' && !l.conciliado) return false;
    if (filtroStatus === 'a_conciliar' && l.conciliado) return false;
    return true;
  }), [lancamentosEnriquecidos, filtroHistorico, filtroContas, filtroNatureza, filtroStatus]);

  // classificar em lote só vale pra quem ainda não foi conciliado — excluir
  // em lote vale pra qualquer lançamento selecionado
  const lancamentosClassificaveis = useMemo(
    () => lancamentosFiltrados.filter((l) => !l.conciliado && l.partidaPendente),
    [lancamentosFiltrados]
  );
  const todosSelecionados = lancamentosFiltrados.length > 0
    && lancamentosFiltrados.every((l) => selecionados.has(l.id));

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
      if (todosSelecionados) lancamentosFiltrados.forEach((l) => next.delete(l.id));
      else lancamentosFiltrados.forEach((l) => next.add(l.id));
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

  async function excluirSelecionados() {
    if (selecionados.size === 0) return;
    if (!window.confirm(`Excluir ${selecionados.size} lançamento${selecionados.size > 1 ? 's' : ''}? Essa ação não pode ser desfeita.`)) return;
    setExcluindoLote(true);
    setErro(null);
    try {
      await excluirLancamentosEmLote([...selecionados]);
      setSelecionados(new Set());
      setContaLote('');
      carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setExcluindoLote(false);
    }
  }

  // exporta os lançamentos filtrados/visíveis em CSV (abre direto no Excel)
  function exportarCSV() {
    const cabecalho = ['Data', 'Histórico', 'Nº documento', 'Débito', 'Crédito', 'Valor', 'Origem', 'Status'];
    const nomeConta = (p) => p ? `${p.contas_contabeis?.codigo} - ${p.contas_contabeis?.nome}` : '';
    const linhas = lancamentosFiltrados.map((l) => [
      new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR'),
      l.historico,
      l.numero_documento || '',
      l.debitoPartidas.map(nomeConta).join(' / '),
      l.creditoPartidas.map(nomeConta).join(' / '),
      l.valor.toFixed(2).replace('.', ','),
      l.origem === 'importacao_extrato' ? 'Extrato' : 'Manual',
      l.conciliado ? 'Conciliado' : 'A conciliar',
    ]);
    const escapar = (v) => `"${String(v).replace(/"/g, '""')}"`;
    // ; como separador e vírgula decimal — é o que o Excel em pt-BR espera
    const csv = [cabecalho, ...linhas].map((linha) => linha.map(escapar).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lancamentos_${periodo.dataInicio}_a_${periodo.dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-navy" onClick={() => setModalAberto(true)}>+ Novo lançamento</button>
          <button className="btn-ghost" onClick={exportarCSV} disabled={lancamentosFiltrados.length === 0}>
            Exportar Excel
          </button>
        </div>
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
        <div className="contabil-form" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 16px', flexWrap: 'wrap' }}>
          <strong>{selecionados.size} lançamento{selecionados.size > 1 ? 's' : ''} selecionado{selecionados.size > 1 ? 's' : ''}</strong>
          <ContaCombobox contas={contas} value={contaLote} onChange={setContaLote}
            excluirCodigos={[CODIGO_CONTA_PENDENTE]} placeholder="Selecione a conta..." style={{ width: 280 }} />
          <button type="button" className="btn-navy" onClick={aplicarClassificacaoLote}
            disabled={aplicandoLote || excluindoLote || !contaLote || lancamentosClassificaveis.every((l) => !selecionados.has(l.id))}>
            {aplicandoLote ? 'Aplicando...' : 'Classificar selecionados'}
          </button>
          <button type="button" className="btn-danger" onClick={excluirSelecionados} disabled={aplicandoLote || excluindoLote}>
            {excluindoLote ? 'Excluindo...' : 'Excluir selecionados'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSelecionados(new Set())} disabled={aplicandoLote || excluindoLote}>
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
                <th style={{ width: 28 }}>
                  <input type="checkbox" checked={todosSelecionados} onChange={toggleSelecionarTodos}
                    disabled={lancamentosFiltrados.length === 0} title="Selecionar todos" />
                </th>
                <th style={{ whiteSpace: 'nowrap', width: 96 }}>Data</th>
                <th>
                  <div className="th-resizable">
                    Histórico
                    <input placeholder="filtrar..." value={filtroHistorico} onChange={(e) => setFiltroHistorico(e.target.value)}
                      style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                  </div>
                </th>
                <th style={{ whiteSpace: 'nowrap', width: 90 }}>Nº doc.</th>
                <th>
                  <div className="th-resizable">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent)' }}>
                      <ArrowDownIcon size={12} /> Débito
                    </span>
                    <input placeholder="filtrar conta..." value={filtroContas} onChange={(e) => setFiltroContas(e.target.value)}
                      style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 6 }} />
                  </div>
                </th>
                <th>
                  <div className="th-resizable">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warn)' }}>
                      <ArrowUpIcon size={12} /> Crédito
                    </span>
                  </div>
                </th>
                <th className="num" style={{ whiteSpace: 'nowrap', width: 110 }}>Valor</th>
                <th style={{ whiteSpace: 'nowrap', width: 110 }}>
                  Natureza
                  <select value={filtroNatureza} onChange={(e) => setFiltroNatureza(e.target.value)}
                    style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <option value="">Todas</option>
                    <option value="entrada">Entrada</option>
                    <option value="saida">Saída</option>
                  </select>
                </th>
                <th style={{ whiteSpace: 'nowrap', width: 120 }}>
                  Status
                  <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
                    style={{ display: 'block', marginTop: 4, width: '100%', fontSize: '0.75rem', fontWeight: 400, padding: '3px 4px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <option value="">Todos</option>
                    <option value="conciliado">Conciliado</option>
                    <option value="a_conciliar">A conciliar</option>
                  </select>
                </th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {lancamentosFiltrados.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input type="checkbox" checked={selecionados.has(l.id)} onChange={() => toggleSelecionado(l.id)} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.historico}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{l.numero_documento || '—'}</td>
                  <td style={{ minWidth: 180 }}>
                    <PartidaCell partidas={l.debitoPartidas} contas={contas} onEditar={(p, id) => editarPartida(l, p, id)} />
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <PartidaCell partidas={l.creditoPartidas} contas={contas} onEditar={(p, id) => editarPartida(l, p, id)} />
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>R$ {l.valor.toFixed(2)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {l.natureza ? (
                      <span className="badge-origem" style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: l.natureza === 'entrada' ? 'var(--ok-dim)' : 'var(--danger-dim)',
                        color: l.natureza === 'entrada' ? 'var(--ok)' : 'var(--danger)',
                      }}>
                        {l.natureza === 'entrada' ? <ArrowDownCircleIcon size={13} /> : <ArrowUpCircleIcon size={13} />}
                        {l.natureza === 'entrada' ? 'Entrada' : 'Saída'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text3)' }}>—</span>
                    )}
                  </td>
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
                <tr><td colSpan={10} style={{ color: 'var(--text2)' }}>Nenhum lançamento no período{lancamentos.length > 0 ? ' com esses filtros' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// campo de Débito ou Crédito de uma linha: mostra/edita a primeira partida
// daquele tipo direto via combobox; lançamentos compostos (raros — mais de
// uma partida do mesmo lado) mostram um badge "+N" com o resto em tooltip
function PartidaCell({ partidas, contas, onEditar }) {
  if (partidas.length === 0) return <span style={{ color: 'var(--text3)' }}>—</span>;
  const [principal, ...extras] = partidas;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <ContaCombobox
        contas={contas}
        value={principal.conta_id}
        onChange={(novoId) => onEditar(principal, novoId)}
        excluirCodigos={[CODIGO_CONTA_PENDENTE]}
        style={{ flex: 1, minWidth: 160 }}
      />
      {extras.length > 0 && (
        <span className="badge-origem" title={extras.map((p) => p.contas_contabeis?.nome).join(', ')}>
          +{extras.length}
        </span>
      )}
    </div>
  );
}
