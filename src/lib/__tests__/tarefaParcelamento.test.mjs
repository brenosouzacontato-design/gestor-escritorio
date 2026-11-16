// Parcelamento novo cria a tarefa da empresa (src/lib/guiaParcelamento.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tarefaDoParcelamento, criarTarefaParcelamento } from '../guiaParcelamento.js';

const dados = { origem: 'PARCMEI', conta: '123456', parcela: 1, totalParcelas: 60, valor: 82.5, vencimento: '2026-11-30' };

test('tarefa do parcelamento: título, observação e vencimento da guia', () => {
  const t = tarefaDoParcelamento(dados);
  assert.equal(t.titulo, 'Parcelamento PARCMEI nº 123456 em 60 parcelas: acompanhar e enviar as guias');
  assert.match(t.observacao, /parcela 1\/60/);
  assert.match(t.observacao, /R\$ 82,50/);
  assert.equal(t.vencimento, '2026-11-30');
});

test('sem empresa (avulso) não cria tarefa; com empresa grava na tabela tarefas', async () => {
  const gravado = [];
  const supabase = { from: (tabela) => ({ insert: (v) => { gravado.push({ tabela, v }); return { select: () => ({ single: async () => ({ data: { id: 't1', titulo: v.titulo }, error: null }) }) }; } }) };
  assert.equal(await criarTarefaParcelamento(supabase, dados, null), null);
  const t = await criarTarefaParcelamento(supabase, dados, 'cli-1');
  assert.equal(t.id, 't1');
  assert.equal(gravado[0].tabela, 'tarefas');
  assert.equal(gravado[0].v.cliente_id, 'cli-1');
  assert.equal(gravado[0].v.concluida, false);
});
