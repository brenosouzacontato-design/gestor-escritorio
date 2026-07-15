import { CheckIcon } from 'lucide-react';

// 4 variações visuais: concluído (navy preenchido, ✓), em andamento (contorno
// destacado accent), pendente (cinza), atrasado (terracota/danger).
const CFG = {
  concluido:    { bg: 'var(--navy)',     border: 'var(--navy)',    fg: '#fff' },
  em_andamento: { bg: 'var(--surface)',  border: 'var(--accent)',  fg: 'var(--accent)' },
  pendente:     { bg: 'var(--surface2)', border: 'var(--border2)', fg: 'var(--text3)' },
  atrasado:     { bg: 'var(--danger)',   border: 'var(--danger)',  fg: '#fff' },
};

export default function EtapaDot({ etapa, statusVisual, onClick, size = 26 }) {
  const cfg = CFG[statusVisual] || CFG.pendente;
  return (
    <button
      type="button"
      onClick={onClick}
      title={etapa.nome}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
        background: cfg.bg, border: `2px solid ${cfg.border}`, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform .12s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {statusVisual === 'concluido' && <CheckIcon size={Math.round(size * 0.55)} color={cfg.fg} strokeWidth={3} />}
      {statusVisual === 'em_andamento' && (
        <div style={{ width: Math.round(size * 0.4), height: Math.round(size * 0.4), borderRadius: '50%', background: cfg.border }} />
      )}
      {statusVisual === 'atrasado' && (
        <span style={{ fontSize: Math.round(size * 0.5), color: cfg.fg, fontWeight: 800, lineHeight: 1 }}>!</span>
      )}
    </button>
  );
}
