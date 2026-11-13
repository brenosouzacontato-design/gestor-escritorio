import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { carregarDadosDreGerencialCom, montarDreGerencial, ehDisponivel } from '../../lib/dreGerencial';
import { reclassificarLancamento } from './contabilApi';
import DreGerencialView from './DreGerencialView';
import CompartilharButton from './CompartilharButton';
import ContaCombobox from './ContaCombobox';

const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// atalhos de período: a DRE gerencial é mensal, então faz sentido olhar
// vários meses de uma vez (o período do topo vale para todas as abas)
function atalhos() {
  const h = new Date();
  const inicioMes = (a, m) => new Date(a, m, 1);
  const fimMes = (a, m) => new Date(a, m + 1, 0);
  return [
    { rotulo: 'Mês atual', inicio: iso(inicioMes(h.getFullYear(), h.getMonth())), fim: iso(fimMes(h.getFullYear(), h.getMonth())) },
    { rotulo: 'Mês anterior', inicio: iso(inicioMes(h.getFullYear(), h.getMonth() - 1)), fim: iso(fimMes(h.getFullYear(), h.getMonth() - 1)) },
    { rotulo: 'Últimos 3 meses', inicio: iso(inicioMes(h.getFullYear(), h.getMonth() - 2)), fim: iso(fimMes(h.getFullYear(), h.getMonth())) },
    { rotulo: 'Últimos 6 meses', inicio: iso(inicioMes(h.getFullYear(), h.getMonth() - 5)), fim: iso(fimMes(h.getFullYear(), h.getMonth())) },
    { rotulo: 'Ano atual', inicio: `${h.getFullYear()}-01-01`, fim: `${h.getFullYear()}-12-31` },
  ];
}

// DRE gerencial mensal (modelo "DRE mensal — Amanda Lima Gonçalves"), com
// indicadores, gráfico, detalhamento por contraparte e pontos de atenção.
// Cálculo em src/lib/dreGerencial.js.
export default function DRETab({ empresaId, periodo, empresaNome, onPeriodo }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [painel, setPainel] = useState(null); // { titulo, ids }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setDados(await carregarDadosDreGerencialCom(supabase, empresaId, periodo));
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [empresaId, periodo.dataInicio, periodo.dataFim]);

  useEffect(() => { carregar(); }, [carregar]);

  const dre = useMemo(() => (dados ? montarDreGerencial(dados) : null), [dados]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="dre-g-atalhos">
          {onPeriodo && atalhos().map((a) => {
            const ativo = periodo.dataInicio === a.inicio && periodo.dataFim === a.fim;
            return (
              <button key={a.rotulo} type="button" className="btn-ghost"
                style={{ fontSize: '0.78rem', fontWeight: ativo ? 700 : 400, borderColor: ativo ? 'var(--accent)' : undefined }}
                onClick={() => onPeriodo({ dataInicio: a.inicio, dataFim: a.fim })}>
                {a.rotulo}
              </button>
            );
          })}
        </div>
        <CompartilharButton tipo="dre" empresaId={empresaId} empresaNome={empresaNome} periodo={periodo} />
      </div>

      {carregando && !dados && <p>Calculando DRE...</p>}
      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}
      {!erro && dre && (
        <div style={{ opacity: carregando ? 0.6 : 1 }}>
          <DreGerencialView dre={dre} onAbrirLancamentos={setPainel} />
        </div>
      )}

      {painel && dados && (
        <PainelLancamentos
          titulo={painel.titulo}
          lancamentos={dados.lancamentos.filter((l) => painel.ids.includes(l.id))}
          contas={dados.contas}
          onClose={() => setPainel(null)}
          onAlterado={carregar}
        />
      )}
    </div>
  );
}

// lista os lançamentos de uma contraparte e deixa trocar a contrapartida
// (a partida que não é caixa/banco) — reclassificar aqui já reflete na DRE
function PainelLancamentos({ titulo, lancamentos, contas, onClose, onAlterado }) {
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(null);
  const contaPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);
  const lancaveis = useMemo(() => contas.filter((c) => c.aceita_lancamento && c.ativo !== false), [contas]);

  async function trocar(l, partida, novaContaId) {
    if (!novaContaId || novaContaId === partida.conta_id) return;
    setSalvando(l.id);
    setErro(null);
    try {
      await reclassificarLancamento(l.id, partida.id, novaContaId);
      await onAlterado();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(15,23,42,.35)' }} onClick={onClose} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, height: 'min(620px, 80vh)', background: 'var(--surface)',
        borderTopLeftRadius: 16, borderTopRightRadius: 16, display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 30px rgba(15,23,42,.25)' }}>
        <div style={{ padding: '14px 20px', background: 'var(--navy)', color: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <b style={{ fontSize: 14 }}>{titulo}</b>
          <button type="button" className="btn-ghost" style={{ color: '#fff' }} onClick={onClose}>Fechar</button>
        </div>
        {erro && <p style={{ color: 'var(--danger)', padding: '0 20px' }}>{erro}</p>}
        <div style={{ overflow: 'auto', padding: '8px 20px 20px' }}>
          <table className="contabil-tabela" style={{ width: '100%' }}>
            <thead><tr><th>Data</th><th>Histórico</th><th style={{ textAlign: 'right' }}>Valor</th><th>Conta (contrapartida)</th></tr></thead>
            <tbody>
              {lancamentos.map((l) => {
                const contrapartida = (l.partidas_contabeis ?? []).find((p) => !ehDisponivel(contaPorId.get(p.conta_id)?.codigo));
                const valor = (l.partidas_contabeis ?? []).filter((p) => p.tipo === 'debito').reduce((s, p) => s + Number(p.valor), 0);
                return (
                  <tr key={l.id}>
                    <td>{new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                    <td>{l.historico}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{fmt(valor)}</td>
                    <td style={{ minWidth: 280 }}>
                      {contrapartida ? (
                        <ContaCombobox contas={lancaveis} value={contrapartida.conta_id} disabled={salvando === l.id}
                          onChange={(id) => trocar(l, contrapartida, id)} />
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
