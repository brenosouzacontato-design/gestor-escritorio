// Fluxo de emissão contra uma Sefin simulada. Nada sai da máquina. Mesmos cenários de tests/test_emissao.py.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { RepositorioMemoria } = require('../repositorio')
const { criarLote, copiarNota, definirCompetencia, atualizarNota, totais, NotaNaoEditavel } = require('../lotes')
const { criarEmissor, EmissaoBloqueada } = require('../emissor')
const { criarCliente, ErroRede, comprimir, descomprimir } = require('../sefin')
const { lerPfx } = require('../certificado')
const { verificar } = require('../assinatura')
const { lerElemento } = require('../xml')

const G = path.join(__dirname, 'golden')
const cert = lerPfx(fs.readFileSync(path.join(G, 'teste.pfx')), 'teste')
const GABARITO = fs.readFileSync(path.join(G, 'gabarito_dps.xml'), 'utf8')
const HOJE = '2026-10-15'
const CHAVE = '31546062247619250000178000000000001326100000000001'
const nfseXml = (n = '13') => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${CHAVE}"><nNFSe>${n}</nNFSe></infNFSe></NFSe>`

const EMPRESA = {
  cliente_id: 'cli-1', ambiente: 'homologacao', serie_dps: '900', codigo_municipio: '3154606', cnpj: '47619250000178',
  regra_competencia: 'mes_do_atendimento', servico_padrao: { cTribNac: '041201', tribISSQN: '1', tpRetISSQN: '1', regApIBSCBSSN: '1', cAtvSN: '7', cNBS: '123012300', cIndOp: '030101', CST: '200', cClassTrib: '200028' },
  campos_obrigatorios: ['nome', 'cpf', 'data', 'valor', 'descricao', 'endereco'], gabarito_xml: GABARITO,
}

// Sefin falsa: cada item do roteiro é 'ok', 'timeout', 'timeout_depois_de_gerar' ou [status, json]
function sefinFalsa() {
  const s = { post: [], getDps: [], enviados: [], chamadas: [], emitidas: {} }
  s.transporte = async (metodo, caminho, corpo) => {
    s.chamadas.push(`${metodo} ${caminho.split('/').slice(0, 2).join('/')}`)
    if (metodo === 'POST' && caminho === '/nfse') {
      const xml = descomprimir(corpo.dpsXmlGZipB64).toString('utf8')
      s.enviados.push(xml)
      const id = xml.match(/Id="(DPS\d+)"/)[1]
      const acao = s.post.length ? s.post.shift() : 'ok'
      if (acao === 'ok' || acao === 'timeout_depois_de_gerar') s.emitidas[id] = CHAVE
      if (typeof acao === 'string' && acao.startsWith('timeout')) throw new ErroRede('ETIMEDOUT: timeout simulado')
      if (acao === 'ok') return { status: 201, dados: { chaveAcesso: CHAVE, idDps: id, nfseXmlGZipB64: comprimir(nfseXml()) }, texto: '' }
      return { status: acao[0], dados: acao[1], texto: JSON.stringify(acao[1]) }
    }
    if (metodo === 'GET' && caminho.startsWith('/dps/')) {
      if (s.getDps.length && s.getDps.shift() === 'timeout') throw new ErroRede('ECONNRESET: sem conexão')
      const id = caminho.split('/')[2]
      if (s.emitidas[id]) return { status: 200, dados: { chaveAcesso: s.emitidas[id] }, texto: '' }
      return { status: 404, dados: { erro: { codigo: 'E2404', descricao: 'Não foi gerada uma NFS-e' } }, texto: '' }
    }
    if (metodo === 'GET' && caminho.startsWith('/nfse/')) return { status: 200, dados: { nfseXmlGZipB64: comprimir(nfseXml()) }, texto: '' }
    return { status: 404, dados: {}, texto: '' }
  }
  return s
}

async function ambiente() {
  const repo = new RepositorioMemoria({ empresas: [EMPRESA] })
  const sefin = sefinFalsa()
  const cliente = criarCliente({ tls: null, ambiente: 'homologacao', transporte: sefin.transporte })
  const emissor = criarEmissor({ repo, empresa: EMPRESA, certificado: cert, cliente, usuario: 'teste@x' })
  const lote = await criarLote(repo, {
    empresa: EMPRESA, origem: 'colado', hoje: HOJE, registros: [
      { nome: 'Maria Silva', cpf: '52998224725', endereco: 'Rua X 1', data: '2026-04-16', valor: '650.00', descricao: 'Limpeza e restauração', avisos: [] },
      { nome: 'José Souza', cpf: '01092815945', endereco: 'Rua Y 2', data: '2026-04-02', valor: '1300.00', descricao: 'Clareamento', avisos: [] },
    ],
  })
  const [a, b] = await repo.listarNotasLote(lote)
  return { repo, sefin, emissor, a: a.id, b: b.id }
}

const contar = (s, alvo) => s.chamadas.filter((c) => c === alvo).length

test('emissão com sucesso: número reservado, XML assinado guardado, NFS-e gravada', async () => {
  const { repo, sefin, emissor, a } = await ambiente()
  const r = await emissor.emitir(a)
  assert.deepEqual([r.estado, r.chave_acesso, r.numero_nfse], ['autorizada', CHAVE, '13'])
  const n = await repo.obterNota(a)
  assert.equal(n.n_dps, 1)
  assert.equal(n.id_dps, 'DPS315460624761925000017800900000000000000001')
  verificar(lerElemento(n.xml_enviado, 'DPS'))
  assert.equal(n.xml_retorno, nfseXml())
  assert.equal(totais(await repo.listarNotasLote(n.lote_id)).emitido, '650.00')
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
  assert.deepEqual(sefin.chamadas, ['POST /nfse']) // emitir de novo não reenvia
})

test('timeout com nota gerada: reconsulta encontra, sem segundo envio', async () => {
  const { repo, sefin, emissor, a } = await ambiente()
  sefin.post = ['timeout_depois_de_gerar']
  assert.equal((await emissor.emitir(a)).estado, 'indeterminada')
  assert.equal((await repo.obterNota(a)).estado, 'indeterminada')
  const r = await emissor.emitir(a)
  assert.equal(r.estado, 'autorizada')
  assert.equal(contar(sefin, 'POST /nfse'), 1)
})

test('timeout sem nota: reenvia o MESMO XML depois do E2404', async () => {
  const { repo, sefin, emissor, a } = await ambiente()
  sefin.post = ['timeout']
  await emissor.emitir(a)
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
  assert.deepEqual(sefin.chamadas, ['POST /nfse', 'GET /dps', 'POST /nfse'])
  assert.equal(sefin.enviados[0], sefin.enviados[1])
  assert.equal((await repo.obterNota(a)).n_dps, 1)
})

test('reconsulta sem resposta não reenvia', async () => {
  const { sefin, emissor, a } = await ambiente()
  sefin.post = ['timeout']
  sefin.getDps = ['timeout']
  await emissor.emitir(a)
  assert.equal((await emissor.emitir(a)).estado, 'indeterminada')
  assert.equal(contar(sefin, 'POST /nfse'), 1)
})

test('function caiu depois de marcar enviada: consulta antes', async () => {
  const { repo, sefin, emissor, a } = await ambiente()
  sefin.post = ['timeout_depois_de_gerar']
  await emissor.emitir(a)
  repo.notas.find((n) => n.id === a).estado = 'enviada'
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
  assert.equal(contar(sefin, 'POST /nfse'), 1)
})

test('rejeição, cópia para corrigir e numeração que não volta', async () => {
  const { repo, sefin, emissor, a, b } = await ambiente()
  sefin.post = [[400, { erros: [{ Codigo: 'E0160', Descricao: 'Opção do Simples não confere' }] }]]
  const r = await emissor.emitir(a)
  assert.equal(r.estado, 'rejeitada')
  assert.match(r.mensagem, /E0160.*Simples Nacional/)
  await assert.rejects(emissor.emitir(a), EmissaoBloqueada)
  const nova = await copiarNota(repo, EMPRESA, a, HOJE)
  assert.equal((await repo.obterNota(nova)).estado, 'validada')
  await assert.rejects(copiarNota(repo, EMPRESA, a, HOJE), NotaNaoEditavel)
  assert.equal((await emissor.emitir(b)).estado, 'autorizada')
  assert.equal((await repo.obterNota(b)).n_dps, 2)
  assert.equal((await emissor.emitir(nova)).estado, 'autorizada')
  assert.equal((await repo.obterNota(nova)).n_dps, 3)
  // a rejeitada refeita sai dos totais
  assert.deepEqual(totais(await repo.listarNotasLote((await repo.obterNota(a)).lote_id)),
    { servico: '1950.00', emitido: '1950.00', faltando: '0.00' })
})

test('erro 500 fica indeterminada e depois reconsulta e reenvia', async () => {
  const { sefin, emissor, a } = await ambiente()
  sefin.post = [[503, { erro: { codigo: 'E999', descricao: 'Indisponível' } }]]
  assert.equal((await emissor.emitir(a)).estado, 'indeterminada')
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
  assert.equal(contar(sefin, 'POST /nfse'), 2)
})

test('dois cliques ao mesmo tempo: só um envio', async () => {
  const { sefin, emissor, a } = await ambiente()
  const resultados = await Promise.allSettled([emissor.emitir(a), emissor.emitir(a)])
  assert.equal(resultados.filter((x) => x.status === 'fulfilled' && x.value.estado === 'autorizada').length >= 1, true)
  assert.equal(contar(sefin, 'POST /nfse'), 1)
})

test('competência por nota e em massa vai para a DPS', async () => {
  const { repo, sefin, emissor, a, b } = await ambiente()
  const n = await atualizarNota(repo, EMPRESA, a, { competencia: '10/2026' }, HOJE)
  assert.equal(n.competencia, '2026-10-01')
  const fut = await atualizarNota(repo, EMPRESA, a, { competencia: '16/10/2026' }, HOJE)
  assert.equal(fut.status_validacao, 'invalido')
  await definirCompetencia(repo, EMPRESA, [a, b], '05/10/2026', HOJE)
  await emissor.emitir(a)
  assert.match(sefin.enviados[0], /<dCompet>2026-10-05<\/dCompet>/)
  await definirCompetencia(repo, EMPRESA, [b], '', HOJE)
  await emissor.emitir(b)
  assert.match(sefin.enviados[1], /<dCompet>2026-04-02<\/dCompet>/)
  await assert.rejects(definirCompetencia(repo, EMPRESA, [a], '01/10/2026', HOJE), NotaNaoEditavel)
})

test('duplicidade: no lote, com emitida e em outro lote ainda não emitido', async () => {
  const { repo, emissor, a } = await ambiente()
  await emissor.emitir(a)
  const reg = { nome: 'Maria Silva', cpf: '52998224725', endereco: 'Rua X 1', data: '2026-04-16', valor: '650.00', descricao: 'Limpeza', avisos: [] }
  const l2 = await criarLote(repo, { empresa: EMPRESA, origem: 'colado', hoje: HOJE, registros: [reg, { ...reg, valor: '700.00' }, { ...reg, valor: '700.00' }] })
  const [d1, d2, d3] = await repo.listarNotasLote(l2)
  assert.match(d1.erros[0], /já emitida/)
  assert.equal(d2.status_validacao, 'pronto')
  assert.match(d3.erros[0], /deste lote/)
  const l3 = await criarLote(repo, { empresa: EMPRESA, origem: 'colado', hoje: HOJE, registros: [{ ...reg, valor: '700.00' }] })
  const [e1] = await repo.listarNotasLote(l3)
  assert.equal(e1.status_validacao, 'pronto')
  assert.ok(e1.avisos.some((x) => x.startsWith('Também está no lote')))
})

test('nota de outra empresa é recusada', async () => {
  const { repo, emissor, a } = await ambiente()
  repo.notas.find((n) => n.id === a).cliente_id = 'outra'
  await assert.rejects(emissor.emitir(a), /outra empresa/)
})

// --- trava de duplicidade na hora de emitir e nota cancelada no portal ---

async function comNotaJaEmitida(extra) {
  const amb = await ambiente()
  await amb.repo.inserirNotas([{ lote_id: 'lote-antigo', cliente_id: 'cli-1', ambiente: 'homologacao', estado: 'autorizada',
    nome: 'Maria Silva', cpf: '52998224725', valor: '650.00', numero_nfse: '1', ...extra }])
  const [antiga] = await amb.repo.listarNotasLote('lote-antigo')
  return { ...amb, antiga: antiga.id }
}

test('nota parecida (mesmo CPF e valor no mesmo mês) só sai com confirmação', async () => {
  const { repo, sefin, emissor, a } = await comNotaJaEmitida({ data: '2026-04-02' })
  await assert.rejects(emissor.emitir(a), (e) => e instanceof EmissaoBloqueada && /^Possível nota repetida: Maria Silva já tem NFS-e nº 1/.test(e.message))
  assert.deepEqual(sefin.chamadas, []) // nada enviado
  assert.equal((await repo.obterNota(a)).estado, 'validada') // nem número gasto
  assert.equal((await emissor.emitir(a, { confirmarRepetida: true })).estado, 'autorizada')
})

test('nota igual (mesmo CPF, data e valor) é bloqueada mesmo confirmando', async () => {
  const { sefin, emissor, a } = await comNotaJaEmitida({ data: '2026-04-16' })
  await assert.rejects(emissor.emitir(a, { confirmarRepetida: true }), /Nota repetida: Maria Silva/)
  assert.deepEqual(sefin.chamadas, [])
})

test('competência no mesmo mês também conta como parecida (o caso da nota migrada)', async () => {
  const { emissor, a, repo } = await comNotaJaEmitida({ data: '2026-03-20', competencia: '2026-04-01' })
  await assert.rejects(emissor.emitir(a), /Possível nota repetida/)
  // outro valor ou outro mês: segue normal
  await repo.atualizarNota(a, { valor: '700.00' })
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
})

test('depois de marcar a anterior como cancelada, emite sem travar; cancelada não reenvia', async () => {
  const { repo, emissor, a, antiga } = await comNotaJaEmitida({ data: '2026-04-16' })
  await repo.mudarEstado(antiga, 'autorizada', 'cancelada', 'Cancelada no portal nacional: duplicidade')
  assert.equal((await emissor.emitir(a)).estado, 'autorizada')
  await assert.rejects(emissor.emitir(antiga), /cancelada/)
  await assert.rejects(repo.mudarEstado(antiga, 'cancelada', 'autorizada'), /cancelada → autorizada/)
})

test('revalidação avisa nota parecida antes da emissão; cancelada sai dos totais', async () => {
  const { repo, a, antiga } = await comNotaJaEmitida({ data: '2026-04-02' })
  const { revalidarLote } = require('../lotes')
  const nota = await repo.obterNota(a)
  await revalidarLote(repo, nota.lote_id, EMPRESA, HOJE)
  assert.ok((await repo.obterNota(a)).avisos.some((x) => x.startsWith('Possível nota repetida')))
  assert.equal((await repo.obterNota(a)).estado, 'validada') // aviso, não erro
  await repo.mudarEstado(antiga, 'autorizada', 'cancelada', 'teste')
  assert.equal(totais(await repo.listarNotasLote('lote-antigo')).servico, '0.00')
})
