// netlify/functions/lib/aparelho.js
//
// "iPhone · Safari", "Android · Chrome"... a partir do user agent — mesma
// lógica de src/pages/painel/aparelho.js (o front é ES module e as functions
// são CommonJS, por isso a cópia). Usado no aviso do WhatsApp do painel-evento.

function descreverAparelho(userAgent) {
  const ua = userAgent || ''
  if (!ua) return null
  let sistema = null
  if (/iPhone/i.test(ua)) sistema = 'iPhone'
  else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) sistema = 'iPad'
  else if (/Android/i.test(ua)) sistema = 'Android'
  else if (/Windows/i.test(ua)) sistema = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(ua)) sistema = 'Mac'
  else if (/CrOS/i.test(ua)) sistema = 'Chromebook'
  else if (/Linux/i.test(ua)) sistema = 'Linux'

  let navegador = null
  if (/WhatsApp/i.test(ua)) navegador = 'WhatsApp'
  else if (/Instagram/i.test(ua)) navegador = 'Instagram'
  else if (/FBAN|FBAV/i.test(ua)) navegador = 'Facebook'
  else if (/EdgA?\//i.test(ua)) navegador = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) navegador = 'Opera'
  else if (/SamsungBrowser/i.test(ua)) navegador = 'Samsung Internet'
  else if (/Firefox|FxiOS/i.test(ua)) navegador = 'Firefox'
  else if (/Chrome|CriOS/i.test(ua)) navegador = 'Chrome'
  else if (/Safari/i.test(ua)) navegador = 'Safari'

  return [sistema, navegador].filter(Boolean).join(' · ') || null
}

module.exports = { descreverAparelho }
