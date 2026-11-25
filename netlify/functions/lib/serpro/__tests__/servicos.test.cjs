const { test } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const { criarCliente, montarPedido, interpretarResposta, ErroIntegra } = require('../integraContador')
const s = require('../servicos')

// Respostas reais do ambiente de demonstração do SERPRO (PDF trocado por um PDF mínimo).
const fixture = (nome) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${nome}.json`), 'utf8'))
const CNPJ = '11222333000181'
const ESCRITORIO = '99888777000166'

test('pedido: escritório contratante e autor, dados em texto JSON', () => {
  const p = montarPedido({ contratante: '99.888.777/0001-66', contribuinte: CNPJ, ...s.SERVICOS.das, dados: { periodoApuracao: '202603' } })
  assert.deepStrictEqual(p.contratante, { numero: ESCRITORIO, tipo: 2 })
  assert.deepStrictEqual(p.autorPedidoDados, p.contratante)
  assert.deepStrictEqual(p.contribuinte, { numero: CNPJ, tipo: 2 })
  assert.strictEqual(p.pedidoDados.dados, '{"periodoApuracao":"202603"}')
  assert.strictEqual(montarPedido({ contratante: ESCRITORIO, contribuinte: '52998224725', idSistema: 'X', idServico: 'Y', versaoSistema: '1', dados: '' }).contribuinte.tipo, 1)
  assert.throws(() => montarPedido({ contratante: ESCRITORIO, contribuinte: '123', dados: '' }), ErroIntegra)
})

test('resposta: status em texto, dados em JSON, erro com as mensagens do SERPRO', () => {
  const r = interpretarResposta(200, fixture('trial_parcelas'))
  assert.strictEqual(r.status, 200)
  assert.ok(Array.isArray(r.dados.listaParcelas))
  assert.throws(() => interpretarResposta(400, { status: 400, mensagens: [{ codigo: 'ERRO', texto: 'Dados inválidos.' }] }),
    (e) => e instanceof ErroIntegra && /400: ERRO Dados inválidos/.test(e.message))
})

test('DARF: monta os dados do Sicalc e lê o recálculo', () => {
  const d = s.dadosDarf({ codigo_receita: '0220-01', tipo_pa: 'tr', periodo: '04/2021', cota: 1, valor: '1.000,00', data_consolidacao: '2022-08-08', uf: 'mg', municipio: '4123' })
  assert.deepStrictEqual(d, { codigoReceita: '0220', codigoReceitaExtensao: '01', tipoPA: 'TR', dataPA: '04/2021', valorImposto: '1000.00',
    cota: '1', dataConsolidacao: '2022-08-08T00:00:00', uf: 'MG', municipio: '4123' })
  const m = s.dadosDarf({ codigo_receita: '1162', periodo: '2026-01', vencimento: '2026-02-20', valor: 350.5, data_consolidacao: '2026-11-30' })
  assert.strictEqual(m.dataPA, '01/2026')
  assert.strictEqual(m.vencimento, '2026-02-20T00:00:00')
  assert.throws(() => s.dadosDarf({ codigo_receita: '1162', periodo: '01/2026', valor: 1, data_consolidacao: '2026-11-30' }), /vencimento/)
  assert.throws(() => s.dadosDarf({ codigo_receita: '1162', periodo: '01/2026', valor: 1, cota: 1, vencimento: '2026-02-20', data_consolidacao: '2026-11-30' }), /OU a cota/)
  assert.strictEqual(s.dadosDarf({ codigo_receita: '2089', tipo_pa: 'TR', periodo: '03/2026', cota: 1, valor: 1, data_consolidacao: '2026-11-30' }).dataPA, '03/2026')
  assert.throws(() => s.dadosDarf({ codigo_receita: '2089', tipo_pa: 'TR', periodo: '05/2026', cota: 1, valor: 1, data_consolidacao: '2026-11-30' }), /trimestral/)
  assert.strictEqual(s.dadosDarf({ codigo_receita: '2372', tipo_pa: 'AN', periodo: '2025', vencimento: '2026-04-30', valor: 1, data_consolidacao: '2026-11-30' }).dataPA, '2025')
  assert.strictEqual(s.dadosDarf({ codigo_receita: '0561', tipo_pa: 'DI', periodo: '15/10/2026', vencimento: '2026-10-20', valor: 1, data_consolidacao: '2026-11-30' }).dataPA, '15/10/2026')
  assert.throws(() => s.dadosDarf({ codigo_receita: '12', periodo: '01/2026', valor: 1, cota: 1, data_consolidacao: '2026-11-30' }), /receita/)

  const r = s.resultadoDarf(interpretarResposta(200, fixture('trial_sicalc')).dados)
  assert.ok(r.pdf.subarray(0, 4).toString() === '%PDF')
  assert.deepStrictEqual([r.principal, r.multa, r.juros, r.total], [1000, 200, 258.3, 1458.3])
  assert.strictEqual(r.validade, '2022-08-31')
})

test('DAS: período AAAAMM, consolidação AAAAMMDD e leitura do detalhamento', () => {
  assert.deepStrictEqual(s.dadosDas({ periodo: '01/2018' }), { periodoApuracao: '201801' })
  assert.deepStrictEqual(s.dadosDas({ periodo: '2018-01', data_consolidacao: '2022-08-31' }), { periodoApuracao: '201801', dataConsolidacao: '20220831' })
  const r = s.resultadoDas(interpretarResposta(200, fixture('trial_das')).dados)
  assert.strictEqual(r.numero_documento, '07202221401801678')
  assert.deepStrictEqual([r.principal, r.multa, r.juros, r.total], [40, 8, 10.15, 58.15])
  assert.strictEqual(r.vencimento, '2018-02-20')
  assert.strictEqual(r.validade, '2022-08-31')
  assert.match(r.observacoes[0], /OPTANTE/)
})

test('parcelamentos: códigos dos serviços, lista de parcelas e DAS da parcela', () => {
  assert.deepStrictEqual(s.servicoParcelamento('PARCSN', 'parcelas'), { operacao: 'Consultar', idSistema: 'PARCSN', idServico: 'PARCELASPARAGERAR162', versaoSistema: '1.0' })
  assert.strictEqual(s.servicoParcelamento('PARCMEI', 'emitir').idServico, 'GERARDAS201')
  assert.strictEqual(s.servicoParcelamento('PARCSN-ESP', 'emitir').idServico, 'GERARDAS171')
  assert.strictEqual(s.servicoParcelamento('RELPMEI', 'parcelas').idServico, 'PARCELASPARAGERAR232')
  assert.throws(() => s.servicoParcelamento('PGFN', 'emitir'), /desconhecido/)

  const parcelas = s.resultadoParcelas(interpretarResposta(200, fixture('trial_parcelas')).dados)
  assert.deepStrictEqual(parcelas[0], { parcela: '202304', valor: 441.83 })
  assert.strictEqual(s.parcelaBr('202306'), '06/2023')
  assert.deepStrictEqual(s.dadosParcela('06/2023'), { parcelaParaEmitir: 202306 })
  assert.deepStrictEqual(s.dadosParcela('202306'), { parcelaParaEmitir: 202306 })
  const r = s.resultadoDasParcela(interpretarResposta(200, fixture('trial_parcsn_das')).dados)
  assert.strictEqual(r.pdf.subarray(0, 4).toString(), '%PDF')
  assert.throws(() => s.resultadoDasParcela({ docArrecadacaoPdfB64: Buffer.from('<html>').toString('base64') }), /não é PDF/)
})

test('cliente: autentica com certificado, reaproveita o token e renova no 401', async () => {
  const chamadas = []
  let tokens = 0
  let negarUmaVez = true
  const transporte = async (url, opts) => {
    chamadas.push({ url, opts })
    if (url.endsWith('/authenticate')) {
      tokens++
      return { status: 200, corpo: { access_token: `tok${tokens}`, jwt_token: `jwt${tokens}`, expires_in: 2008 } }
    }
    if (negarUmaVez && tokens === 1 && chamadas.filter((c) => !c.url.endsWith('/authenticate')).length === 2) {
      negarUmaVez = false
      return { status: 401, corpo: {} }
    }
    return { status: 200, corpo: fixture('trial_parcelas') }
  }
  const cli = criarCliente({ consumerKey: 'k', consumerSecret: 's', tls: { key: 'K', cert: 'C' }, contratante: ESCRITORIO, transporte })
  const pedido = { contribuinte: CNPJ, ...s.servicoParcelamento('PARCSN', 'parcelas'), dados: '' }
  await cli.chamar('Consultar', pedido)
  await cli.chamar('Consultar', pedido) // 401 → autentica de novo e repete
  const auth = chamadas.filter((c) => c.url.endsWith('/authenticate'))
  assert.strictEqual(auth.length, 2)
  assert.strictEqual(auth[0].opts.headers.Authorization, `Basic ${Buffer.from('k:s').toString('base64')}`)
  assert.strictEqual(auth[0].opts.headers['Role-Type'], 'TERCEIROS')
  assert.deepStrictEqual(auth[0].opts.tls, { key: 'K', cert: 'C' })
  const api = chamadas.filter((c) => !c.url.endsWith('/authenticate'))
  assert.strictEqual(api[0].url, 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar')
  assert.strictEqual(api[0].opts.headers.jwt_token, 'jwt1')
  assert.strictEqual(api[2].opts.headers.Authorization, 'Bearer tok2')
})

test('cliente: produção sem chave ou sem certificado não começa', () => {
  assert.throws(() => criarCliente({ consumerKey: '', consumerSecret: 's', tls: {}, contratante: ESCRITORIO }), /CONSUMER_KEY/)
  assert.throws(() => criarCliente({ consumerKey: 'k', consumerSecret: 's', tls: null, contratante: ESCRITORIO }), /Certificado/)
  assert.doesNotThrow(() => criarCliente({ ambiente: 'trial', contratante: ESCRITORIO }))
})
