// Temas do gestor, escolhidos no seletor do topo: Areia (claro quente),
// Cinza médio e Escuro. A escolha fica salva neste navegador (chave 'tema').
// Quem tinha 'light' salvo passa pra Areia, que substitui o claro antigo.
export const TEMAS = [
  { id: 'areia', nome: 'Areia',       desc: 'Claro e quente, menos brilho', amostra: ['#F3EFE7', '#2B2824'] },
  { id: 'cinza', nome: 'Cinza médio', desc: 'Meio-termo',                   amostra: ['#2B3241', '#3A4354'] },
  { id: 'dark',  nome: 'Escuro',      desc: 'Para pouca luz',               amostra: ['#0B0F17', '#1D2330'] },
]
const IDS = TEMAS.map(t => t.id)
const PADRAO = 'areia'

export function temaInicial() {
  try {
    const salvo = localStorage.getItem('tema')
    if (IDS.includes(salvo)) return salvo
    if (salvo === 'light') return 'areia'
  } catch { /* sem localStorage */ }
  return PADRAO
}

export function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema)
}

export function salvarTema(tema) {
  aplicarTema(tema)
  try { localStorage.setItem('tema', tema) } catch { /* sem localStorage */ }
}
