// Ponto individual de uma trilha: concluído (navy preenchido, ✓), em andamento
// (contorno destacado + halo), pendente (cinza, numerado), atrasado
// (terracota/danger, !). Puramente visual — quem decide se é clicável é o
// componente pai (DepartamentoTimeline).
const CFG = {
  concluido:    { bg: 'var(--navy)',     border: 'var(--navy)',    fg: '#fff',        borderWidth: 2 },
  em_andamento: { bg: 'var(--bg)',       border: 'var(--navy)',    fg: 'var(--navy)', borderWidth: 3 },
  pendente:     { bg: 'var(--surface2)', border: 'var(--border2)', fg: 'var(--text3)', borderWidth: 2 },
  atrasado:     { bg: 'var(--danger)',   border: 'var(--danger)',  fg: '#fff',        borderWidth: 2 },
};

export default function EtapaDot({ stage, numero, size = 24 }) {
  const cfg = CFG[stage.statusVisual] || CFG.pendente;
  const content = stage.statusVisual === 'concluido' ? '✓'
    : stage.statusVisual === 'atrasado' ? '!'
    : numero;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: cfg.bg, border: `${cfg.borderWidth}px solid ${cfg.border}`,
      color: cfg.fg, fontSize: 11, fontWeight: 700,
      boxShadow: stage.statusVisual === 'em_andamento' ? '0 0 0 4px var(--accent-dim)' : 'none',
      transition: 'transform .12s ease',
    }}>
      {content}
    </div>
  );
}
