const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

const { cifrar, decifrar } = require('../cofre')
const { exigirUsuario, ErroHttp } = require('../auth')

const CHAVE = crypto.randomBytes(32).toString('base64')

test('cofre: cifra e decifra; outra chave ou dado adulterado falham', () => {
  const pfx = crypto.randomBytes(3000)
  const c1 = cifrar(pfx, CHAVE)
  assert.ok(!c1.includes(pfx.toString('base64').slice(0, 40)))
  assert.deepEqual(decifrar(c1, CHAVE), pfx)
  assert.notEqual(cifrar(pfx, CHAVE), c1) // IV aleatório
  assert.throws(() => decifrar(c1, crypto.randomBytes(32).toString('base64')))
  const adulterado = Buffer.from(c1, 'base64'); adulterado[40] ^= 1
  assert.throws(() => decifrar(adulterado.toString('base64'), CHAVE))
  assert.throws(() => cifrar(pfx, 'curta'), /NFSE_CERT_KEY/)
})

function supabaseFalso(usuario) {
  return { auth: { getUser: async (t) => (t === 'valido' ? { data: { user: usuario }, error: null } : { data: null, error: new Error('jwt') }) } }
}

test('auth: sem token, token inválido, e-mail fora da lista', async () => {
  const supabase = supabaseFalso({ id: '1', email: 'Dono@Escritorio.com' })
  await assert.rejects(exigirUsuario({ headers: {} }, { supabase }), (e) => e instanceof ErroHttp && e.status === 401)
  await assert.rejects(exigirUsuario({ headers: { authorization: 'Bearer x' } }, { supabase }), (e) => e.status === 401)
  const u = await exigirUsuario({ headers: { authorization: 'Bearer valido' } }, { supabase })
  assert.equal(u.id, '1')
  process.env.NFSE_EMAILS_PERMITIDOS = 'outro@escritorio.com'
  await assert.rejects(exigirUsuario({ headers: { authorization: 'Bearer valido' } }, { supabase }), (e) => e.status === 403)
  process.env.NFSE_EMAILS_PERMITIDOS = 'dono@escritorio.com, outro@escritorio.com'
  assert.equal((await exigirUsuario({ headers: { Authorization: 'Bearer valido' } }, { supabase })).id, '1')
  delete process.env.NFSE_EMAILS_PERMITIDOS
})
