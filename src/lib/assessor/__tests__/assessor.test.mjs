// Testes do Assessor (lógica pura). Rodar: npm run test:assessor
// Dados fictícios — nunca usar nome/CPF real de cliente aqui.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarAssessor, cardsDoCliente, resumoAnonimo } from '../index.js'
import { siglaRegime, grupoAtividade, opSimplesDoGabarito, perfilCliente } from '../perfil.js'
import { diasEntre } from '../datas.js'

const HOJE = '2026-10-28'

const clientes = [
  { id: 'c1', nome: 'Clínica Exemplo', regime: 'Simples Nacional', municipio: 'Cidade A' },
  { id: 'c2', nome: 'Indústria Fictícia', regime: 'Lucro Presumido', municipio: 'Cidade B' },
  { id: 'c3', nome: 'Loja Teste', regime: 'Simples Nacional', municipio: null },
  { id: 'c4', nome: 'Microempreendedor Teste', regime: 'MEI', municipio: 'Cidade A' },
]
const empresasNfse = [
  { cliente_id: 'c1', ambiente: 'producao', ativo: true, cert_valido_ate: '2026-11-05',
    servico_padrao: { cTribNac: '041601' }, gabarito_xml: '<prest><regTrib><opSimpNac>3</opSimpNac></regTrib></prest>' },
  { cliente_id: 'c2', ambiente: 'homologacao', ativo: true, cert_valido_ate: '2027-06-01',
    servico_padrao: { cTribNac: '171901', cIndOp: '000001', CST: '000', cClassTrib: '000001' }, gabarito_xml: '<opSimpNac>1</opSimpNac>' },
]

function base(extra = {}) {
  return montarAssessor({
    clientes,
    empresasNfse,
    obrigacoesAbertas: [
      { id: 'o1', cliente_id: 'c1', status: 'pendente', vencimento: '2026-10-30', eh_imposto: true },
      { id: 'o2', cliente_id: 'c2', status: 'pendente', vencimento: '2026-10-30', eh_imposto: true },
      { id: 'o3', cliente_id: 'c3', status: 'vencido', vencimento: '2026-10-20', eh_imposto: false },
    ],
    guiasAnexadas: new Set(['o2']),
    notas: [
      { cliente_id: 'c1', estado: 'importada', status_validacao: 'pendente', criado_em: '2026-10-20T10:00:00Z' },
      { cliente_id: 'c1', estado: 'importada', status_validacao: 'pendente', criado_em: '2026-10-28T10:00:00Z' },
      { cliente_id: 'c2', estado: 'indeterminada', status_validacao: 'pronto', criado_em: '2026-10-27T10:00:00Z' },
    ],
    eventosPainel: [{ cliente_id: 'c1' }],
    tarefas: [{ cliente_id: 'c3', concluida: false, vencimento: '2026-10-01' }, { cliente_id: 'c3', concluida: true, vencimento: '2026-10-01' }],
    ...extra,
  }, HOJE)
}
const porId = (a) => Object.fromEntries(a.cards.map((c) => [c.id, c]))

test('perfil: regime, atividade e opção do Simples', () => {
  assert.equal(siglaRegime('Simples Nacional'), 'SN')
  assert.equal(siglaRegime('Lucro Real'), 'LR')
  assert.equal(siglaRegime('MEI'), 'MEI')
  assert.equal(siglaRegime(''), null)
  assert.equal(grupoAtividade('041601'), 'saude')
  assert.equal(grupoAtividade('171901'), 'regulamentada')
  assert.equal(grupoAtividade('010101'), null)
  assert.equal(opSimplesDoGabarito('<opSimpNac> 2 </opSimpNac>'), '2')
  const p = perfilCliente({ id: 'x', nome: 'X', regime: '' }, { servico_padrao: {}, gabarito_xml: '<opSimpNac>2</opSimpNac>' })
  assert.equal(p.regime, 'MEI')
})

test('datas: diferença em dias sem depender do fuso', () => {
  assert.equal(diasEntre('2026-10-28', '2026-10-30'), 2)
  assert.equal(diasEntre('2026-10-28T23:59:00Z', '2026-10-28'), 0)
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1)
})

test('reforma: prazo da opção do Simples é urgente às vésperas de 30/10/2026', () => {
  const c = porId(base())['reforma-sn-opcao-regime-regular']
  assert.ok(c)
  assert.equal(c.nivel, 'urgente')
  assert.match(c.titulo, /30\/10\/2026 \(2 dias\)/)
  assert.deepEqual(c.clientes.map((x) => x.id).sort(), ['c1', 'c3'])
  assert.ok(c.fonte?.url)
})

test('reforma: depois do prazo vira lembrete de cancelamento', () => {
  const a = montarAssessor({ clientes, empresasNfse }, '2026-11-10')
  const ids = a.cards.map((c) => c.id)
  assert.ok(!ids.includes('reforma-sn-opcao-regime-regular'))
  assert.ok(ids.includes('reforma-sn-cancelamento-opcao'))
})

test('reforma: lembretes por perfil (NFS-e, lucro, atividade, município, MEI)', () => {
  const c = porId(base())
  assert.deepEqual(c['reforma-nfse-simples-campos'].clientes.map((x) => x.id), ['c1'])
  assert.deepEqual(c['reforma-nfse-ibscbs'].clientes.map((x) => x.id), ['c1'])
  assert.equal(c['reforma-nfse-ibscbs'].nivel, 'urgente')
  assert.deepEqual(c['reforma-lucro-ano-teste'].clientes.map((x) => x.id), ['c2'])
  assert.deepEqual(c['reforma-reducao-saude'].clientes.map((x) => x.id), ['c1'])
  assert.deepEqual(c['reforma-reducao-regulamentadas'].clientes.map((x) => x.id), ['c2'])
  assert.match(c['reforma-iss-municipios'].texto, /Cidade A \(2\)/)
  assert.deepEqual(c['reforma-mei'].clientes.map((x) => x.id), ['c4'])
})

test('uso: guias, vencidas, NFS-e, certificado, painel, tarefas e cadastro', () => {
  const c = porId(base())
  assert.deepEqual(c['uso-impostos-sem-guia'].clientes.map((x) => x.id), ['c1'])
  assert.deepEqual(c['uso-obrigacoes-vencidas'].clientes.map((x) => x.id), ['c3'])
  assert.match(c['uso-nfse-rejeitadas'].texto, /consulte antes de reenviar/)
  assert.match(c['uso-nfse-paradas'].titulo, /^1 nota/)
  assert.equal(c['uso-certificado'].nivel, 'atencao') // vence em 8 dias
  assert.deepEqual(c['uso-nfse-homologacao'].clientes.map((x) => x.id), ['c2'])
  assert.deepEqual(c['uso-painel-sem-acesso'].clientes.map((x) => x.id).sort(), ['c2', 'c3', 'c4'])
  assert.match(c['uso-tarefas-atrasadas'].titulo, /^1 tarefa/)
  assert.deepEqual(c['uso-cadastro-incompleto'].clientes.map((x) => x.id), ['c3'])
})

test('uso: sem dados de painel não opina sobre acessos', () => {
  const ids = base({ eventosPainel: null }).cards.map((c) => c.id)
  assert.ok(!ids.includes('uso-painel-sem-acesso'))
})

test('cards ordenados por urgência e filtráveis por cliente', () => {
  const a = base()
  const ordem = { urgente: 0, atencao: 1, dica: 2 }
  for (let i = 1; i < a.cards.length; i++) assert.ok(ordem[a.cards[i - 1].nivel] <= ordem[a.cards[i].nivel])
  const so4 = cardsDoCliente(a.cards, 'c4')
  assert.ok(so4.length > 0 && so4.every((c) => c.clientes.some((x) => x.id === 'c4')))
})

test('dicas e fluxos dependem do que o escritório usa', () => {
  const com = base()
  assert.ok(com.fluxos.some((f) => f.id === 'fluxo-nfse'))
  const sem = montarAssessor({ clientes, empresasNfse: [] }, HOJE)
  assert.ok(!sem.fluxos.some((f) => f.id === 'fluxo-nfse'))
  assert.ok(!sem.dicas.some((d) => d.id === 'dica-recorrentes'))
})

test('resumo anônimo não leva nome de cliente', () => {
  const r = resumoAnonimo(base())
  const json = JSON.stringify(r)
  for (const c of clientes) assert.ok(!json.includes(c.nome), `vazou ${c.nome}`)
  assert.ok(r.cards.every((c) => typeof c.clientesAfetados === 'number'))
  assert.equal(r.indicadores.clientes, 4)
})

test('uso: ignora obrigações e notas de clientes inativos (fora da lista)', () => {
  const a = montarAssessor({
    clientes,
    obrigacoesAbertas: [{ id: 'z', cliente_id: 'inativo', status: 'vencido', vencimento: '2026-10-01' }],
    notas: [{ cliente_id: 'inativo', estado: 'rejeitada' }],
  }, HOJE)
  const ids = a.cards.map((c) => c.id)
  assert.ok(!ids.includes('uso-obrigacoes-vencidas'))
  assert.ok(!ids.includes('uso-nfse-rejeitadas'))
})
