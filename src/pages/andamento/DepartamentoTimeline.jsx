import EtapaDot from './EtapaDot';

// Trilha horizontal de uma obrigação (processo com etapas, checklist mensal
// legado tratado como pseudo-etapas, ou estado vazio) — pontos conectados por
// uma linha, preenchida até a etapa atual, com rótulo embaixo de cada ponto.
// Layout espelha o mockup: dept-label fixo à esquerda + trilha ocupando o
// resto da largura.
export default function DepartamentoTimeline({ trilha, onStageClick }) {
  const { stages, kind } = trilha;
  if (!stages || stages.length === 0) return null;

  const idxAtual = stages.findIndex((s) => s.statusVisual === 'em_andamento' || s.statusVisual === 'atrasado');
  const todasConcluidas = stages.every((s) => s.statusVisual === 'concluido');
  const fillPct = stages.length > 1
    ? (idxAtual >= 0 ? (idxAtual / (stages.length - 1)) * 100 : (todasConcluidas ? 100 : 0))
    : 0;

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', minHeight: 46 }}>
      {stages.length > 1 && (
        <>
          <div style={{ position: 'absolute', left: 12, right: 12, top: 16, height: 2, background: 'var(--border)' }} />
          <div style={{ position: 'absolute', left: 12, top: 16, height: 2, width: `${fillPct}%`, background: 'var(--navy)' }} />
        </>
      )}
      <div style={{ display: 'flex', justifyContent: stages.length > 1 ? 'space-between' : 'flex-start', width: '100%', position: 'relative', zIndex: 1 }}>
        {stages.map((stage, i) => {
          const clicavel = kind !== 'empty' && !!onStageClick;
          const ativo = stage.statusVisual === 'em_andamento' || stage.statusVisual === 'atrasado';
          return (
            <div key={stage.key}
              onClick={() => clicavel && onStageClick(stage)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 92, cursor: clicavel ? 'pointer' : 'default' }}
              onMouseEnter={(e) => { if (clicavel) e.currentTarget.firstChild.style.transform = 'scale(1.15)'; }}
              onMouseLeave={(e) => { if (clicavel) e.currentTarget.firstChild.style.transform = 'scale(1)'; }}>
              <EtapaDot stage={stage} numero={i + 1} />
              <span style={{
                fontSize: 9.5, marginTop: 5, textAlign: 'center', lineHeight: 1.25, fontWeight: 600,
                color: ativo ? 'var(--text1)' : 'var(--text3)',
                overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {stage.nome}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
