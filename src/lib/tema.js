// Temas do gestor: claro, cinza médio (meio-termo) e escuro.
// A chave nova 'tema' começa no cinza médio pra todo mundo; a antiga
// 'theme' (claro/escuro) é ignorada de propósito, senão quem já tinha
// aberto o gestor nunca veria o visual novo. O botão do topo troca entre os três.
const TEMAS = ['light', 'cinza', 'dark']
export const TEMA_LABEL = { light: 'claro', cinza: 'cinza médio', dark: 'escuro' }

export function temaInicial() {
  try {
    const salvo = localStorage.getItem('tema')
    if (TEMAS.includes(salvo)) return salvo
  } catch { /* sem localStorage */ }
  return 'cinza'
}

export function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema)
}

export function salvarTema(tema) {
  aplicarTema(tema)
  try { localStorage.setItem('tema', tema) } catch { /* sem localStorage */ }
}

export function proximoTema(atual) {
  return TEMAS[(TEMAS.indexOf(atual) + 1) % TEMAS.length]
}
