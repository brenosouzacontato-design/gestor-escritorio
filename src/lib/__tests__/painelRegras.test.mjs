// Regras do painel do cliente (src/pages/painel/painelRegras.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guiaSaiDaLista, filtrarOutrasCompetencias, montarGuias, indicadoresPainel } from '../../pages/painel/painelRegras.js';

const COMP = '10/2026';

test('guia paga continua na lista, da competência ou de competência anterior', () => {
  assert.equal(guiaSaiDaLista({ paga: true, competencia: '10/2026', dias: -3, concluida: true }, COMP), false);
  assert.equal(guiaSaiDaLista({ paga: true, competencia: '09/2026', dias: -30, concluida: true }, COMP), false);
  // em aberto continua; concluída e vencida sem pagamento (baixa do escritório) sai, como antes
  assert.equal(guiaSaiDaLista({ paga: false, competencia: '09/2026', dias: -30 }, COMP), false);
  assert.equal(guiaSaiDaLista({ paga: false, concluida: true, competencia: COMP, dias: -2 }, COMP), true);
  assert.equal(guiaSaiDaLista({ paga: false, concluida: true, competencia: COMP, dias: 5 }, COMP), false);
});

test('do banco até a lista: guias pagas (da competência e anteriores que vencem na janela) ficam com o comprovante', () => {
  const imp = { eh_imposto: true };
  const impostos = [
    { id: 'das10', titulo: 'PGDAS', tipo: 'PGDAS', status: 'concluido', competencia: '10/2026', vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'das09', titulo: 'PGDAS', tipo: 'PGDAS', status: 'concluido', competencia: '09/2026', vencimento: '2026-10-20', tipos_obrigacao: imp },
    { id: 'fgts09', titulo: 'FGTS', tipo: 'FGTS', status: 'vencido', competencia: '09/2026', vencimento: '2026-10-20', tipos_obrigacao: imp },
  ];
  const anexos = {
    das10: { id: 'a1', valor_guia: 500, pago_em: '2026-11-10T10:00:00Z', comprovante_path: 'comp/das10.pdf', comprovante_nome: 'comprovante.pdf' },
    das09: { id: 'a2', valor_guia: 480, pago_em: '2026-10-15T10:00:00Z', comprovante_path: 'comp/das09.pdf' },
    fgts09: { id: 'a3', valor_guia: 120, pago_em: null },
  };
  const { impostos: visiveis } = filtrarOutrasCompetencias({ impostos, outrasObrigacoes: [], tarefasArea: [], anexos }, COMP);
  const guias = montarGuias({ impostos: visiveis, anexos, gerenciais: null }, COMP);
  const naLista = guias.filter((g) => !guiaSaiDaLista(g, COMP));
  assert.deepEqual(naLista.map((g) => g.id).sort(), ['das09', 'das10', 'fgts09']);
  const das09 = naLista.find((g) => g.id === 'das09');
  assert.equal(das09.paga, true);
  assert.equal(das09.anexo.comprovante_path, 'comp/das09.pdf');
  const das10 = naLista.find((g) => g.id === 'das10');
  assert.equal(das10.paga, true);
  assert.equal(das10.anexo.comprovante_path, 'comp/das10.pdf');
  // paga não entra nos totais de vencidos / a vencer nem no total em aberto
  const ind = indicadoresPainel({ guias, honorarios: [], pendencias: [] });
  assert.deepEqual(ind.guiasEmAberto.map((g) => g.id), ['fgts09']);
  assert.ok(!ind.aVencer.some((g) => g.id === 'das10'));
});
