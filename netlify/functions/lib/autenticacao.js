// netlify/functions/lib/autenticacao.js
//
// Quem está chamando a function (ver docs/seguranca-rls.md, seção 7):
//   - escritório: cabeçalho Authorization: Bearer <JWT do Supabase Auth>
//     (login de ComLogin.jsx) de um usuário ativo em escritorio_usuarios;
//   - cliente: cabeçalho x-painel-token com o clientes.painel_token;
//   - a própria aplicação (function chamando function): cabeçalho
//     x-segredo-interno, derivado da SUPABASE_SERVICE_KEY.
//
// Implantação em duas fases, controlada pela variável EXIGIR_AUTENTICACAO:
//   - desligada (padrão): quem não se identifica ainda passa, com aviso no
//     log, e o painel aceita o id do cliente dos links antigos. Assim o
//     deploy não quebra nada antes do banco (supabase-rls-01) e dos links
//     novos estarem prontos;
//   - EXIGIR_AUTENTICACAO=1: só passa quem se identifica. Ligar junto com o
//     passo 2 do RLS (supabase-rls-02-ativar.sql).

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function modoEstrito() {
  return process.env.EXIGIR_AUTENTICACAO === '1'
}

function cabecalho(event, nome) {
  const headers = event.headers || {}
  const alvo = nome.toLowerCase()
  const chave = Object.keys(headers).find((k) => k.toLowerCase() === alvo)
  return chave ? headers[chave] : undefined
}

function iguais(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

// Tabela/coluna que ainda não existe no banco (script do RLS não rodado).
function objetoAusente(error) {
  return !!error && ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code)
}

// ---------- escritório ----------

async function usuarioEscritorio(event) {
  const jwt = String(cabecalho(event, 'authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return null
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) return null

  const { data: vinculo, error: errVinculo } = await supabase
    .from('escritorio_usuarios').select('user_id').eq('user_id', data.user.id).eq('ativo', true).maybeSingle()
  // Antes do supabase-rls-01 a tabela não existe: o login (só o dono, sem
  // cadastro público) já basta.
  if (objetoAusente(errVinculo)) return data.user
  if (errVinculo) {
    console.error('autenticacao: falha ao ler escritorio_usuarios:', errVinculo.message)
    return null
  }
  return vinculo ? data.user : null
}

// ---------- cliente (painel) ----------

// Cliente dono do x-painel-token. `idLegado` = id que veio no corpo/URL dos
// links antigos; só é aceito fora do modo estrito.
async function clienteDoPainel(event, idLegado = null) {
  const token = cabecalho(event, 'x-painel-token')
  if (token) {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('painel_token', token).maybeSingle()
    if (data) return data
    if (error && !objetoAusente(error)) console.error('autenticacao: falha ao ler painel_token:', error.message)
  }
  if (modoEstrito()) return null
  const id = UUID.test(idLegado || '') ? idLegado : (UUID.test(token || '') ? token : null)
  if (!id) return null
  const { data } = await supabase.from('clientes').select('id, nome').eq('id', id).maybeSingle()
  return data || null
}

// ---------- chamadas internas ----------

function segredoInterno() {
  return crypto.createHash('sha256').update(`${process.env.SUPABASE_SERVICE_KEY}:gestor-interno`).digest('hex')
}

function cabecalhoInterno() {
  return { 'x-segredo-interno': segredoInterno() }
}

function chamadaInterna(event) {
  return iguais(cabecalho(event, 'x-segredo-interno'), segredoInterno())
}

// ---------- guardas usadas pelas functions ----------
// Devolvem null quando pode seguir, ou a resposta 401 pra function devolver:
//   const negado = await exigirEscritorio(event, 'minha-function')
//   if (negado) return negado

function negar(nomeFunction, motivo, headersExtras = {}) {
  console.warn(`${nomeFunction}: acesso negado (${motivo})`)
  return {
    statusCode: 401,
    headers: { 'content-type': 'application/json', ...headersExtras },
    body: JSON.stringify({ error: 'Acesso não autorizado. Entre de novo no sistema e tente outra vez.' }),
  }
}

function tolerar(nomeFunction, motivo, headersExtras) {
  if (modoEstrito()) return negar(nomeFunction, motivo, headersExtras)
  console.warn(`${nomeFunction}: ${motivo} — aceito porque EXIGIR_AUTENTICACAO não está ligado`)
  return null
}

async function exigirEscritorio(event, nomeFunction, { headersExtras = {} } = {}) {
  if (chamadaInterna(event)) return null
  if (await usuarioEscritorio(event)) return null
  return tolerar(nomeFunction, 'chamada sem login do escritório', headersExtras)
}

module.exports = {
  modoEstrito,
  cabecalho,
  usuarioEscritorio,
  clienteDoPainel,
  cabecalhoInterno,
  chamadaInterna,
  exigirEscritorio,
  negar,
}
