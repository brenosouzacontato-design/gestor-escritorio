import React from 'react';
import { XIcon } from 'lucide-react';

function fmt(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Abre ao clicar numa linha da DRE: lista os lançamentos individuais que
// compõem o total daquela conta no período selecionado.
export default function ContaLancamentosSidebar({ conta, lancamentos, carregando, onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={onClose} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 1000,
        background: 'var(--surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 20px rgba(27,43,75,.15)' }}>

        <div style={{ padding: '14px 16px', background: '#1B2B4B', borderBottom: '1px solid #243660',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {conta.nome}
            </div>
            <div style={{ fontSize: 10, color: '#8fadd4', marginTop: 2 }}>
              {lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'} no período
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 24, height: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4', flexShrink: 0 }}>
            <XIcon size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', background: 'var(--bg)' }}>
          {carregando && <p style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando...</p>}
          {!carregando && lancamentos.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '24px 0' }}>Nenhum lançamento nesse período.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {lancamentos.map((l) => (
              <div key={l.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {new Date(l.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: l.tipo === 'debito' ? 'var(--accent)' : 'var(--warn)' }}>
                    {l.tipo === 'debito' ? 'D' : 'C'} {fmt(l.valor)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text1)', marginTop: 3 }}>{l.historico}</div>
                {l.numeroDocumento && (
                  <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>Doc. {l.numeroDocumento}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
