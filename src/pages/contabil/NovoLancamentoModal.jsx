import React, { useState } from 'react';
import { Modal, useToast } from '../../components/shared';
import ContaCombobox from './ContaCombobox';
import { criarLancamento } from './contabilApi';

export default function NovoLancamentoModal({ empresaId, contas, dataInicial, onClose, onSalvo }) {
  const { show } = useToast();
  const [data, setData] = useState(dataInicial);
  const [debitoId, setDebitoId] = useState('');
  const [creditoId, setCreditoId] = useState('');
  const [valor, setValor] = useState('');
  const [historico, setHistorico] = useState('');
  const [salvando, setSalvando] = useState(false);

  function onEnterSubmete(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }

  async function submit() {
    if (!data || !debitoId || !creditoId || !valor || !historico.trim()) {
      show('Preencha todos os campos.');
      return;
    }
    if (debitoId === creditoId) {
      show('Débito e crédito não podem ser a mesma conta.');
      return;
    }
    setSalvando(true);
    try {
      await criarLancamento({
        empresaId,
        data,
        historico,
        partidas: [
          { conta_id: debitoId, tipo: 'debito', valor: Number(valor) },
          { conta_id: creditoId, tipo: 'credito', valor: Number(valor) },
        ],
      });
      show('Lançamento criado.');
      onSalvo();
      onClose();
    } catch (e) {
      show(e.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Novo lançamento</p>

      <div className="form-field">
        <label className="form-label">Data</label>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
      </div>

      <div className="form-field">
        <label className="form-label">Débito</label>
        <ContaCombobox contas={contas} value={debitoId} onChange={setDebitoId} placeholder="Conta debitada..." />
      </div>

      <div className="form-field">
        <label className="form-label">Crédito</label>
        <ContaCombobox contas={contas} value={creditoId} onChange={setCreditoId} placeholder="Conta creditada..." />
      </div>

      <div className="form-field">
        <label className="form-label">Valor</label>
        <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={onEnterSubmete} placeholder="0,00" />
      </div>

      <div className="form-field">
        <label className="form-label">Histórico</label>
        <input type="text" value={historico} onChange={(e) => setHistorico(e.target.value)} onKeyDown={onEnterSubmete}
          placeholder="Ex: Pagamento de fornecedor XYZ" autoFocus />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-accent" onClick={submit} disabled={salvando}>
          {salvando ? 'Salvando...' : 'Lançar'}
        </button>
      </div>
    </Modal>
  );
}
