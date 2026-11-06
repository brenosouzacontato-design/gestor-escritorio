import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trilhaEmpresa, situacaoEntregaGuia, guiasPorEmpresa, contagemEtapas } from '../trilhaFechamento.js'

const ob = (status) => ({ status })

test('nada feito fica em Geradas; sem obrigação marca vazia', () => {
  assert.equal(trilhaEmpresa({ obrigacoes: [ob('pendente')] }).etapa, 0)
  const vazia = trilhaEmpresa({})
  assert.equal(vazia.etapa, 0)
  assert.equal(vazia.vazia, true)
})

test('alguma concluída vai pra Em andamento; aguardando cliente tem prioridade', () => {
  const obs = [ob('concluido'), ob('pendente'), ob('vencido')]
  const t = trilhaEmpresa({ obrigacoes: obs })
  assert.equal(t.etapa, 1)
  assert.equal(t.feitas, 1)
  assert.equal(t.vencidas, 1)
  assert.equal(trilhaEmpresa({ obrigacoes: obs, aguardando: true }).etapa, 2)
})

test('tudo concluído sem guia entregue fica em Concluído', () => {
  const obs = [ob('concluido'), ob('nao_aplica')]
  assert.equal(trilhaEmpresa({ obrigacoes: obs, guias: [{ entregue_em: null }] }).etapa, 3)
  // sem guia anexada e sem marcação manual: ainda Concluído
  assert.equal(trilhaEmpresa({ obrigacoes: obs }).etapa, 3)
})

test('todas as guias enviadas vão pra Guias entregues; uma aberta vai pra Cliente abriu', () => {
  const obs = [ob('concluido')]
  const enviadas = [{ entregue_em: '2026-11-04' }, { entregue_em: '2026-11-04' }]
  assert.equal(trilhaEmpresa({ obrigacoes: obs, guias: enviadas }).etapa, 4)
  const umaAberta = [{ entregue_em: '2026-11-04', aberto_em: '2026-11-05' }, { entregue_em: '2026-11-04' }]
  const t = trilhaEmpresa({ obrigacoes: obs, guias: umaAberta })
  assert.equal(t.etapa, 5)
  assert.equal(t.guiasAbertas, 1)
  assert.equal(t.guiasEnviadas, 2)
})

test('marcado concluído à mão sem guia conta como entregue e ignora aguardando', () => {
  const t = trilhaEmpresa({ obrigacoes: [ob('pendente')], marcadoConcluido: true, aguardando: true })
  assert.equal(t.etapa, 4)
  assert.equal(t.aguardando, false)
})

test('situação da guia e agrupamentos', () => {
  assert.equal(situacaoEntregaGuia({ aberto_em: 'x', entregue_em: 'x' }), 'aberta')
  assert.equal(situacaoEntregaGuia({ entregue_em: 'x' }), 'entregue')
  assert.equal(situacaoEntregaGuia({ entrega_erro: 'número inválido' }), 'falhou')
  assert.equal(situacaoEntregaGuia({}), 'a_entregar')
  const mapa = guiasPorEmpresa([{ cliente_id: 'a' }, { cliente_id: 'a' }, { cliente_id: 'b' }, {}])
  assert.equal(mapa.a.length, 2)
  assert.equal(mapa.b.length, 1)
  assert.deepEqual(contagemEtapas([{ etapa: 0 }, { etapa: 5 }, { etapa: 5 }]), [1, 0, 0, 0, 0, 2])
})
