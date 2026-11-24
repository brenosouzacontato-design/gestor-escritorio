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
  // guia anexada, concluída e vencida sem pagamento registrado continua (DAS/INSS da 10 entregues, vencidos em 20/11)
  assert.equal(guiaSaiDaLista({ paga: false, concluida: true, competencia: COMP, dias: -4, anexo: { id: 'g' } }, COMP), false);
});

test('do banco até a lista: só as guias da competência do painel; as da 09 ficam no painel da 09', () => {
  const imp = { eh_imposto: true };
  const impostos = [
    { id: 'das10', titulo: 'PGDAS', tipo: 'PGDAS', status: 'concluido', competencia: '10/2026', vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'fgts10', titulo: 'FGTS', tipo: 'FGTS', status: 'pendente', competencia: '10/2026', vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'das09', titulo: 'PGDAS', tipo: 'PGDAS', status: 'concluido', competencia: '09/2026', vencimento: '2026-10-20', tipos_obrigacao: imp },
    { id: 'fgts09', titulo: 'FGTS', tipo: 'FGTS', status: 'vencido', competencia: '09/2026', vencimento: '2026-10-20', tipos_obrigacao: imp },
  ];
  const anexos = {
    das10: { id: 'a1', valor_guia: 500, pago_em: '2026-11-10T10:00:00Z', comprovante_path: 'comp/das10.pdf', comprovante_nome: 'comprovante.pdf' },
    fgts10: { id: 'a4', valor_guia: 90, pago_em: null },
    das09: { id: 'a2', valor_guia: 480, pago_em: '2026-10-15T10:00:00Z', comprovante_path: 'comp/das09.pdf' },
    fgts09: { id: 'a3', valor_guia: 120, pago_em: null },
  };
  const { impostos: visiveis } = filtrarOutrasCompetencias({ impostos, outrasObrigacoes: [], tarefasArea: [], anexos }, COMP);
  const guias = montarGuias({ impostos: visiveis, anexos, gerenciais: null }, COMP);
  const naLista = guias.filter((g) => !guiaSaiDaLista(g, COMP));
  // da 09 nenhuma aparece no painel da 10 — nem a paga, nem a em aberto
  assert.deepEqual(naLista.map((g) => g.id).sort(), ['das10', 'fgts10']);
  const das10 = naLista.find((g) => g.id === 'das10');
  assert.equal(das10.paga, true);
  assert.equal(das10.anexo.comprovante_path, 'comp/das10.pdf');
  // no painel da 09 elas continuam lá
  const da09 = filtrarOutrasCompetencias({ impostos, outrasObrigacoes: [], tarefasArea: [], anexos }, '09/2026').impostos;
  assert.deepEqual(da09.map((o) => o.id).sort(), ['das09', 'fgts09']);
  // paga não entra nos totais de vencidos / a vencer nem no total em aberto
  const ind = indicadoresPainel({ guias, honorarios: [], pendencias: [] });
  assert.deepEqual(ind.guiasEmAberto.map((g) => g.id), ['fgts10']);
  assert.ok(!ind.aVencer.some((g) => g.id === 'das10'));
});

test('guia da competência anexada e concluída aparece mesmo vencida sem pagamento; baixa manual vem marcada', () => {
  const imp = { eh_imposto: true };
  const impostos = [
    { id: 'das', titulo: 'PGDAS', tipo: 'PGDAS', status: 'concluido', competencia: COMP, vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'inss', titulo: 'INSS Mensal', tipo: 'INSS MENSAL', status: 'concluido', competencia: COMP, vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'fgts', titulo: 'FGTS', tipo: 'FGTS', status: 'concluido', competencia: COMP, vencimento: '2026-11-20', tipos_obrigacao: imp },
    { id: 'irrf', titulo: 'IRRF', tipo: 'IRRF', status: 'concluido', competencia: COMP, vencimento: '2026-11-20', tipos_obrigacao: imp },
  ];
  const anexos = {
    das: { id: 'a1', valor_guia: 1423.79, pago_em: null },
    inss: { id: 'a2', valor_guia: 178.31, pago_em: '2026-11-19T10:00:00Z', comprovante_path: 'c/inss.pdf' },
    fgts: { id: 'a3', valor_guia: 90, pago_em: '2026-11-18T10:00:00Z', baixa_manual: true, baixa_justificativa: 'Pago pelo app do banco' },
  };
  const guias = montarGuias({ impostos, anexos, gerenciais: null }, COMP);
  const naLista = guias.filter((g) => !guiaSaiDaLista(g));
  // IRRF concluído sem guia anexada nem entra (nada a mostrar); as 3 com guia ficam
  assert.deepEqual(naLista.map((g) => g.id).sort(), ['das', 'fgts', 'inss']);
  const por = Object.fromEntries(naLista.map((g) => [g.id, g]));
  assert.equal(por.das.paga, false);
  assert.equal(por.inss.baixaManual, false);
  assert.equal(por.fgts.baixaManual, true);
  assert.equal(por.fgts.baixaJustificativa, 'Pago pelo app do banco');
});
