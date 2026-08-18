import { useState } from 'react';
import { PencilIcon, CheckCircleIcon, AlertTriangleIcon } from 'lucide-react';
import { salvarObservacaoCliente } from './contabilApi';
import { Modal } from '../../components/shared';

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

// Lançamentos "a identificar" — cards de resumo (quantidade + valor) no
// topo, tabela compacta dos pendentes (data/descrição/valor/tipo + ícone
// que abre um popup pra identificar) e os já identificados em cards
// abaixo, só pra conferência (clicar reabre o popup pra corrigir).
// Reaproveitado pela tela de compartilhamento (IdentificarLancamentosPage,
// link mandado pro cliente) e pela aba Contábil do Painel do cliente —
// mesma UX nos dois lugares onde a identificação aparece.
//
// `onSaved` é chamado depois de um salvamento bem-sucedido — cada chamador
// decide como atualizar sua lista (refetch completo, ou só forçar
// re-render já que o objeto do lançamento é mutado em memória aqui).
export default function LancamentosIdentificar({ lancamentos, onSaved }) {
  const [editando, setEditando] = useState(null);

  const pendentes = lancamentos.filter((l) => !l.observacaoCliente);
  const identificados = lancamentos.filter((l) => l.observacaoCliente);
  const totalPendente = pendentes.reduce((s, l) => s + (l.valor || 0), 0);
  const totalIdentificado = identificados.reduce((s, l) => s + (l.valor || 0), 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <CardResumo icone={<AlertTriangleIcon size={13} />} label="A identificar" valor={fmt(totalPendente)} qtd={pendentes.length} cor="var(--warn)" />
        <CardResumo icone={<CheckCircleIcon size={13} />} label="Identificados" valor={fmt(totalIdentificado)} qtd={identificados.length} cor="var(--ok)" />
      </div>

      {pendentes.length > 0 && (
        <div style={{ marginBottom: identificados.length > 0 ? 20 : 0 }}>
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
      )}

      {editando && (
        <ModalIdentificar lancamento={editando} onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); onSaved?.(); }} />
      )}
    </div>
  );
}

function CardResumo({ icone, label, valor, qtd, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone} {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: cor, marginTop: 5 }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{qtd} lançamento{qtd !== 1 ? 's' : ''}</div>
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
      const texto = observacao.trim();
      await salvarObservacaoCliente(lancamento.id, texto);
      lancamento.observacaoCliente = texto;
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
