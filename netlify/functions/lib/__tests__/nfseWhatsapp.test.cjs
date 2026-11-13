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
  assert.match(pedir('nfse simple maria lima').erro, /Qual o valor/)
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
