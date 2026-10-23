// Cadastro de clientes do prestador. Dados fictícios, no formato de uma planilha real de controle
// (nome | CPF | Janeiro..Dezembro, CPF sem zero à esquerda, apelido entre parênteses, linha de totais).

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')

process.env.NFSE_CERT_KEY = process.env.NFSE_CERT_KEY || crypto.randomBytes(32).toString('base64')

const { lerPlanilhaTomadores, encontrarPorNome, completarComCadastro, planejarImportacao, separarApelidos } = require('../tomadores')
const { importarTexto, pareceListaDatada } = require('../importador')

const PLANILHA = [
  [null, null, 'Janeiro', 'Fevereiro', 'Março'],
  ['Adriana Vieira Mattos', '529.982.247-25', 800, null, 800],
  ['Bruna Teles ', ' 010.928.159-45', 480, 360, null],
  ['Carla Sem Documento', null, null, 200, 200],
  ['Diana Fonseca (Mãe do João)', '40923600678', 400, 600, 600],          // DV errado
  ['Elaine Prates', 1092815945, 420, 640, 480],                           // número sem o zero
  ['Maria Helena Duarte Costa(José Ricardo)', '507.529.170-80', 600, 600, 750],
  ['Ricardo Monteiro Pimenta Belo Souza', '786.666.176-67', 400, 400, null],
  ['Sofia Ramos, ', '342.366.712-55', 120, 200, null],
  [null, null, 300, null, null],
  [null, null, 9260, 5360, 7720],
]

test('lê a planilha de controle: colunas descobertas, apelidos, zero à esquerda, DV errado, totais ignorados', () => {
  const t = lerPlanilhaTomadores(PLANILHA)
  assert.deepEqual(t.map((x) => x.nome), ['Adriana Vieira Mattos', 'Bruna Teles', 'Carla Sem Documento', 'Diana Fonseca',
    'Elaine Prates', 'Maria Helena Duarte Costa', 'Ricardo Monteiro Pimenta Belo Souza', 'Sofia Ramos'])
  const por = Object.fromEntries(t.map((x) => [x.nome, x]))
  assert.equal(por['Bruna Teles'].cpf, '01092815945')
  assert.equal(por['Carla Sem Documento'].cpf, '')
  assert.match(por['Carla Sem Documento'].avisos[0], /Sem CPF/)
  assert.deepEqual(por['Diana Fonseca'].apelidos, ['Mãe do João'])
  assert.match(por['Diana Fonseca'].avisos[0], /dígito verificador/)
  assert.equal(por['Elaine Prates'].cpf, '01092815945') // mesmo CPF da Bruna: vira conflito na importação
  assert.match(por['Elaine Prates'].avisos[0], /zeros à esquerda/)
  assert.deepEqual(por['Maria Helena Duarte Costa'].apelidos, ['José Ricardo'])
})

test('separa apelido entre parênteses e tira vírgula no fim', () => {
  assert.deepEqual(separarApelidos('Sofia Ramos, '), { nome: 'Sofia Ramos', apelidos: [] })
  assert.deepEqual(separarApelidos('Maria Costa(José Ricardo)'), { nome: 'Maria Costa', apelidos: ['José Ricardo'] })
})

const CADASTRO = lerPlanilhaTomadores(PLANILHA).map((t, i) => ({ ...t, id: `t${i}` }))

test('busca por nome: nome mais longo na mensagem, apelido, parecido não é automático', () => {
  assert.equal(encontrarPorNome('Adriana Vieira Mattos Gonçalves', CADASTRO).tomador.nome, 'Adriana Vieira Mattos')
  assert.equal(encontrarPorNome('SOFIA ramos', CADASTRO).tomador.cpf, '34236671255')
  const ap = encontrarPorNome('José Ricardo F Costa (recibo em nome de Maria Helena)', CADASTRO)
  assert.equal(ap.tomador.nome, 'Maria Helena Duarte Costa')
  assert.match(ap.como, /^apelido/)
  const parecido = encontrarPorNome('Ricardo Fernandes Souza', CADASTRO)
  assert.equal(parecido.tomador, undefined)
  assert.equal(parecido.candidatos[0].nome, 'Ricardo Monteiro Pimenta Belo Souza')
  assert.deepEqual(encontrarPorNome('Fulano de Tal', CADASTRO).candidatos, [])
  assert.equal(encontrarPorNome('Adriana', CADASTRO).tomador, undefined) // uma palavra só não basta
})

const LISTA = `9/09/2026
Adriana Vieira Mattos Gonçalves 480,00
Fulano de Tal 100,00
11/09/2026
José Ricardo F Costa ( recibo ia em nome de Maria Helena) 750,00
25/09/2026
Ricardo Fernandes Souza 300,00
Carla Sem Documento 200,00`

test('lista datada (agenda) é reconhecida e lida linha a linha', () => {
  assert.ok(pareceListaDatada(LISTA))
  assert.ok(!pareceListaDatada('[10:03, 13/10/2026] X: Maria\n52998224725\nValor: 100,00'))
  const r = importarTexto(LISTA)
  assert.deepEqual(r.map((x) => [x.data, x.nome, x.valor]), [
    ['2026-09-09', 'Adriana Vieira Mattos Gonçalves', '480.00'],
    ['2026-09-09', 'Fulano de Tal', '100.00'],
    ['2026-09-11', 'José Ricardo F Costa', '750.00'],
    ['2026-09-25', 'Ricardo Fernandes Souza', '300.00'],
    ['2026-09-25', 'Carla Sem Documento', '200.00'],
  ])
  assert.match(r[2].avisos[0], /recibo ia em nome de Maria Helena/)
})

test('completa CPF pelo cadastro só quando é inequívoco; descrição padrão da empresa', () => {
  const r = completarComCadastro(importarTexto(LISTA), CADASTRO, { descricaoPadrao: 'Sessão de psicoterapia' })
  assert.equal(r[0].cpf, '52998224725')
  assert.equal(r[0].nome, 'Adriana Vieira Mattos Gonçalves') // pelo nome: fica o da mensagem (mais completo)
  assert.equal(r[1].cpf, '')
  assert.match(r[1].avisos.at(-1), /não está no cadastro/)
  assert.equal(r[2].cpf, '50752917080')
  assert.equal(r[2].nome, 'Maria Helena Duarte Costa')
  assert.match(r[2].avisos.at(-1), /apelido/)
  assert.equal(r[3].cpf, '')
  assert.match(r[3].avisos.at(-1), /Parecido com: Ricardo Monteiro Pimenta Belo Souza/)
  assert.match(r[4].avisos.at(-1), /sem CPF/)
  assert.ok(r.every((x) => x.descricao === 'Sessão de psicoterapia'))
})

test('planeja a importação: novo, atualizar (mescla apelidos) e conflito de CPF', () => {
  const existentes = [
    { id: 'a', nome: 'Adriana Vieira Mattos', cpf: '52998224725', apelidos: ['Dri'] },
    { id: 'b', nome: 'Bruna Teles', cpf: '08315646605', apelidos: [] },
  ]
  const plano = planejarImportacao(lerPlanilhaTomadores(PLANILHA), existentes)
  const por = Object.fromEntries(plano.map((p) => [p.nome, p]))
  assert.equal(por['Adriana Vieira Mattos'].acao, 'atualizar')
  assert.deepEqual(por['Adriana Vieira Mattos'].apelidos, ['Dri'])
  assert.equal(por['Bruna Teles'].acao, 'conflito')
  assert.equal(por['Sofia Ramos'].acao, 'novo')
  assert.equal(por['Elaine Prates'].acao, 'conflito')
  assert.match(por['Elaine Prates'].avisos.at(-1), /repetido na planilha/)
})

// ---------------------------------------------------------------- pela function

const funcao = require('../../../nfse')
const { criarSupabaseFalso } = require('./supabaseFalso.cjs')
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')
const CLIENTE = '22222222-2222-4222-8222-222222222222'

function montar() {
  const supa = criarSupabaseFalso({ usuarios: { tok: { id: 'u1', email: 'dono@escritorio.com' } },
    tabelas: { clientes: [{ id: CLIENTE, nome: 'Prestador Teste', cnpj: '47.619.250/0001-78' }] } })
  funcao._deps.supabase = () => supa
  const chamar = async (corpo) => {
    const r = await funcao.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(corpo) })
    return { status: r.statusCode, ...JSON.parse(r.body) }
  }
  return { supa, chamar }
}

const planilhaBase64 = () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(PLANILHA), 'Planilha1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64')
}

test('function: importa planilha de clientes (prévia e gravação), edita e usa na importação de atendimentos', async () => {
  const { supa, chamar } = montar()
  const previa = await chamar({ acao: 'tomadores_importar', cliente_id: CLIENTE, planilha_base64: planilhaBase64() })
  assert.equal(previa.status, 200)
  assert.equal(previa.plano.length, 8)
  assert.equal(supa.db.nfse_tomadores.length, 0) // prévia não grava
  const gravado = await chamar({ acao: 'tomadores_importar', cliente_id: CLIENTE, planilha_base64: planilhaBase64(), gravar: true })
  assert.equal(gravado.gravados, 7) // Elaine: CPF repetido, fica de fora para conferência
  assert.equal(supa.db.nfse_tomadores.length, 7)
  // reimportar não duplica
  await chamar({ acao: 'tomadores_importar', cliente_id: CLIENTE, planilha_base64: planilhaBase64(), gravar: true })
  assert.equal(supa.db.nfse_tomadores.length, 7)

  // pela tela: CPF com DV errado é recusado; apelido por vírgula
  const carla = supa.db.nfse_tomadores.find((t) => t.nome === 'Carla Sem Documento')
  assert.equal((await chamar({ acao: 'tomador_salvar', cliente_id: CLIENTE, tomador: { ...carla, cpf: '111.111.111-11' } })).status, 400)
  const salvo = await chamar({ acao: 'tomador_salvar', cliente_id: CLIENTE, tomador: { ...carla, cpf: '768.426.846-50', apelidos: 'Carlinha, Carla S.' } })
  assert.equal(salvo.status, 200)
  assert.deepEqual(salvo.tomador.apelidos, ['Carlinha', 'Carla S.'])

  // atendimentos: precisa da empresa configurada
  const gabarito = fs.readFileSync(path.join(__dirname, 'golden', 'gabarito_dps.xml'), 'utf8')
  assert.equal((await chamar({ acao: 'salvar_empresa', cliente_id: CLIENTE, gabarito_xml: gabarito, descricao_padrao: 'Sessão de psicoterapia' })).status, 200)
  const imp = await chamar({ acao: 'importar', cliente_id: CLIENTE, texto: LISTA })
  assert.equal(imp.status, 200)
  const notas = supa.db.nfse_notas.filter((n) => n.lote_id === imp.lote_id)
  assert.deepEqual(notas.map((n) => n.cpf), ['52998224725', '', '50752917080', '', '76842684650'])
  assert.ok(notas.every((n) => n.descricao === 'Sessão de psicoterapia'))

  assert.equal((await chamar({ acao: 'tomador_excluir', cliente_id: CLIENTE, id: carla.id })).status, 200)
  assert.equal(supa.db.nfse_tomadores.length, 6)
})
