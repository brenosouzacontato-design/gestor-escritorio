// Grupo Documentos: comando de emissão de NFS-e para tomadores cadastrados (lib/nfseWhatsapp.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const n = require('../nfseWhatsapp')
const recorrentes = require('../nfse/recorrentes')

const HOJE = '2026-11-13' // sexta-feira
const empresas = [
  { cliente_id: 'c1', nome: 'SIMPLE CARE ODONTOLOGIA LTDA', ambiente: 'producao' },
  { cliente_id: 'c2', nome: 'LANCHONETE BOM SABOR LTDA', ambiente: 'homologacao' },
]
const cadastros = {
  c1: { modelos: [], tomadores: [
    { id: 't1', nome: 'Maria Souza', cpf: '52998224725', apelidos: ['Mãe do João'], valor_padrao: 150, ativo: true },
    { id: 't2', nome: 'Maria Lima', cpf: '11144477735', apelidos: [], valor_padrao: null, ativo: true },
    { id: 't3', nome: 'Carlos Inativo', cpf: '39053344705', apelidos: [], ativo: false },
  ] },
  c2: { modelos: [{ id: 'm1', nome: 'SHOPEE LTDA', cpf: '35635824000112', valor: null, periodicidade: 'semanal', ativo: true, descricao: 'Ponto de coleta {inicio} a {fim}', inicio: '2026-10-05' }], tomadores: [] },
}
const pedir = (t) => n.interpretarPedido(n.lerComandoNfse(t).resto, { empresas, cadastros, hoje: HOJE })

test('reconhece o comando, não conversa', () => {
  for (const t of ['nfse Simple Care Maria 150', 'NFS-e simple', 'emitir nota Simple', 'Emitir uma nota fiscal simple 10', 'nota: simple maria', 'nfse']) assert.ok(n.lerComandoNfse(t), t)
  for (const t of ['nota fiscal chegou?', 'notas de outubro', 'nfses', 'emitir guia', 'a nfse saiu?']) assert.equal(n.lerComandoNfse(t), null, t)
  assert.equal(n.lerComandoNfse('nfse  Simple   Care ').resto, 'Simple Care')
})

test('confirmação', () => {
  for (const t of ['sim', 'S', 'pode emitir', 'emitir!']) assert.equal(n.lerConfirmacao(t), 'sim', t)
  for (const t of ['não', 'nao', 'N', 'cancelar']) assert.equal(n.lerConfirmacao(t), 'nao', t)
  for (const t of ['sim, mas depois', 'simples', 'nada', 'ok']) assert.equal(n.lerConfirmacao(t), null, t)
})

test('data e valor do texto', () => {
  assert.deepEqual(n.extrairDataValor('simple maria 1.250,00 10/11', HOJE), { data: '2026-11-10', valor: '1250.00', resto: 'simple maria' })
  assert.equal(n.extrairDataValor('maria R$ 150', HOJE).valor, '150.00')
  assert.equal(n.extrairDataValor('maria 20/12', HOJE).data, '2025-12-20') // sem ano e no futuro → ano anterior
  assert.equal(n.extrairDataValor('maria 52998224725', HOJE).valor, null) // CPF não é valor
  assert.equal(n.extrairDataValor('maria 31/02', HOJE).data, null)
})

test('tomador cadastrado: empresa e tomador pelo nome, valor do texto ou o padrão', () => {
  const r = pedir('nfse simple care maria souza 200,50')
  assert.equal(r.empresa.cliente_id, 'c1')
  assert.equal(r.tipo, 'tomador')
  assert.equal(r.item.id, 't1')
  assert.equal(r.valor, '200.50')
  assert.equal(pedir('nfse simple mãe do joão').valor, '150.00') // apelido + valor padrão
  assert.equal(pedir('nfse simple 52998224725').item.id, 't1') // pelo CPF
})

test('ambíguo, inexistente, inativo ou sem valor: explica e lista', () => {
  const amb = pedir('nfse simple maria 100')
  assert.match(amb.erro, /Não achei "maria"/)
  assert.deepEqual(amb.lista.itens, ['Maria Souza', 'Maria Lima'])
  assert.match(pedir('nfse simple carlos 100').erro, /Não achei/)
  assert.match(pedir('nfse simple maria lima').erro, /Falta o valor/)
  const semEmpresa = pedir('nfse')
  assert.match(semEmpresa.erro, /Diga de qual empresa/)
  assert.equal(semEmpresa.lista.itens.length, 2)
})

test('recorrente: único cadastro da empresa é usado direto', () => {
  const r = pedir('nfse lanchonete 1.234,56')
  assert.equal(r.tipo, 'recorrente')
  assert.equal(r.item.id, 'm1')
  assert.equal(r.valor, '1234.56')
})

test('semana da recorrente: a da data, senão a última fechada sem nota', () => {
  const semanas = recorrentes.semanasDoModelo(cadastros.c2.modelos[0], [{ data: '2026-11-08', estado: 'autorizada' }], HOJE)
  assert.equal(n.escolherSemana(semanas, null).inicio, '2026-10-27'.replace('27', '26')) // 26/10 a 01/11
  assert.equal(n.escolherSemana(semanas, '2026-11-12').inicio, '2026-11-09')
  const todas = recorrentes.semanasDoModelo({ ...cadastros.c2.modelos[0], inicio: '2026-11-02' }, [{ data: '2026-11-08', estado: 'autorizada' }], HOJE)
  assert.equal(n.escolherSemana(todas, null).inicio, '2026-11-09') // fechadas todas com nota → a em andamento
})

test('prévia', () => {
  const txt = n.previa({ empresa_nome: 'Simple Care', nome: 'Maria Souza', cpf: '52998224725', valor: '150.00', data: '2026-11-13', descricao: 'Consulta', ambiente: 'homologacao' })
  assert.match(txt, /Emitir NFS-e\?/)
  assert.match(txt, /R\$\s150,00/)
  assert.match(txt, /13\/11\/2026/)
  assert.match(txt, /Homologação/)
  assert.match(txt, /\*sim\*/)
})

test('MEI: modelo do Emissor Nacional, pelo tomador ou único da empresa', () => {
  const emp = [...empresas, { cliente_id: 'c3', nome: 'MONICA SILVA', ambiente: 'producao', mei: true }]
  const cad = { ...cadastros, c3: { mei: [{ id: 'mm1', tomador_nome: 'FRIOCARGO TRIANGULO LTDA', tomador_doc: '12149289000194', valor: 8000, descricao: 'prestação de serviços em {mes}.', ativo: true }] } }
  const r = n.interpretarPedido('monica silva', { empresas: emp, cadastros: cad, hoje: HOJE })
  assert.equal(r.tipo, 'mei')
  assert.equal(r.item.nome, 'FRIOCARGO TRIANGULO LTDA')
  assert.equal(r.valor, '8000.00')
  assert.equal(n.interpretarPedido('monica friocargo 7.500,00', { empresas: emp, cadastros: cad, hoje: HOJE }).valor, '7500.00')
  const semModelo = n.interpretarPedido('monica', { empresas: emp, cadastros: { c3: { mei: [] } }, hoje: HOJE })
  assert.match(semModelo.erro, /NFS-e MEI/)
  const txt = n.previa({ tipo: 'mei', empresa_nome: 'MONICA SILVA', nome: 'FRIOCARGO', cpf: '12149289000194', valor: '8000.00', data: HOJE, descricao: 'x', repetida: { status: 'emitida', numero: '12' } })
  assert.match(txt, /Emissor Nacional/)
  assert.match(txt, /Já existe nota igual neste mês\* \(nº 12\)/)
})

test('texto livre: reconhece pedido de nota, não conversa', () => {
  for (const t of ['preciso emitir uma nota pra Maria de 150', 'pode fazer a NF da Shopee?', 'nota fiscal pra Friocargo', 'Emite a NFS-e da Monica', 'gerar nota simple care maria']) assert.ok(n.pareceNfse(t), t)
  for (const t of ['a nota chegou?', 'notas de outubro', 'tarefa: conferir notas', 'nfse simple', 'bom dia', 'emitir guia do DAS']) assert.equal(n.pareceNfse(t), false, t)
})

test('modelo da mensagem preenchido com o que foi entendido', () => {
  const ctx = { empresas, cadastros, hoje: HOJE }
  // tudo entendido (tomador só na Simple Care → empresa deduzida)
  const r1 = n.interpretarPedido('preciso emitir uma nota pra Maria Souza de 200', ctx)
  assert.equal(r1.empresa.cliente_id, 'c1')
  assert.equal(n.modeloMensagem(r1), 'nfse Simple Care Odontologia Maria Souza 200,00')
  const [txt1, mod1] = n.respostaModelo(r1, { textoLivre: true })
  assert.match(txt1, /Entendi um pedido de NFS-e/)
  assert.equal(mod1, 'nfse Simple Care Odontologia Maria Souza 200,00')
  // tomador ambíguo → TOMADOR + lista
  const r2 = n.interpretarPedido('nota pra maria da simple care 100 10/11', ctx)
  const [txt2, mod2] = n.respostaModelo(r2, { textoLivre: true })
  assert.equal(mod2, 'nfse Simple Care Odontologia TOMADOR 100,00 10/11')
  assert.match(txt2, /troque \*TOMADOR\*/)
  assert.match(txt2, /Maria Lima/)
  // sem valor e sem valor padrão → VALOR
  assert.equal(n.modeloMensagem(n.interpretarPedido('emitir nota maria lima', ctx)), 'nfse Simple Care Odontologia Maria Lima VALOR')
  // nada reconhecido → tudo em aberto
  assert.equal(n.modeloMensagem(n.interpretarPedido('preciso de uma nota', ctx)), 'nfse EMPRESA TOMADOR VALOR')
  // empresa com um cadastro só: o tomador nem precisa ir no modelo
  assert.equal(n.modeloMensagem(n.interpretarPedido('nota da lanchonete', ctx)), 'nfse Lanchonete Bom Sabor VALOR')
})

test('o modelo, mandado de volta, é entendido pelo comando', () => {
  const ctx = { empresas, cadastros, hoje: HOJE }
  for (const livre of ['preciso emitir uma nota pra Maria Souza de 200', 'nota da lanchonete 99,90 10/11']) {
    const r = n.interpretarPedido(livre, ctx)
    const de = n.interpretarPedido(n.lerComandoNfse(n.modeloMensagem(r)).resto, ctx)
    assert.equal(de.erro, undefined, livre)
    assert.equal(de.item.id, r.item.id)
    assert.equal(de.valor, r.valor)
    assert.equal(de.data, r.data)
  }
  const [txt] = n.respostaModelo(n.interpretarPedido('simple pedro', ctx))
  assert.match(txt, /troque \*TOMADOR\* e \*VALOR\* e mande/)
})
