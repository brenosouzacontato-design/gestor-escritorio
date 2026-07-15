import EtapaDot from './EtapaDot';
import { statusVisualEtapa } from './andamentoApi';

// Trilha horizontal por obrigação: pontos conectados por uma linha, com
// preenchimento proporcional ao progresso (etapas concluídas).
export default function DepartamentoTimeline({ obrigacao, onEtapaClick }) {
  const etapas = obrigacao.etapas_obrigacao || [];
  if (etapas.length === 0) return null;

  const concluidas = etapas.filter((e) => e.status === 'concluido').length;
  const atual = etapas.find((e) => e.status === 'em_andamento') || etapas[etapas.length - 1];
  const algumAtrasado = etapas.some((e) => statusVisualEtapa(e) === 'atrasado');

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {obrigacao.titulo}
        </span>
        <span style={{ fontSize: 10, color: algumAtrasado ? 'var(--danger)' : 'var(--text3)', fontWeight: 700, flexShrink: 0 }}>
          {algumAtrasado ? '⚠ ' : ''}{concluidas}/{etapas.length}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        {etapas.map((etapa, i) => (
          <div key={etapa.id} style={{ display: 'flex', alignItems: 'center', flex: i < etapas.length - 1 ? 1 : '0 0 auto' }}>
            <EtapaDot etapa={etapa} statusVisual={statusVisualEtapa(etapa)} onClick={() => onEtapaClick(etapa)} />
            {i < etapas.length - 1 && (
              <div style={{ flex: 1, height: 2, minWidth: 8, background: etapa.status === 'concluido' ? 'var(--navy)' : 'var(--border)' }} />
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 7 }}>
        {atual?.status === 'concluido' ? 'Concluída' : <>Etapa atual: <strong style={{ color: 'var(--text2)' }}>{atual?.nome}</strong></>}
      </div>
    </div>
  );
}
