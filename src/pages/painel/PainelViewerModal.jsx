import { useEffect, useRef, useState } from 'react';
import { XIcon, ChevronLeftIcon, ChevronRightIcon, Share2Icon } from 'lucide-react';
import PainelClientePage from './PainelClientePage';

// Visualizador interno do painel do cliente — em vez de abrir uma aba nova
// por empresa (como "Visualizar painel" fazia antes), abre um overlay
// dentro do próprio app que deixa ir "passando pro lado" entre os painéis
// das empresas atualmente na tela (mesma ordem/filtro do Empresas.jsx),
// sem precisar voltar pra lista a cada uma. `clientes` já vem na ordem
// certa (lista filtrada/ordenada de quem chamou), `indiceInicial` é a
// empresa em que o usuário clicou.
export default function PainelViewerModal({ clientes, indiceInicial, competencia, onClose }) {
  const [indice, setIndice] = useState(indiceInicial);
  const touchInicio = useRef(null);

  const total = clientes.length;
  const clienteAtual = clientes[indice];

  const irPara = (novoIndice) => setIndice(((novoIndice % total) + total) % total); // wrap-around
  const anterior = () => irPara(indice - 1);
  const proximo = () => irPara(indice + 1);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowLeft') anterior();
      else if (e.key === 'ArrowRight') proximo();
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [indice]);

  const onTouchStart = (e) => { touchInicio.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchInicio.current == null) return;
    const delta = e.changedTouches[0].clientX - touchInicio.current;
    touchInicio.current = null;
    if (delta > 60) anterior();
    else if (delta < -60) proximo();
  };

  const compartilhar = () => {
    const link = `${window.location.origin}${window.location.pathname}?painel=${clienteAtual.id}&competencia=${encodeURIComponent(competencia)}`;
    const mensagem = `Olá! Segue o painel de ${clienteAtual.nome} — competência ${competencia} — com obrigações, financeiro e demais informações:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(mensagem)}`, '_blank');
  };

  if (!clienteAtual) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 2000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--navy)', flexShrink: 0 }}>
        <button onClick={onClose} title="Fechar (Esc)"
          style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, width: 30, height: 30, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
          <XIcon size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clienteAtual.nome}</div>
          <div style={{ fontSize: 10.5, color: 'var(--navy-text)' }}>{indice + 1} de {total} · use as setas ou arraste pro lado</div>
        </div>
        <button onClick={anterior} title="Empresa anterior (←)"
          style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, width: 30, height: 30, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
          <ChevronLeftIcon size={16} />
        </button>
        <button onClick={proximo} title="Próxima empresa (→)"
          style={{ background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8, width: 30, height: 30, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
          <ChevronRightIcon size={16} />
        </button>
        <button onClick={compartilhar} title="Compartilhar esse painel via WhatsApp"
          style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0 12px', height: 30, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
          <Share2Icon size={13} /> Compartilhar
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <PainelClientePage key={clienteAtual.id} clienteId={clienteAtual.id} competencia={competencia} />
      </div>
    </div>
  );
}
