import { useState, useEffect, useMemo } from 'react';
import { RefreshCwIcon, InfoIcon, ArrowDownCircleIcon, ArrowUpCircleIcon, FileEditIcon, CheckCircleIcon } from 'lucide-react';
import { listarDocumentosFiscais, obterUltimaSincronizacao, sincronizarDocumentosFiscaisAgora } from './documentosFiscaisApi';
import GerarLancamentoModal from './GerarLancamentoModal';
import { useToast } from '../../components/shared';

function fmt(v) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}
function fmtDataHora(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function competenciaAtual() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Notas fiscais (entrada/saída, NF-e/NFS-e) importadas da Omie/OneFlow —
// sincronizadas sozinhas todo dia (documentos-fiscais-cron.js) ou sob
// demanda pelo botão aqui. Foco é a nota de ENTRADA (compra/serviço
// tomado): dá pra gerar o lançamento contábil direto daqui — crédito
// sempre vai pra sub-conta do fornecedor (ver documentosFiscaisApi.js).
export default function DocumentosFiscaisTab({ empresaId }) {
  const { show } = useToast();

  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [documentos, setDocumentos] = useState(null); // null = carregando
  const [erro, setErro] = useState(null);
  const [ultimaSinc, setUltimaSinc] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [tipoFiltro, setTipoFiltro] = useState('entrada'); // entrada | saida | todos
  const [lancarDocumento, setLancarDocumento] = useState(null);

  const carregar = () => {
    listarDocumentosFiscais({ competencia, clienteId: empresaId, tipoMovimento: tipoFiltro !== 'todos' ? tipoFiltro : null })
      .then(setDocumentos)
      .catch((e) => setErro(e.message));
    obterUltimaSincronizacao().then(setUltimaSinc).catch(() => {});
  };

  useEffect(() => { carregar(); }, [empresaId, competencia, tipoFiltro]);

  const sincronizarAgora = async () => {
    setSincronizando(true);
    try {
      const r = await sincronizarDocumentosFiscaisAgora();
      show?.(`Sincronizado: ${r.sincronizados}/${r.total} empresas${r.erros?.length ? `, ${r.erros.length} com erro` : ''}${r.motivo ? ` — ${r.motivo}` : ''}`);
      carregar();
    } catch (e) {
      show?.('Erro ao sincronizar: ' + e.message);
    }
    setSincronizando(false);
  };

  const totalValor = useMemo(() => (documentos || []).reduce((s, d) => s + Number(d.valor_total || 0), 0), [documentos]);

  return (
    <div>
      <div className="notice notice-info" style={{ marginBottom: 12 }}>
        <InfoIcon size={14} />
        <span>
          {ultimaSinc ? `Última sincronização: ${fmtDataHora(ultimaSinc)}` : 'Ainda não sincronizado.'}
          {' '}— roda sozinho todo dia; se parar de atualizar, o token do OneFlow provavelmente venceu (precisa relogar no modal de configuração, aba ERP).
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}
          style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, background: 'var(--surface)', color: 'var(--text1)' }}>
          {[0, 1, 2, 3].map((i) => {
            const d = new Date(); d.setMonth(d.getMonth() - i);
            const c = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            const label = i === 0 ? 'Competência atual' : i === 1 ? 'Competência anterior' : '';
            return <option key={c} value={c}>{label ? `${label} (${c})` : c}</option>;
          })}
        </select>
        <div className="tabs" style={{ maxWidth: 280 }}>
          <button className={`tab-btn ${tipoFiltro === 'entrada' ? 'active' : ''}`} onClick={() => setTipoFiltro('entrada')}>Entrada</button>
          <button className={`tab-btn ${tipoFiltro === 'saida' ? 'active' : ''}`} onClick={() => setTipoFiltro('saida')}>Saída</button>
          <button className={`tab-btn ${tipoFiltro === 'todos' ? 'active' : ''}`} onClick={() => setTipoFiltro('todos')}>Todos</button>
        </div>
        <button className="btn btn-accent" onClick={sincronizarAgora} disabled={sincronizando}>
          <RefreshCwIcon size={14} className={sincronizando ? 'spinning' : ''} />
          {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </div>

      {documentos && documentos.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>
            Total {tipoFiltro === 'entrada' ? 'de entrada' : tipoFiltro === 'saida' ? 'de saída' : ''} em {competencia}
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text1)', marginTop: 4 }}>{fmt(totalValor)}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{documentos.length} documento{documentos.length !== 1 ? 's' : ''}</div>
        </div>
      )}

      {erro && <p style={{ color: 'var(--danger)' }}>{erro}</p>}
      {!erro && documentos === null && <p style={{ color: 'var(--text2)' }}>Carregando...</p>}
      {!erro && documentos && documentos.length === 0 && (
        <div className="empty">
          <p>🧾</p>
          Nenhum documento fiscal encontrado pra essa competência/filtro.
        </div>
      )}

      {documentos && documentos.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                <th style={thStyle}>Emissão</th>
                <th style={thStyle}>Fornecedor/Cliente</th>
                <th style={thStyle}>Modelo</th>
                <th style={thStyle}>Número</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
                <th style={thStyle}>Tipo</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtData(d.data_emissao)}</td>
                  <td style={tdStyle}>{d.razao_social_terceiro || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{d.modelo || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{d.numero}{d.serie ? `/${d.serie}` : ''}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(d.valor_total)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4,
                      color: d.tipo_movimento === 'entrada' ? 'var(--ok)' : 'var(--info)',
                      background: d.tipo_movimento === 'entrada' ? 'var(--ok-dim)' : 'var(--info-dim)',
                      borderRadius: 99, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {d.tipo_movimento === 'entrada' ? <ArrowDownCircleIcon size={11} /> : <ArrowUpCircleIcon size={11} />}
                      {d.tipo_movimento === 'entrada' ? 'Entrada' : d.tipo_movimento === 'saida' ? 'Saída' : '—'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {d.lancamento_id ? (
                      <span title="Já tem lançamento gerado" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: 'var(--ok)' }}>
                        <CheckCircleIcon size={13} /> Lançado
                      </span>
                    ) : (
                      <button onClick={() => setLancarDocumento(d)} title="Gerar lançamento contábil"
                        style={{ background: 'var(--accent-dim)', border: 'none', borderRadius: 99, width: 26, height: 26,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--accent)' }}>
                        <FileEditIcon size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lancarDocumento && (
        <GerarLancamentoModal documento={lancarDocumento} onClose={() => setLancarDocumento(null)} onGerado={carregar} />
      )}

      <style>{`.spinning { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '9px 12px', fontSize: 10.5, color: 'var(--text3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' };
const tdStyle = { padding: '8px 12px' };
