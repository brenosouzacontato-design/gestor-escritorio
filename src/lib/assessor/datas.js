// Datas do Assessor: tudo em 'YYYY-MM-DD' (texto), comparado em dias UTC,
// para não depender do fuso do navegador nem do horário.

export function isoDia(d) {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 10)
}

function diaUTC(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}

// Dias de `de` até `ate` (positivo = no futuro).
export function diasEntre(de, ate) {
  const a = isoDia(de)
  const b = isoDia(ate)
  if (!a || !b) return null
  return Math.round((diaUTC(b) - diaUTC(a)) / 86400000)
}

export function dataBR(iso) {
  const s = isoDia(iso)
  if (!s) return ''
  const [a, m, d] = s.split('-')
  return `${d}/${m}/${a}`
}

export function entre(hoje, inicio, fim) {
  const h = isoDia(hoje)
  return (!inicio || h >= inicio) && (!fim || h <= fim)
}
