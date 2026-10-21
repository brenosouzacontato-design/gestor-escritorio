// Identificação do aparelho que abre o painel do cliente, pro relatório de
// acessos (RelatorioAcessosPainel.jsx).
//
// - idAparelho(): identificador anônimo e aleatório, guardado no próprio
//   navegador (localStorage) na primeira visita. O mesmo celular abrindo o
//   painel várias vezes manda sempre o mesmo id — é isso que permite dizer
//   "2 aparelhos diferentes abriram". Não é impressão digital do aparelho nem
//   identifica a pessoa: limpar os dados do navegador ou abrir em aba anônima
//   gera um id novo.
// - descreverAparelho(userAgent): "iPhone · Safari", "Android · Chrome",
//   "Windows · Edge"... a partir do user agent que o navegador manda.

const CHAVE = 'painel-aparelho-id';

export function idAparelho() {
  try {
    let id = localStorage.getItem(CHAVE);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 24);
      localStorage.setItem(CHAVE, id);
    }
    return id;
  } catch {
    return null; // navegador sem localStorage (aba anônima restrita etc.)
  }
}

export function descreverAparelho(userAgent) {
  const ua = userAgent || '';
  if (!ua) return { tipo: 'desconhecido', sistema: null, navegador: null, nome: 'Aparelho não identificado' };

  let sistema = null;
  let tipo = 'computador';
  if (/iPhone/i.test(ua)) { sistema = 'iPhone'; tipo = 'celular'; }
  else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) { sistema = 'iPad'; tipo = 'tablet'; }
  else if (/Android/i.test(ua)) { sistema = 'Android'; tipo = /Mobile/i.test(ua) ? 'celular' : 'tablet'; }
  else if (/Windows/i.test(ua)) sistema = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) sistema = 'Mac';
  else if (/CrOS/i.test(ua)) sistema = 'Chromebook';
  else if (/Linux/i.test(ua)) sistema = 'Linux';

  // ordem importa: Edge/Opera/Samsung também dizem "Chrome"; Chrome diz "Safari"
  let navegador = null;
  if (/WhatsApp/i.test(ua)) navegador = 'WhatsApp';
  else if (/Instagram/i.test(ua)) navegador = 'Instagram';
  else if (/FBAN|FBAV/i.test(ua)) navegador = 'Facebook';
  else if (/EdgA?\//i.test(ua)) navegador = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) navegador = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) navegador = 'Samsung Internet';
  else if (/Firefox|FxiOS/i.test(ua)) navegador = 'Firefox';
  else if (/Chrome|CriOS/i.test(ua)) navegador = 'Chrome';
  else if (/Safari/i.test(ua)) navegador = 'Safari';

  const nome = [sistema, navegador].filter(Boolean).join(' · ') || 'Navegador desconhecido';
  return { tipo, sistema, navegador, nome };
}
