import React, { useState, useRef, useEffect, useMemo } from 'react';

// remove acentos e caixa pra busca não exigir digitar "Serviços" certinho
function normalizar(texto) {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

// Select de conta com filtro por texto ao digitar — com centenas de contas
// por empresa, um <select> nativo fica inviável de navegar.
export default function ContaCombobox({ contas, value, onChange, placeholder = 'Buscar conta...', excluirCodigos = [], disabled = false, style }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const wrapperRef = useRef(null);

  const contasVisiveis = useMemo(
    () => contas.filter((c) => !excluirCodigos.includes(c.codigo)),
    [contas, excluirCodigos]
  );

  const contaSelecionada = contasVisiveis.find((c) => c.id === value) ?? null;

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return contasVisiveis.slice(0, 40);
    return contasVisiveis
      .filter((c) => normalizar(`${c.codigo} ${c.nome}`).includes(termo))
      .slice(0, 40);
  }, [contasVisiveis, busca]);

  useEffect(() => {
    function onClickFora(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setAberto(false);
        setBusca('');
      }
    }
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  function escolher(conta) {
    onChange(conta.id);
    setAberto(false);
    setBusca('');
  }

  function onKeyDown(e) {
    if (!aberto) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((i) => Math.min(i + 1, filtradas.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtradas[destaque]) escolher(filtradas[destaque]); }
    else if (e.key === 'Escape') { setAberto(false); setBusca(''); }
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        disabled={disabled}
        value={aberto ? busca : (contaSelecionada ? `${contaSelecionada.codigo} - ${contaSelecionada.nome}` : '')}
        placeholder={placeholder}
        onFocus={() => { setAberto(true); setBusca(''); setDestaque(0); }}
        onChange={(e) => { setBusca(e.target.value); setDestaque(0); }}
        onKeyDown={onKeyDown}
        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.85rem' }}
      />
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          maxHeight: 260, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
          {filtradas.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: '0.8rem', color: 'var(--text2)' }}>Nenhuma conta encontrada</div>
          )}
          {filtradas.map((c, i) => (
            <div key={c.id}
              onMouseDown={(e) => { e.preventDefault(); escolher(c); }}
              onMouseEnter={() => setDestaque(i)}
              style={{ padding: '6px 10px', fontSize: '0.82rem', cursor: 'pointer',
                background: i === destaque ? 'var(--surface2)' : 'transparent',
                color: c.id === value ? 'var(--accent)' : 'var(--text1)', fontWeight: c.id === value ? 700 : 400 }}>
              {c.codigo} - {c.nome}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
