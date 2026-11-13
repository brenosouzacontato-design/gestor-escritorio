// Grupo Documentos: extrato bancário → "importar? sim / não" (lib/extratoWhatsapp.js)
const test = require('node:test')
const assert = require('node:assert/strict')
const x = require('../extratoWhatsapp')

const clientes = [
  { id: 'amanda', nome: '48.976.362 AMANDA LIMA GONCALVES', cnpj: '48976362000149' },
  { id: 'zap', nome: 'ZAP BURGUER LTDA', cnpj: '11222333000144' },
  { id: 'tempero', nome: 'TEMPERO DE FAMILIA', cnpj: '55666777000188' },
  { id: 'cida', nome: 'CIDA BURGUER', cnpj: null },
]

test('"sim" importa, com ou sem empresa junto', () => {
  assert.deepEqual(x.lerRespostaExtrato('sim'), { acao: 'importar', empresa: null })
  assert.deepEqual(x.lerRespostaExtrato(' Sim! '), { acao: 'importar', empresa: null })
  assert.deepEqual(x.lerRespostaExtrato('s'), { acao: 'importar', empresa: null })
  assert.deepEqual(x.lerRespostaExtrato('pode importar'), { acao: 'importar', empresa: null })
  assert.deepEqual(x.lerRespostaExtrato('sim, pode'), { acao: 'importar', empresa: null })
  assert.deepEqual(x.lerRespostaExtrato('sim amanda lima'), { acao: 'importar', empresa: 'amanda lima' })
  assert.deepEqual(x.lerRespostaExtrato('Sim - Zap Burguer'), { acao: 'importar', empresa: 'Zap Burguer' })
})

test('"não" recusa; conversa comum e "1/2" não respondem a pergunta do extrato', () => {
  for (const t of ['não', 'nao', 'N', 'não importar', 'Não!']) assert.deepEqual(x.lerRespostaExtrato(t), { acao: 'recusar' }, t)
  for (const t of ['', '1', '2', 'simples nacional', 'sinal verde', 'nada', 'bom dia', 'ok', 'ok?x']) assert.equal(x.lerRespostaExtrato(t), null, t)
})

test('empresa do extrato pelo CNPJ, pela raiz do CNPJ (MEI) e pelo nome do titular', () => {
  assert.equal(x.acharEmpresaDoExtrato({ titularDocumento: '48.976.362/0001-49' }, clientes)?.id, 'amanda')
  assert.equal(x.acharEmpresaDoExtrato({ titularDocumento: '48.976.362' }, clientes)?.id, 'amanda')
  assert.equal(x.acharEmpresaDoExtrato({ titularNome: 'Amanda Lima Gonçalves' }, clientes)?.id, 'amanda')
  assert.equal(x.acharEmpresaDoExtrato({ titularNome: 'ZAP BURGUER LTDA' }, clientes)?.id, 'zap')
})

test('sem certeza não chuta; cai no cliente sugerido pela identificação', () => {
  assert.equal(x.acharEmpresaDoExtrato({ titularNome: 'Burguer' }, clientes), null)
  assert.equal(x.acharEmpresaDoExtrato({ titularNome: 'Fulano de Tal' }, clientes), null)
  assert.equal(x.acharEmpresaDoExtrato({ titularNome: 'Fulano de Tal' }, clientes, 'tempero')?.id, 'tempero')
  assert.equal(x.acharEmpresaDoExtrato(null, clientes, 'nao-existe'), null)
})

test('empresa digitada junto do "sim": nome parcial ou CNPJ', () => {
  assert.equal(x.acharEmpresaPorTexto('amanda', clientes)?.id, 'amanda')
  assert.equal(x.acharEmpresaPorTexto('cida burguer', clientes)?.id, 'cida')
  assert.equal(x.acharEmpresaPorTexto('11.222.333/0001-44', clientes)?.id, 'zap')
  assert.equal(x.acharEmpresaPorTexto('burguer', clientes), null) // duas empresas
  assert.equal(x.acharEmpresaPorTexto('', clientes), null)
})

test('pergunta com e sem empresa identificada', () => {
  const ext = { banco: 'Nubank', titularNome: 'AMANDA', periodoInicio: '2026-09-01', periodoFim: '2026-09-30' }
  const com = x.perguntaExtrato(ext, clientes[0])
  assert.match(com, /Extrato bancário\* — Nubank/)
  assert.match(com, /01\/09\/2026 a 30\/09\/2026/)
  assert.match(com, /AMANDA LIMA GONCALVES/)
  assert.match(com, /\*sim\*/)
  const sem = x.perguntaExtrato(ext, null)
  assert.match(sem, /Não identifiquei a empresa \(titular no extrato: AMANDA\)/)
  assert.match(sem, /sim Amanda Lima/)
})

test('resumo da importação traz lançamentos, pendentes, saldo e o envio ao OneFlow', () => {
  const msg = x.resultadoImportacao(clientes[0], {
    contaBanco: { codigo: '1.1.01.003.001', nome: 'Nubank' }, contaBancoCriada: false,
    periodo: { dataInicio: '2026-09-01', dataFim: '2026-09-30' },
    criados: 118, pulados: 1, classificadas: 50, pendentes: 69, totalEntradas: 1000, totalSaidas: 400.5,
    planoCriado: false, avisos: [],
  })
  assert.match(msg, /118 lançamentos gerados \(1 já tinha sido importado\)/)
  assert.match(msg, /50 classificados pelas regras · ⏳ 69 em Valores a Identificar/)
  assert.match(msg, /\*Saldo do período: R\$\s599,50\*/)
  assert.match(msg, /Identifique os 69 pendentes/)
  assert.match(msg, /2\. Lance no OneFlow/)
  assert.doesNotMatch(msg, /DRE do período/)
})
