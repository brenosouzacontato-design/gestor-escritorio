import React, { useState, useRef, useEffect, useMemo } from 'react';

// remove acentos e caixa pra busca não exigir digitar certinho
function normalizar(texto) {
  return (texto || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

// Select de empresa com filtro por nome/CNPJ ao digitar — mesmo padrão do
// ContaCombobox (src/pages/contabil/ContaCombobox.jsx). Com dezenas de
// clientes, muitos com CNPJ como prefixo do nome (herança da sincronização
// OneFlow), um <select> nativo em ordem alfabética crua é difícil de
// escanear — aqui dá pra digitar parte do nome ou o CNPJ direto.
export default function EmpresaCombobox({ empresas, value, onChange, placeholder = 'Buscar empresa...', disabled = false, style }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  const wrapperRef = useRef(null);

  const empresaSelecionada = empresas.find((e) => e.id === value) ?? null;

  const filtradas = useMemo(() => {
    const termo = normalizar(busca);
    if (!termo) return empresas.slice(0, 40);
    return empresas
      .filter((e) => normalizar(`${e.nome} ${e.cnpj || ''}`).includes(termo))
      .slice(0, 40);
  }, [empresas, busca]);

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

  function escolher(empresa) {
    onChange(empresa.id);
    setAberto(false);
    setBusca('');
  }

  function onKeyDown(e) {
    if (!aberto) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setDestaque((i) => Math.min(i + 1, filtradas.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setDestaque((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtradas[destaque]) escolher(filtradas[destaque]); }
    else if (e.key === 'Escape') { setAberto(false); setBusca(''); }
    else if (e.key === 'Tab' && busca && filtradas[destaque]) { escolher(filtradas[destaque]); }
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        disabled={disabled}
        value={aberto ? busca : (empresaSelecionada ? empresaSelecionada.nome : '')}
        placeholder={placeholder}
        onFocus={() => { setAberto(true); setBusca(''); setDestaque(0); }}
        onChange={(e) => { setBusca(e.target.value); setDestaque(0); }}
        onKeyDown={onKeyDown}
        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.85rem',
          background: 'var(--surface)', color: 'var(--text1)' }}
      />
      {aberto && (
        <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          maxHeight: 300, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
          {filtradas.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: '0.8rem', color: 'var(--text2)' }}>Nenhuma empresa encontrada</div>
          )}
          {filtradas.map((e, i) => (
            <div key={e.id}
              onMouseDown={(ev) => { ev.preventDefault(); escolher(e); }}
              onMouseEnter={() => setDestaque(i)}
              style={{ padding: '6px 10px', fontSize: '0.82rem', cursor: 'pointer',
                background: i === destaque ? 'var(--surface2)' : 'transparent',
                color: e.id === value ? 'var(--accent)' : 'var(--text1)', fontWeight: e.id === value ? 700 : 400 }}>
              {e.nome}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
