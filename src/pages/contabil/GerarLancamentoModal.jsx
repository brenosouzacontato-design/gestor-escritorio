import { useState, useEffect } from 'react';
import { Modal, useToast } from '../../components/shared';
import ContaCombobox from './ContaCombobox';
import { listarContas } from './contabilApi';
import { sugerirContaDebito, gerarLancamentoDeDocumento } from './documentosFiscaisApi';

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
}

// Gera o lançamento contábil de uma nota fiscal — crédito sempre vai pra
// sub-conta do fornecedor (criada sozinha se ainda não existir, ver
// documentosFiscaisApi.js), só o débito (o que foi comprado) precisa de
// confirmação humana. Sugere pela regra de classificação já cadastrada
// quando existe uma pro fornecedor do documento.
export default function GerarLancamentoModal({ documento, onClose, onGerado }) {
  const { show } = useToast();
  const [contas, setContas] = useState([]);
  const [debitoId, setDebitoId] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setCarregando(true);
      try {
        const [listaContas, sugestao] = await Promise.all([
          listarContas(documento.cliente_id),
          sugerirContaDebito(documento.cliente_id, documento),
        ]);
        setContas(listaContas.filter((c) => c.aceita_lancamento));
        if (sugestao) setDebitoId(sugestao);
      } catch (e) {
        setErro(e.message);
      } finally {
        setCarregando(false);
      }
    })();
  }, [documento.id]);

  const confirmar = async () => {
    if (!debitoId) { show?.('Escolha a conta de débito.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      await gerarLancamentoDeDocumento(documento, debitoId);
      show?.('Lançamento gerado.');
      onGerado();
      onClose();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <p className="modal-title">Gerar lançamento</p>

      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{fmtData(documento.data_emissao)}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{fmt(documento.valor_total)}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text1)', marginTop: 3, fontWeight: 500 }}>{documento.razao_social_terceiro}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{documento.modelo} {documento.numero}</div>
      </div>

      {carregando ? (
        <p style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando plano de contas...</p>
      ) : (
        <>
          <div className="form-field">
            <label className="form-label">Débito — o que foi comprado</label>
            <ContaCombobox contas={contas} value={debitoId} onChange={setDebitoId} placeholder="Escolher conta de despesa/custo/ativo..." />
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.5 }}>
            Crédito vai automaticamente pra sub-conta de <strong>{documento.razao_social_terceiro}</strong> dentro
            de "Fornecedores" — cria a conta se ainda não existir.
          </p>
        </>
      )}

      {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>Erro: {erro}</div>}

      <button className="btn btn-accent" style={{ width: '100%' }} onClick={confirmar} disabled={salvando || carregando || !debitoId}>
        {salvando ? 'Gerando...' : 'Gerar lançamento'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancelar</button>
    </Modal>
  );
}
