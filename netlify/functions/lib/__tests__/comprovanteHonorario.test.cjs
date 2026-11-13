// Comprovante do cliente pagando o honorário do escritório
// (lib/comprovantePagamento.js): a IA aponta o honorário e, com confiança
// alta e valor compatível, ele é marcado como pago com o comprovante.
const test = require('node:test')
const assert = require('node:assert/strict')
const { registrarComprovante } = require('../comprovantePagamento')

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const HONORARIO = { id: 'hon-1', competencia: '10/2026', valor: 350, vencimento: '2026-11-10', cliente_id: 'cli-1', clientes: { nome: 'Empresa Teste', cnpj: '11222333000181' } }

// Supabase de mentira: guarda o que foi gravado em cada tabela
function supabaseFalso({ colunasHonorario = true } = {}) {
  const gravado = { updates: [], inserts: [] }
  const from = (tabela) => {
    const estado = { tabela, op: 'select', valores: null }
    const resultado = () => {
      if (estado.op === 'update') {
        gravado.updates.push({ tabela, valores: estado.valores })
        if (tabela === 'honorarios' && !colunasHonorario && 'comprovante_path' in estado.valores) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'comprovante_path' column" } }
        }
        return { data: [{ id: 'ok' }], error: null }
      }
      if (estado.op === 'insert') {
        gravado.inserts.push({ tabela, valores: estado.valores })
        return { data: { id: 'comp-1' }, error: null }
      }
      if (tabela === 'honorarios') return { data: [HONORARIO], error: null }
      if (tabela === 'configuracoes') return { data: [{ chave: 'honorarios_pix_favorecido', valor: 'Escritório Teste' }], error: null }
      return { data: [], error: null }
    }
    const q = new Proxy({}, {
      get: (_, k) => {
        if (k === 'then') return (ok, erro) => Promise.resolve(resultado()).then(ok, erro)
        if (k === 'update' || k === 'insert') return (v) => { estado.op = k; estado.valores = v; return q }
        if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve(resultado())
        return () => q
      },
    })
    return q
  }
  return { gravado, from, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }
}

function iaResponde(json) {
  const original = global.fetch
  const pedidos = []
  global.fetch = async (_url, opts) => {
    pedidos.push(JSON.parse(opts.body))
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(json) }] }) }
  }
  return { pedidos, restaurar: () => { global.fetch = original } }
}

test('PIX do honorário com confiança alta: honorário pago e comprovante registrado', async () => {
  const sb = supabaseFalso()
  const ia = iaResponde({ ehComprovante: true, valorPago: 350, dataPagamento: '2026-11-09', honorarioId: 'hon-1', confianca: 'alta' })
  try {
    const res = await registrarComprovante(sb, { arquivoBase64: PNG, filename: 'pix.png', mimeType: 'image/png', apiKey: 'chave' })
    assert.equal(res.baixaAutomatica, true)
    assert.equal(res.honorario.id, 'hon-1')
    assert.equal(res.guia, null)
    const upd = sb.gravado.updates.find((u) => u.tabela === 'honorarios')
    assert.equal(upd.valores.status, 'pago')
    assert.equal(upd.valores.data_pagamento, '2026-11-09')
    assert.ok(upd.valores.comprovante_path)
    const fila = sb.gravado.inserts.find((i) => i.tabela === 'comprovantes_pagamento')
    assert.equal(fila.valores.status, 'baixado')
    assert.equal(fila.valores.honorario_id, 'hon-1')
    // a IA recebeu a lista de honorários e quem é o recebedor
    assert.match(ia.pedidos[0].messages[0].content[1].text, /Honorários do escritório em aberto[\s\S]*Escritório Teste[\s\S]*hon-1/)
  } finally { ia.restaurar() }
})

test('valor diferente do honorário: fica para conferir, com o honorário sugerido', async () => {
  const sb = supabaseFalso()
  const ia = iaResponde({ ehComprovante: true, valorPago: 900, honorarioId: 'hon-1', confianca: 'alta' })
  try {
    const res = await registrarComprovante(sb, { arquivoBase64: PNG, filename: 'pix.png', mimeType: 'image/png', apiKey: 'chave' })
    assert.equal(res.baixaAutomatica, false)
    assert.equal(sb.gravado.updates.length, 0)
    const fila = sb.gravado.inserts.find((i) => i.tabela === 'comprovantes_pagamento')
    assert.equal(fila.valores.status, 'pendente')
    assert.equal(fila.valores.honorario_sugerido_id, 'hon-1')
    assert.equal(fila.valores.cliente_id, 'cli-1')
  } finally { ia.restaurar() }
})

test('sem as colunas novas no banco: baixa o honorário só com status e data', async () => {
  const sb = supabaseFalso({ colunasHonorario: false })
  const ia = iaResponde({ ehComprovante: true, valorPago: 350, dataPagamento: '2026-11-09', honorarioId: 'hon-1', confianca: 'alta' })
  try {
    const res = await registrarComprovante(sb, { arquivoBase64: PNG, filename: 'pix.png', mimeType: 'image/png', apiKey: 'chave' })
    assert.equal(res.baixaAutomatica, true)
    const ultimo = sb.gravado.updates.filter((u) => u.tabela === 'honorarios').at(-1)
    assert.deepEqual(ultimo.valores, { status: 'pago', data_pagamento: '2026-11-09' })
  } finally { ia.restaurar() }
})
