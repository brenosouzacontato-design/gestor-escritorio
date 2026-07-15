import { useState, useEffect } from 'react';
import { XIcon, CheckIcon, ExternalLinkIcon, ClockIcon, SaveIcon } from 'lucide-react';
import { listarHistoricoObrigacao, concluirEtapa, statusVisualEtapa } from './andamentoApi';

const STATUS_LABEL = { concluido: 'Concluído', em_andamento: 'Em andamento', pendente: 'Pendente', atrasado: 'Atrasado' };
const STATUS_COLOR = {
  concluido:    { bg: 'rgba(27,43,75,.10)',  fg: 'var(--navy)' },
  em_andamento: { bg: 'var(--accent-dim)',   fg: 'var(--accent)' },
  pendente:     { bg: 'var(--surface2)',     fg: 'var(--text3)' },
  atrasado:     { bg: 'var(--danger-dim)',   fg: 'var(--danger)' },
};

// Abre ao clicar numa etapa: título da obrigação, empresa, departamento,
// status da etapa clicada, e a timeline cronológica de historico_obrigacao.
// Se a etapa clicada for a atual (em_andamento), permite marcar concluída.
// Se a obrigação tiver task_id, mostra o botão "Abrir tarefa no Kanban".
export default function HistoricoObrigacaoModal({ obrigacao, etapa, clienteNome, departamentoNome, onClose, onAtualizado, onAbrirTarefa }) {
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [responsavel, setResponsavel] = useState(etapa.responsavel || '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarHistoricoObrigacao(obrigacao.id)
      .then((h) => { if (vivo) setHistorico(h); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [obrigacao.id]);

  const visual = statusVisualEtapa(etapa);
  const podeMarcarConcluida = etapa.status === 'em_andamento';

  const handleConcluir = async () => {
    setSalvando(true);
    try {
      await concluirEtapa(etapa, { responsavel: responsavel.trim() || undefined, observacao: observacao.trim() || undefined });
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(27,43,75,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', width: '100%', maxWidth: 420, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>

        <div style={{ padding: '12px 16px', background: '#1B2B4B', borderBottom: '1px solid #243660' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {obrigacao.titulo}
              </div>
              <div style={{ fontSize: 10, color: '#8fadd4', marginTop: 3 }}>{clienteNome} · {departamentoNome}</div>
            </div>
            <button onClick={onClose}
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#8fadd4', flexShrink: 0 }}>
              <XIcon size={13} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)' }}>

          {/* Etapa clicada */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{etapa.nome}</span>
              <span style={{ background: STATUS_COLOR[visual].bg, color: STATUS_COLOR[visual].fg, borderRadius: 99, padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                {STATUS_LABEL[visual]}
              </span>
            </div>
            {etapa.data_prevista && (
              <div style={{ fontSize: 11, color: visual === 'atrasado' ? 'var(--danger)' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <ClockIcon size={11} /> Previsto: {new Date(etapa.data_prevista + 'T12:00:00').toLocaleDateString('pt-BR')}
              </div>
            )}
            {etapa.data_conclusao && (
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                Concluída em {new Date(etapa.data_conclusao + 'T12:00:00').toLocaleDateString('pt-BR')}
                {etapa.responsavel ? ` por ${etapa.responsavel}` : ''}
              </div>
            )}

            {podeMarcarConcluida && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Responsável (opcional)"
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 12, color: 'var(--text1)', outline: 'none' }} />
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Observação (opcional)..."
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 12, color: 'var(--text1)', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                <button onClick={handleConcluir} disabled={salvando}
                  style={{ background: 'var(--navy)', border: 'none', borderRadius: 8, padding: '9px', fontSize: 12, color: '#fff', fontWeight: 500, cursor: 'pointer', opacity: salvando ? .6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <CheckIcon size={13} /> {salvando ? 'Salvando...' : 'Marcar etapa como concluída'}
                </button>
              </div>
            )}
          </div>

          {/* Histórico cronológico */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: .4 }}>Histórico</div>
            {carregando && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Carregando...</div>}
            {!carregando && historico.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Sem eventos registrados ainda.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historico.map((h) => (
                <div key={h.id} style={{ display: 'flex', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text1)' }}>{h.descricao}</div>
                    {h.observacao && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{h.observacao}</div>}
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                      {new Date(h.created_at).toLocaleString('pt-BR')}{h.autor ? ` · ${h.autor}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {obrigacao.task_id && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            <button onClick={() => onAbrirTarefa(obrigacao.task_id)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px', fontSize: 12, color: 'var(--text2)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ExternalLinkIcon size={13} /> Abrir tarefa no Kanban
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
