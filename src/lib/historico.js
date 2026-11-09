import { useCallback, useEffect, useRef, useState } from 'react';

// Estado de "qual tela está aberta" guardado no histórico do navegador: cada
// troca de tela vira uma entrada nova (pushState), então o botão voltar do
// navegador / do celular volta pra tela anterior em vez de sair do app.
// O valor fica em history.state[chave] — sobrevive a um F5 na mesma aba.
// `paramsUrl(valor)` (opcional) devolve { param: valor|null } pra também
// refletir a tela na URL (link copiado abre no mesmo lugar).
export function useTelaNoHistorico(chave, inicial, { paramsUrl = null } = {}) {
  const [valor, setValor] = useState(() => {
    const salvo = window.history.state?.[chave];
    return salvo !== undefined ? salvo : inicial;
  });
  const atual = useRef(valor);
  const inicialRef = useRef(inicial);
  const paramsRef = useRef(paramsUrl);
  paramsRef.current = paramsUrl;

  const montarUrl = (v) => {
    if (!paramsRef.current) return window.location.href;
    const url = new URL(window.location.href);
    Object.entries(paramsRef.current(v) || {}).forEach(([k, p]) => {
      if (p == null || p === '') url.searchParams.delete(k); else url.searchParams.set(k, p);
    });
    return url.toString();
  };

  // marca a entrada atual do histórico com a tela inicial
  useEffect(() => {
    if (!ativo) return;
    window.history.replaceState({ ...(window.history.state || {}), [chave]: atual.current }, '', montarUrl(atual.current));
  }, [chave, ativo]);

  useEffect(() => {
    if (!ativo) return undefined;
    const aoVoltar = (e) => {
      const salvo = e.state?.[chave];
      const v = salvo !== undefined ? salvo : inicialRef.current;
      atual.current = v;
      setValor(v);
    };
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [chave, ativo]);

  const navegar = useCallback((novo) => {
    const v = typeof novo === 'function' ? novo(atual.current) : novo;
    if (JSON.stringify(v) === JSON.stringify(atual.current)) return;
    atual.current = v;
    if (!ativo) { setValor(v); return; }
    window.history.pushState({ ...(window.history.state || {}), [chave]: v }, '', montarUrl(v));
    setValor(v);
    window.scrollTo(0, 0);
  }, [chave, ativo]);

  return [valor, navegar];
}
