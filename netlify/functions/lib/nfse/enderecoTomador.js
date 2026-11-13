// netlify/functions/lib/nfse/enderecoTomador.js
//
// Endereço do tomador na DPS (grupo toma/end, TCEndereco do leiaute nacional):
//   <end><endNac><cMun/><CEP/></endNac><xLgr/><nro/><xCpl/>?<xBairro/></end>
// Obrigatório quando o indicador da operação (cIndOp) ou a incidência do ISSQN cai no domicílio do
// tomador (E0234). A nota guarda o endereço em texto livre + CEP; aqui ele vira os campos da DPS:
//   - CEP: o da nota ou o que estiver no texto; município (IBGE), logradouro e bairro vêm do ViaCEP;
//   - número e complemento: do texto ("Rua Tal, 150, Sala 3, Centro"); sem número, "S/N";
//   - tomador CNPJ sem CEP utilizável: endereço do cadastro da Receita (BrasilAPI).
// Sem dados suficientes devolve null e a DPS sai sem endereço, como antes (a maioria das notas de
// pessoa física não precisa dele).

const soDigitos = (s) => String(s || '').replace(/\D/g, '')
const espacos = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const cortar = (s, n) => espacos(s).slice(0, n)

const RE_CEP = /\b(?:cep\s*[:.-]?\s*)?(\d{2}\.?\d{3}-?\d{3})\b/i
const RE_COMPLEMENTO = /^(sala|sl|salas|apto?|apartamento|bloco|bl|andar|conj(unto)?|cj|loja|lj|casa|lote|lt|quadra|qd|fundos|box|torre|edif[ií]cio|ed|galp[aã]o|km)\b/i
const RE_NUMERO = /^(?:n[º°o.]*\s*)?(\d+[a-z]?|s\/?n)$/i
const RE_UF = /^[A-Z]{2}$/

// "Rua Tal, 150, Sala 3, Centro, Belo Horizonte - MG, CEP 30100-000" →
// { cep, logradouro: 'Rua Tal', numero: '150', complemento: 'Sala 3', bairro: 'Centro' }
function separarEndereco(texto) {
  let t = espacos(texto)
  const r = { cep: '', logradouro: '', numero: '', complemento: '', bairro: '' }
  const m = t.match(RE_CEP)
  if (m) { r.cep = soDigitos(m[1]); t = t.replace(m[0], ' ') }
  const partes = t.split(/\s*[,;]\s*|\s+-\s+/).map(espacos).filter((p) => p && !/^cep$/i.test(p))
  if (!partes.length) return r

  let i = 1
  const primeira = partes[0].match(/^(.*?\D)\s+(?:n[º°o.]*\s*)?(\d+[a-z]?)$/i) // "Rua Tal 150"
  if (primeira && !RE_NUMERO.test(partes[1] || '')) {
    r.logradouro = primeira[1]
    r.numero = primeira[2]
  } else {
    r.logradouro = partes[0]
    const n = (partes[1] || '').match(RE_NUMERO)
    if (n) { r.numero = n[1]; i = 2 }
  }
  const complementos = []
  for (const p of partes.slice(i)) {
    if (RE_COMPLEMENTO.test(p)) complementos.push(p)
    else if (!r.bairro && !RE_UF.test(p) && !/\//.test(p)) r.bairro = p.replace(/^bairro\s*:?\s*/i, '')
  }
  r.complemento = complementos.join(', ')
  if (/^s\/?n$/i.test(r.numero)) r.numero = 'S/N'
  return r
}

async function buscarJson(url, ms = 6000) {
  const controle = new AbortController()
  const timer = setTimeout(() => controle.abort(), ms)
  try {
    const r = await fetch(url, { signal: controle.signal, headers: { accept: 'application/json' } })
    return r.ok ? await r.json() : null
  } catch { return null } finally { clearTimeout(timer) }
}

// ViaCEP: { cep, logradouro, bairro, localidade, uf, ibge } ou null
async function buscarCepViaCep(cep) {
  const d = await buscarJson(`https://viacep.com.br/ws/${soDigitos(cep)}/json/`)
  if (!d || d.erro || !/^\d{7}$/.test(String(d.ibge || ''))) return null
  return { cep: soDigitos(d.cep), logradouro: d.logradouro || '', bairro: d.bairro || '', ibge: String(d.ibge) }
}

// BrasilAPI (cadastro CNPJ da Receita): mesmo formato, mais número e complemento
async function buscarCnpjBrasilApi(cnpj) {
  const d = await buscarJson(`https://brasilapi.com.br/api/cnpj/v1/${soDigitos(cnpj)}`)
  if (!d || !/^\d{7}$/.test(String(d.codigo_municipio_ibge || ''))) return null
  const tipo = espacos(d.descricao_tipo_de_logradouro)
  const lgr = espacos(d.logradouro)
  return {
    cep: soDigitos(d.cep), ibge: String(d.codigo_municipio_ibge), bairro: d.bairro || '',
    logradouro: tipo && !lgr.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${lgr}` : lgr,
    numero: espacos(d.numero), complemento: espacos(d.complemento),
  }
}

const completo = (e) => e && /^\d{7}$/.test(e.cMun) && /^\d{8}$/.test(e.CEP) && e.xLgr && e.nro && e.xBairro

// Devolve { cMun, CEP, xLgr, nro, xCpl, xBairro } (limites do leiaute) ou null.
async function resolverEnderecoTomador({ endereco, cep, documento }, {
  buscarCep = buscarCepViaCep, buscarCnpj = buscarCnpjBrasilApi,
} = {}) {
  const texto = separarEndereco(endereco)
  const cepNota = soDigitos(cep).length === 8 ? soDigitos(cep) : texto.cep
  let e = null
  if (cepNota.length === 8 && (texto.logradouro || texto.numero)) {
    const c = await buscarCep(cepNota)
    if (c) {
      e = {
        cMun: c.ibge, CEP: cepNota,
        // CEP de logradouro: nome oficial; CEP geral da cidade: o que foi digitado
        xLgr: c.logradouro || texto.logradouro, nro: texto.numero || 'S/N',
        xCpl: texto.complemento, xBairro: c.bairro || texto.bairro,
      }
    }
  }
  if (!completo(e) && soDigitos(documento).length === 14) {
    const r = await buscarCnpj(documento)
    if (r) e = { cMun: r.ibge, CEP: r.cep, xLgr: r.logradouro, nro: r.numero || 'S/N', xCpl: r.complemento, xBairro: r.bairro }
  }
  if (!completo(e)) return null
  return {
    cMun: e.cMun, CEP: e.CEP, xLgr: cortar(e.xLgr, 255), nro: cortar(e.nro, 60),
    xCpl: cortar(e.xCpl, 156), xBairro: cortar(e.xBairro, 60),
  }
}

module.exports = { separarEndereco, resolverEnderecoTomador, buscarCepViaCep, buscarCnpjBrasilApi }
