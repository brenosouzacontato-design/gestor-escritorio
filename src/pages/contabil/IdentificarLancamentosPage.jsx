import React, { useEffect, useState } from 'react';
import { PencilIcon, CheckCircleIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listarLancamentosAIdentificar, salvarObservacaoCliente } from './contabilApi';
import { Modal } from '../../components/shared';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function sinal(natureza) {
  return natureza === 'entrada' ? '+ ' : natureza === 'saida' ? '− ' : '';
}
function corNatureza(natureza) {
  return natureza === 'saida' ? 'var(--danger)' : natureza === 'entrada' ? 'var(--ok)' : 'var(--text1)';
}

// Página pública (sem login) pra mandar pro cliente a lista de lançamentos
// que ainda não foram identificados (mesma conta transitória "Valores a
// Identificar" usada na importação de extrato). Os pendentes ficam numa
// tabela compacta (data/descrição/valor/tipo + ícone) — clicar no ícone
// abre um popup pra escrever o que foi aquela movimentação; os já
// identificados ficam em cards abaixo, só pra conferência (dá pra reabrir
// o popup e corrigir clicando no card). Acessada via
// ?identificar=1&empresa=<id>&inicio=&fim= (ver main.jsx).
export default function IdentificarLancamentosPage({ empresaId, dataInicio, dataFim }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [lancamentos, setLancamentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [editando, setEditando] = useState(null); // lançamento aberto no popup de identificação

  const carregar = async () => {
    setErro(null);
    try {
      const [{ data: cliente, error: errCliente }, itens] = await Promise.all([
        supabase.from('clientes').select('nome').eq('id', empresaId).single(),
        listarLancamentosAIdentificar(empresaId, { dataInicio, dataFim }),
      ]);
      if (errCliente) throw errCliente;
      setEmpresaNome(cliente?.nome ?? '');
      setLancamentos(itens);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { carregar() }, [empresaId, dataInicio, dataFim]);

  const pendentes = lancamentos.filter((l) => !l.observacaoCliente);
  const identificados = lancamentos.filter((l) => l.observacaoCliente);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Lançamentos a identificar
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>
            Período de {fmtData(dataInicio)} até {fmtData(dataFim)}
          </div>
        </div>

        <div style={{ padding: '16px 24px 6px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Clique no ícone <PencilIcon size={11} style={{ verticalAlign: -1 }} /> ao lado de cada lançamento pra dizer o que foi essa movimentação
          (ex: "pagamento de fornecedor X", "recebimento do cliente Y"). Salva assim que você confirmar, sem precisar terminar tudo de uma vez.
        </div>

        <div style={{ padding: '10px 24px 24px' }}>
          {carregando && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {!carregando && !erro && lancamentos.length === 0 && (
            <p style={{ color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>
              Nenhum lançamento pendente de identificação nesse período.
            </p>
          )}

          {pendentes.length > 0 && (
            <div style={{ marginBottom: identificados.length > 0 ? 24 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                A identificar ({pendentes.length})
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      <th style={thStyle}>Data</th>
                      <th style={thStyle}>Descrição</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
                      <th style={thStyle}>Tipo</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentes.map((l) => (
                      <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtData(l.data)}</td>
                        <td style={{ ...tdStyle, color: 'var(--text1)', fontWeight: 500 }}>{l.historico}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: corNatureza(l.natureza), whiteSpace: 'nowrap' }}>
                          {sinal(l.natureza)}{fmt(l.valor)}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: corNatureza(l.natureza),
                            background: l.natureza === 'entrada' ? 'var(--ok-dim)' : l.natureza === 'saida' ? 'var(--danger-dim)' : 'var(--surface2)',
                            borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                            {l.natureza === 'entrada' ? 'Entrada' : l.natureza === 'saida' ? 'Saída' : '—'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button onClick={() => setEditando(l)} title="Identificar esse lançamento"
                            style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 26, height: 26,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
                            <PencilIcon size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {identificados.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                Identificados ({identificados.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {identificados.map((l) => (
                  <div key={l.id} onClick={() => setEditando(l)} title="Clique pra corrigir"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtData(l.data)}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: corNatureza(l.natureza) }}>{sinal(l.natureza)}{fmt(l.valor)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text1)', marginTop: 4, fontWeight: 500 }}>{l.historico}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginTop: 8, fontSize: 12, color: 'var(--text2)' }}>
                      <CheckCircleIcon size={12} color="var(--ok)" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>{l.observacaoCliente}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Enviado pelo Gestor — Escritório Contábil, pra ajudar a identificar movimentações do extrato.
        </div>
      </div>

      {editando && (
        <ModalIdentificar lancamento={editando} onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }} />
      )}
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' };
const tdStyle = { padding: '8px 12px' };

function ModalIdentificar({ lancamento, onClose, onSaved }) {
  const [observacao, setObservacao] = useState(lancamento.observacaoCliente || '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await salvarObservacaoCliente(lancamento.id, observacao.trim());
      onSaved();
    } catch (e) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Identificar lançamento</p>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{fmtData(lancamento.data)}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: corNatureza(lancamento.natureza) }}>
            {sinal(lancamento.natureza)}{fmt(lancamento.valor)}
          </span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text1)', marginTop: 3, fontWeight: 500 }}>{lancamento.historico}</div>
      </div>
      <div className="form-field">
        <label className="form-label">O que foi esse lançamento?</label>
        <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={4} autoFocus
          placeholder="ex: pagamento de fornecedor X, recebimento do cliente Y..." />
      </div>
      {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>Erro ao salvar: {erro}</div>}
      <button className="btn btn-accent" style={{ width: '100%' }} onClick={salvar} disabled={salvando || !observacao.trim()}>
        {salvando ? 'Salvando...' : 'Salvar'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  );
}
