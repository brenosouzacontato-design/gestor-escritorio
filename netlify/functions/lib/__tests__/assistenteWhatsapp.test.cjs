// Assistente guiado do grupo ANALISTA JR (lib/assistenteWhatsapp.js): "oi" → menu → empresa →
// tomador → valor → data, e os atalhos voltar/sair. Cadastros fictícios.
const test = require('node:test')
const assert = require('node:assert/strict')
const a = require('../assistenteWhatsapp')

const empresas = [
  { cliente_id: 'e1', nome: 'Simple Care Odontologia', ambiente: 'producao' },
  { cliente_id: 'e2', nome: 'Padaria Pão Bom', ambiente: 'homologacao' },
  { cliente_id: 'e3', nome: 'Monica Silva', ambiente: 'producao', mei: true },
]
const cadastros = {
  e1: {
    modelos: [{ id: 'm1', nome: 'Shopee', cpf: '11222333000181', periodicidade: 'semanal', inicio: '2026-11-02', valor: 1250, ativo: true }],
    tomadores: [{ id: 't1', nome: 'Maria Souza', cpf: '52998224725', valor_padrao: 150, ativo: true }, { id: 't2', nome: 'João Lima', cpf: '', ativo: false }],
  },
  e2: { modelos: [], tomadores: [{ id: 't3', nome: 'Carlos Dias', cpf: '52998224725', ativo: true }] },
  e3: { mei: [{ id: 'k1', tomador_nome: 'Agência X', tomador_doc: '11222333000181', valor: 8000, ativo: true }] },
}
const ctx = { empresas, cadastros, hoje: '2026-11-25', hora: '10:00' }

// conversa: aplica as mensagens em sequência e devolve o último resultado
function conversar(...msgs) {
  let estado = null
  let r
  for (const m of msgs) { r = a.passo(estado, m, ctx); estado = r.estado }
  return r
}

test('oi abre o menu; qualquer mensagem sem conversa também', () => {
  const r = conversar('oi')
  assert.equal(r.estado.etapa, 'menu')
  assert.match(r.mensagens[0], /\*1\* · 🧾 Emitir NFS-e/)
  assert.match(r.mensagens[0], /\*6\* · 📌 Criar obrigação/)
  assert.equal(conversar('bom dia!').estado.etapa, 'menu')
  assert.equal(conversar('qualquer coisa').estado.etapa, 'menu')
})

test('emitir NFS-e: empresa → tomador → valor sugerido → data de hoje', () => {
  let r = conversar('oi', '1')
  assert.equal(r.estado.etapa, 'empresa')
  // empresas em ordem alfabética, MEI marcada
  assert.match(r.mensagens[0], /\*1\* · Monica Silva _\(MEI\)_\n\*2\* · Padaria Pão Bom\n\*3\* · Simple Care Odontologia/)
  r = conversar('oi', '1', '3')
  assert.equal(r.estado.etapa, 'tomador')
  assert.match(r.mensagens[0], /Shopee _\(recorrente semanal\)_/)
  assert.doesNotMatch(r.mensagens[0], /João Lima/) // inativo
  r = conversar('oi', '1', 'simple care', 'maria')
  assert.equal(r.estado.etapa, 'valor')
  assert.match(r.mensagens[0], /usar R\$\s150,00/)
  r = conversar('oi', '1', '3', '2', '1')
  assert.equal(r.estado.etapa, 'data')
  assert.equal(r.estado.valor, '150.00')
  r = conversar('oi', '1', '3', '2', '1', '1')
  assert.equal(r.estado, null)
  assert.equal(r.acao.tipo, 'nfse')
  assert.deepEqual([r.acao.r.empresa.cliente_id, r.acao.r.tipo, r.acao.r.item.id, r.acao.r.valor, r.acao.r.data], ['e1', 'tomador', 't1', '150.00', null])
})

test('emitir NFS-e: valor e data digitados; data futura e valor errado pedem de novo', () => {
  assert.match(conversar('oi', '1', '3', '1', 'abc').mensagens[0], /Não entendi o valor/)
  const r = conversar('oi', '1', '3', '1', '1.300,50', '20/11')
  assert.deepEqual([r.acao.r.tipo, r.acao.r.valor, r.acao.r.data], ['recorrente', '1300.50', '2026-11-20'])
  const fut = conversar('oi', '1', '3', '1', '10', '30/12/2026')
  assert.equal(fut.estado.etapa, 'data')
  assert.match(fut.mensagens[0], /não pode ser futura/)
})

test('empresa com um tomador só já pula para o valor; MEI usa o modelo', () => {
  const r = conversar('oi', '1', 'padaria')
  assert.equal(r.estado.etapa, 'valor')
  assert.match(r.mensagens[0], /Carlos Dias/)
  const mei = conversar('oi', '1', '1', '1', '1')
  assert.deepEqual([mei.acao.r.tipo, mei.acao.r.valor], ['mei', '8000.00'])
})

test('agendar NFS-e: empresas com modelo recorrente ou MEI; dia e hora', () => {
  let r = conversar('oi', '2')
  assert.match(r.mensagens[0], /\*1\* · Monica Silva _\(MEI\)_\n\*2\* · Simple Care/)
  assert.doesNotMatch(r.mensagens[0], /Padaria/)
  // uma empresa e um modelo só: já pergunta o valor
  r = conversar('oi', '2', '2')
  assert.equal(r.estado.etapa, 'valor')
  r = conversar('oi', '2', '2', '1')
  assert.equal(r.estado.etapa, 'quando')
  assert.match(conversar('oi', '2', '2', '1', 'amanhã cedo').mensagens[0], /Digite assim/)
  assert.match(conversar('oi', '2', '2', '1', '25/11 08:00').mensagens[0], /já passou/)
  r = conversar('oi', '2', '2', '1', '30/11 14:00')
  assert.equal(r.acao.tipo, 'agendar')
  assert.deepEqual([r.acao.r.item.id, r.acao.r.valor, r.acao.q.dia, r.acao.q.hora], ['m1', '1250.00', '2026-11-30', '14:00'])
})

test('agendar NFS-e de MEI: usa o modelo MEI', () => {
  let r = conversar('oi', '2', 'monica')
  assert.equal(r.estado.etapa, 'valor')
  assert.match(r.mensagens[0], /Agência X/)
  r = conversar('oi', '2', 'monica', '1', '01/12 09:30')
  assert.equal(r.acao.tipo, 'agendar')
  assert.deepEqual([r.acao.r.tipo, r.acao.r.item.id, r.acao.r.valor, r.acao.q.dia, r.acao.q.hora], ['mei', 'k1', '8000.00', '2026-12-01', '09:30'])
})

test('tarefa, lembrete, reunião e obrigação: descreve em uma mensagem', () => {
  for (const [n, categoria] of [['3', 'tarefa'], ['4', 'lembrete'], ['5', 'reuniao'], ['6', 'obrigacao']]) {
    const r = conversar('oi', n, 'conferir DAS da Padaria até sexta')
    assert.deepEqual(r.acao, { tipo: 'comando', categoria, texto: 'conferir DAS da Padaria até sexta' })
    assert.equal(r.estado, null)
  }
})

test('voltar, sair e resposta que não está na lista', () => {
  assert.equal(conversar('oi', '1', 'voltar').estado.etapa, 'menu')
  const sair = conversar('oi', '1', '3', 'sair')
  assert.equal(sair.estado, null)
  assert.match(sair.mensagens[0], /Até mais/)
  const errado = conversar('oi', '9')
  assert.equal(errado.estado.etapa, 'menu')
  assert.match(errado.mensagens[0], /Não entendi/)
  assert.equal(conversar('oi', '1', '7').estado.etapa, 'empresa')
  // texto ambíguo não escolhe ("a" bate em várias)
  assert.equal(a.escolher('a', ['Ana', 'Bia']), -1)
  assert.equal(a.escolher('2', ['Ana', 'Bia']), 1)
  assert.equal(a.escolher('bia', ['Ana', 'Bia']), 1)
})
