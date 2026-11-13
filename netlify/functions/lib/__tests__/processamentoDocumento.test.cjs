// Grupo Documentos: menu de processamento por tipo de documento (lib/processamentoDocumento.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const p = require('../processamentoDocumento')

const etapa = { id: 'e1', tipo: 'etapa', obrigacaoId: 'o1', clienteId: 'c1', clienteNome: 'Loja X', rotulo: 'PGDAS 10/2026 — etapa "Enviar guia"' }
const tarefa = { id: 't1', tipo: 'tarefa', clienteId: 'c1', clienteNome: 'Loja X', rotulo: 'Tarefa: pagar FGTS' }
const acoes = (ops) => ops.map((o) => o.acao)

test('categoria pela IA ou, sem ela, pelo tipo e nome do arquivo', () => {
  assert.equal(p.categoriaDoDocumento({ categoria: 'cnd' }), 'cnd')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Declaração do Simples Nacional (PGDAS-D)' }), 'declaracao_simples')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Certidão Negativa de Débitos Municipal' }), 'cnd')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Relatório de Situação Fiscal' }), 'situacao_fiscal')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'DAS de PARCMEI' }), 'parcelamento')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Guia do FGTS' }), 'guia')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Boleto bancário' }), 'guia')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Contrato social' }), 'outro')
  assert.equal(p.categoriaDoDocumento({ tipoDocumento: 'Documento não identificado', nomeArquivo: 'CND federal.pdf' }), 'cnd')
})

test('menu por tipo: Simples, CND, Situação Fiscal e parcelamento vêm primeiro', () => {
  assert.deepEqual(acoes(p.montarOpcoes({ categoria: 'declaracao_simples' })), ['simples', 'painel', 'tarefa', 'arquivar'])
  assert.deepEqual(acoes(p.montarOpcoes({ categoria: 'cnd' })), ['cnd', 'painel', 'tarefa', 'arquivar'])
  assert.match(p.montarOpcoes({ categoria: 'situacao_fiscal' })[0].rotulo, /Situação Fiscal/)
  assert.deepEqual(acoes(p.montarOpcoes({ categoria: 'parcelamento', candidato: etapa })), ['parcelamento', 'baixa', 'painel', 'tarefa', 'arquivar'])
  assert.deepEqual(p.montarOpcoes({ categoria: 'outro' }).map((o) => o.n), [1, 2, 3])
})

test('PDF é exigido para ler Simples, CND e parcelamento', () => {
  assert.deepEqual(acoes(p.montarOpcoes({ categoria: 'declaracao_simples', pdf: false })), ['painel', 'tarefa', 'arquivar'])
})

test('guia: baixa na sugerida e nas outras em aberto da empresa (até 3)', () => {
  const outras = [etapa, tarefa, { ...tarefa, id: 't2' }, { ...tarefa, id: 't3' }]
  const ops = p.montarOpcoes({ categoria: 'guia', candidato: tarefa, candidatosDoCliente: outras })
  assert.deepEqual(acoes(ops), ['baixa', 'baixa', 'baixa', 'painel', 'tarefa', 'arquivar'])
  assert.deepEqual(ops.slice(0, 3).map((o) => o.alvo.id), ['t1', 'e1', 't2'])
  assert.equal(ops[1].alvo.obrigacaoId, 'o1')
  assert.match(ops[0].rotulo, /pagar FGTS \(Loja X\)/)
  assert.equal(ops.find((o) => o.acao === 'painel').fixo, false)
  // documento comum: só a sugerida
  assert.deepEqual(acoes(p.montarOpcoes({ categoria: 'outro', candidato: tarefa, candidatosDoCliente: outras })), ['baixa', 'painel', 'tarefa', 'arquivar'])
})

test('texto do menu numerado', () => {
  const txt = p.textoMenu(p.montarOpcoes({ categoria: 'cnd' }))
  assert.match(txt, /\*1\* 🧾 Anexar a CND/)
  assert.match(txt, /\*4\* 🗄️ Só arquivar/)
  assert.match(txt, /"3 pedir extrato"/)
})

test('escolha pelo número, com empresa ou descrição junto', () => {
  const ops = p.montarOpcoes({ categoria: 'declaracao_simples' })
  assert.equal(p.lerEscolha('1', ops).opcao.acao, 'simples')
  assert.deepEqual(p.lerEscolha(' 1 - Amanda Lima ', ops).complemento, 'Amanda Lima')
  const t = p.lerEscolha('3) pedir   extrato ao cliente', ops)
  assert.equal(t.opcao.acao, 'tarefa')
  assert.equal(t.complemento, 'pedir extrato ao cliente')
  assert.equal(p.lerEscolha('4', ops).opcao.acao, 'arquivar')
})

test('escolha pela palavra, mesmo fora do menu', () => {
  const ops = p.montarOpcoes({ categoria: 'outro', candidato: tarefa })
  assert.equal(p.lerEscolha('baixa', ops).opcao.alvo.id, 't1')
  assert.equal(p.lerEscolha('Dar baixa', ops).opcao.acao, 'baixa')
  assert.equal(p.lerEscolha('simples', ops).opcao.acao, 'simples')
  assert.equal(p.lerEscolha('CND loja x', ops).complemento, 'loja x')
  assert.equal(p.lerEscolha('tarefa: ligar pro João', ops).complemento, 'ligar pro João')
  assert.equal(p.lerEscolha('arquivar', ops).opcao.acao, 'arquivar')
  // sem obrigação sugerida, "baixa" não tem o que baixar
  assert.equal(p.lerEscolha('baixa', p.montarOpcoes({ categoria: 'outro' })), null)
})

test('conversa comum não é escolha', () => {
  const ops = p.montarOpcoes({ categoria: 'guia', candidato: tarefa })
  for (const t of ['', 'ok', 'bom dia', '12', '10 reais', '1ª via', '2x', '1.500', '10/11', 'tarefas de hoje', 'arquivos novos', '4 guias anexas', '1 guia anexa']) {
    const r = p.lerEscolha(t, ops)
    assert.ok(r === null || (t === '1 guia anexa' && r === null), `${t} → ${JSON.stringify(r)}`)
  }
})
