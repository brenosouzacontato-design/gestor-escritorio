// Central de Mensagens (lib/filaMensagens.js): o cron de honorários só põe a
// cobrança na fila aguardando aprovação; o envio só pega as aprovadas.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// WhatsApp de mentira (antes de carregar a fila)
const enviados = []
const caminhoWhats = require.resolve(path.join(__dirname, '..', 'whatsapp'))
require.cache[caminhoWhats] = {
  id: caminhoWhats, filename: caminhoWhats, loaded: true,
  exports: { enviarMensagem: async (numero, texto) => { enviados.push({ numero, texto }); return numero === '5511900000000' ? { sucesso: false, erro: 'número sem WhatsApp' } : { sucesso: true } } },
}
const { enviarFila, enfileirarCobrancasHonorario } = require('../filaMensagens')

const HONORARIO = {
  id: 'hon-1', competencia: '10/2026', tipo: 'mensal', valor: 350, vencimento: '2026-11-10', status: 'pendente',
  clientes: { nome: '12.345.678 EMPRESA TESTE LTDA', telefone: '(11) 98888-7777' },
}

function supabaseFalso({ fila = [], modelo = null } = {}) {
  const gravado = { updates: [], inserts: [], filtros: [] }
  const from = (tabela) => {
    const estado = { tabela, op: 'select', valores: null }
    const resultado = () => {
      if (estado.op === 'update') {
        gravado.updates.push({ tabela, valores: estado.valores })
        if (tabela === 'mensagens_fila' && estado.valores.status === 'enviando') return { data: fila, error: null }
        return { data: [], error: null }
      }
      if (estado.op === 'insert') { gravado.inserts.push({ tabela, valores: estado.valores }); return { data: null, error: null } }
      if (tabela === 'honorarios') return { data: estado.single ? HONORARIO : [{ id: 'hon-1', cliente_id: 'cli-1' }], error: null }
      if (tabela === 'configuracoes') return { data: [{ chave: 'honorarios_pix_chave', valor: 'pix@escritorio.com' }], error: null }
      if (tabela === 'mensagens_modelos') return { data: modelo, error: null }
      if (tabela === 'mensagens_fila') return { data: [], error: null }
      return { data: [], error: null }
    }
    const q = new Proxy({}, {
      get: (_, k) => {
        if (k === 'then') return (ok, erro) => Promise.resolve(resultado()).then(ok, erro)
        if (k === 'update' || k === 'insert') return (v) => { estado.op = k; estado.valores = v; return q }
        if (k === 'single' || k === 'maybeSingle') return () => { estado.single = true; return Promise.resolve(resultado()) }
        return (...args) => { gravado.filtros.push({ tabela, k, args }); return q }
      },
    })
    return q
  }
  return { gravado, from }
}

test('cron de honorários: cobrança vencida entra na fila aguardando aprovação, sem enviar', async () => {
  enviados.length = 0
  const sb = supabaseFalso()
  const r = await enfileirarCobrancasHonorario(sb, { hoje: '2026-11-16' })
  assert.equal(r.enfileiradas, 1)
  assert.equal(enviados.length, 0)
  const ins = sb.gravado.inserts.find((i) => i.tabela === 'mensagens_fila').valores
  assert.equal(ins.status, 'aguardando_aprovacao')
  assert.equal(ins.origem, 'honorarios-cron')
  assert.equal(ins.honorario_id, 'hon-1')
  assert.equal(ins.telefone, '5511988887777')
  assert.match(ins.texto, /Olá, EMPRESA TESTE LTDA! O honorário de 10\/2026 no valor de R\$\s?350,00 venceu em 10\/11\/2026/)
  assert.doesNotMatch(ins.texto, /👤/) // favorecido vazio: a linha some
  assert.ok(!sb.gravado.updates.some((u) => u.tabela === 'honorarios'))
})

test('cron de honorários usa o modelo personalizado da Central', async () => {
  const sb = supabaseFalso({ modelo: { id: 'mod-1', texto: 'Oi {nome}, falta o {referencia} ({valor}). PIX {pix_chave}', ativo: true } })
  await enfileirarCobrancasHonorario(sb, { hoje: '2026-11-16' })
  const ins = sb.gravado.inserts.find((i) => i.tabela === 'mensagens_fila').valores
  assert.equal(ins.modelo_id, 'mod-1')
  assert.match(ins.texto, /^Oi EMPRESA TESTE LTDA, falta o honorário de 10\/2026 \(R\$\s?350,00\)\. PIX pix@escritorio\.com$/)
})

test('envio: só reivindica aprovadas; marca enviada, erro e o lembrete do honorário', async () => {
  enviados.length = 0
  const sb = supabaseFalso({ fila: [
    { id: 'm1', telefone: '5511988887777', texto: 'a', honorario_id: 'hon-1' },
    { id: 'm2', telefone: '5511900000000', texto: 'b', honorario_id: null },
    { id: 'm3', telefone: null, texto: 'c', honorario_id: null },
  ] })
  const r = await enviarFila(sb, { ids: ['m1', 'm2', 'm3'] })
  assert.equal(r.enviadas, 1)
  assert.equal(r.erros.length, 2)
  assert.equal(enviados.length, 2) // sem telefone nem tenta
  assert.ok(sb.gravado.filtros.some((f) => f.tabela === 'mensagens_fila' && f.k === 'eq' && f.args[0] === 'status' && f.args[1] === 'aprovada'))
  const status = sb.gravado.updates.filter((u) => u.tabela === 'mensagens_fila').map((u) => u.valores.status)
  assert.deepEqual(status, ['enviando', 'enviada', 'erro', 'erro'])
  assert.ok(sb.gravado.updates.find((u) => u.tabela === 'honorarios').valores.lembrete_enviado_em)
})
