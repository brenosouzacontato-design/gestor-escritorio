import React, { useEffect, useState } from 'react';
import { ArrowDownCircleIcon, ArrowUpCircleIcon, FileTextIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { listarDocumentosFiscais } from './documentosFiscaisApi';

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Página pública (sem login) pra compartilhar as notas fiscais de uma
// competência com o cliente via link — painel só de leitura, em cards,
// mesmo modelo do RelatorioCompartilhadoPage.jsx (DRE/Balancete). Acessada
// via ?share=notasfiscais&empresa=<id>&competencia=MM/YYYY (ver main.jsx).
export default function NotasFiscaisCompartilhadoPage({ empresaId, competencia }) {
  const [empresaNome, setEmpresaNome] = useState('');
  const [documentos, setDocumentos] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      setErro(null);
      try {
        const [{ data: cliente, error: errCliente }, docs] = await Promise.all([
          supabase.from('clientes').select('nome').eq('id', empresaId).single(),
          listarDocumentosFiscais({ clienteId: empresaId, competencia }),
        ]);
        if (errCliente) throw errCliente;
        setEmpresaNome(cliente?.nome ?? '');
        setDocumentos(docs);
      } catch (e) {
        setErro(e.message);
      }
    })();
  }, [empresaId, competencia]);

  const entradas = (documentos || []).filter((d) => d.tipo_movimento === 'entrada');
  const saidas = (documentos || []).filter((d) => d.tipo_movimento === 'saida');
  const totalEntrada = entradas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
  const totalSaida = saidas.reduce((s, d) => s + Number(d.valor_total || 0), 0);
  const qtdNFe = (documentos || []).filter((d) => d.modelo === 'NF-e').length;
  const qtdNFSe = (documentos || []).filter((d) => d.modelo && d.modelo !== 'NF-e').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px', background: 'var(--navy)' }}>
          <div style={{ fontSize: 11, color: 'var(--navy-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileTextIcon size={13} /> Notas Fiscais
          </div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 700, marginTop: 4 }}>{empresaNome || '...'}</div>
          <div style={{ fontSize: 12, color: 'var(--navy-text)', marginTop: 2 }}>Competência {competencia}</div>
        </div>

        <div style={{ padding: 24 }}>
          {documentos === null && !erro && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
          {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}

          {documentos !== null && !erro && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
                <CardMetrica icone={<ArrowDownCircleIcon size={15} color="var(--ok)" />} label={`Entrada (${entradas.length})`} valor={fmt(totalEntrada)} cor="var(--ok)" />
                <CardMetrica icone={<ArrowUpCircleIcon size={15} color="var(--info)" />} label={`Saída (${saidas.length})`} valor={fmt(totalSaida)} cor="var(--info)" />
                <CardMetrica label="Total de documentos" valor={String(documentos.length)} />
                <CardMetrica label="NF-e / NFS-e" valor={`${qtdNFe} / ${qtdNFSe}`} />
              </div>

              {documentos.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhuma nota fiscal nessa competência.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {documentos.map((d) => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.razao_social_terceiro || 'Documento fiscal'}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>
                          {d.modelo || ''}{d.numero ? ` ${d.numero}` : ''} · {fmtData(d.data_emissao)}
                        </div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
                        color: d.tipo_movimento === 'entrada' ? 'var(--ok)' : 'var(--info)',
                        background: d.tipo_movimento === 'entrada' ? 'var(--ok-dim)' : 'var(--info-dim)',
                        borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                        {d.tipo_movimento === 'entrada' ? <ArrowDownCircleIcon size={11} /> : <ArrowUpCircleIcon size={11} />}
                        {d.tipo_movimento === 'entrada' ? 'Entrada' : 'Saída'}
                      </span>
                      <span className="num" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(d.valor_total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)' }}>
          Painel gerado pelo Gestor — Escritório Contábil, só pra conferência.
        </div>
      </div>
    </div>
  );
}

function CardMetrica({ icone, label, valor, cor }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {icone}{label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, color: cor || 'var(--text1)', marginTop: 5 }}>{valor}</div>
    </div>
  );
}
