import { useState, useEffect } from 'react';
import { XIcon, CheckIcon, ExternalLinkIcon, ClockIcon } from 'lucide-react';
import { listarHistoricoObrigacao, concluirEtapa } from './andamentoApi';

const STATUS_LABEL = { concluido: 'Concluído', em_andamento: 'Em andamento', pendente: 'Pendente', atrasado: 'Atrasado' };
const STATUS_COLOR = {
  concluido:    { bg: 'rgba(27,43,75,.10)', fg: 'var(--navy)' },
  em_andamento: { bg: 'var(--accent-dim)',  fg: 'var(--accent)' },
  pendente:     { bg: 'var(--surface2)',    fg: 'var(--text3)' },
  atrasado:     { bg: 'var(--danger-dim)',  fg: 'var(--danger)' },
};

// Legado (checklist mensal) usa vocabulário próprio pra status —
// mapeado aqui só pro <select> de edição direta.
const STATUS_OBS = ['pendente', 'concluido', 'nao_aplica', 'vencido'];
const STATUS_OBS_LABEL = { pendente: 'Pendente', concluido: 'Concluído', nao_aplica: 'N/A', vencido: 'Vencido' };

// Abre ao clicar num ponto da trilha. "processo" (obrigação com etapas de
// verdade) mostra histórico cronológico + marcar etapa concluída + abrir
// tarefa. "legacy" (item do checklist mensal, sem conceito de etapas) mostra
// um resumo simples com edição direta de status, sem histórico.
export default function HistoricoObrigacaoModal({ stage, titulo, clienteNome, departamentoNome, onClose, onAtualizado, onAbrirTarefa, onChangeLegacyStatus }) {
  const isProcesso = stage.kind === 'processo';
  const etapa = stage.raw;

  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(isProcesso);
  const [observacao, setObservacao] = useState('');
  const [responsavel, setResponsavel] = useState(isProcesso ? (etapa.responsavel || '') : '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!isProcesso) return;
    let vivo = true;
    listarHistoricoObrigacao(etapa.obrigacao_id)
      .then((h) => { if (vivo) setHistorico(h); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [isProcesso, etapa?.obrigacao_id]);

  const podeMarcarConcluida = isProcesso && etapa.status === 'em_andamento';
  const taskId = isProcesso ? stage.obrigacaoRef?.task_id : stage.raw?.task_id;

  const handleConcluir = async () => {
    setSalvando(true);
    try {
      await concluirEtapa(etapa, { responsavel: responsavel.trim() || undefined, observacao: observacao.trim() || undefined });
      onAtualizado();
    } finally {
      setSalvando(false);
    }
  };

  const handleStatusLegado = async (novoStatus) => {
    setSalvando(true);
    try {
      await onChangeLegacyStatus(stage.raw.id, novoStatus);
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
                {titulo}
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

          {/* Etapa / item clicado */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{stage.nome}</span>
              <span style={{ background: STATUS_COLOR[stage.statusVisual].bg, color: STATUS_COLOR[stage.statusVisual].fg, borderRadius: 99, padding: '3px 9px', fontSize: 10, fontWeight: 700 }}>
                {STATUS_LABEL[stage.statusVisual]}
              </span>
            </div>

            {isProcesso ? <>
              {etapa.data_prevista && (
                <div style={{ fontSize: 11, color: stage.statusVisual === 'atrasado' ? 'var(--danger)' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
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
            </> : <>
              {/* Checklist legado: sem conceito de etapas — edita status direto */}
              {stage.raw.vencimento && (
                <div style={{ fontSize: 11, color: stage.raw.status === 'vencido' ? 'var(--danger)' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ClockIcon size={11} /> Venc. {new Date(stage.raw.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}
                </div>
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <label style={{ fontSize: 11, color: 'var(--text2)', display: 'block', marginBottom: 4 }}>Alterar status</label>
                <select value={stage.raw.status || 'pendente'} disabled={salvando} onChange={(e) => handleStatusLegado(e.target.value)}
                  style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text1)', outline: 'none' }}>
                  {STATUS_OBS.map((s) => <option key={s} value={s}>{STATUS_OBS_LABEL[s]}</option>)}
                </select>
              </div>
            </>}
          </div>

          {/* Histórico cronológico — só existe pra processos com etapas */}
          {isProcesso && (
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
          )}
        </div>

        {taskId && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            <button onClick={() => onAbrirTarefa(taskId)}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px', fontSize: 12, color: 'var(--text2)', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ExternalLinkIcon size={13} /> Abrir tarefa no Kanban
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
