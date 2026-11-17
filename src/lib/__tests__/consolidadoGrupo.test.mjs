// Aba Consolidado do painel de grupo (src/pages/painel/consolidadoGrupo.js):
// cada empresa resumida com as regras do painel dela e o grupo somado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumirEmpresa, consolidarGrupo, nomeCurtoEmpresa } from '../../pages/painel/consolidadoGrupo.js';
import { montarGuias, indicadoresPainel, montarHonorarios, montarPendencias } from '../../pages/painel/painelRegras.js';

const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const COMP = '10/2026';
const obrig = (id, titulo, vencimento, status = 'pendente') => ({ id, titulo, tipo: titulo, status, vencimento, competencia: COMP, tipos_obrigacao: { eh_imposto: true } });
const anexo = (id, valor, extra = {}) => ({ id: `a-${id}`, obrigacao_id: id, valor_guia: valor, pago_em: null, ...extra });

function empresaA() {
  const impostos = [obrig('das', 'PGDAS', dia(-5)), obrig('fgts', 'FGTS', dia(10)), obrig('inss', 'INSS MENSAL', dia(2))];
  const anexos = { das: anexo('das', 300), fgts: anexo('fgts', 120), inss: anexo('inss', 80, { pago_em: '2026-11-01' }) };
  const gerenciais = { competencia: COMP, faturamento_periodo: 10000, rbt12: 100000, aliquota_efetiva: 6, valor_das: 600 };
  return {
    cliente: { nome: '11.222.333 LOJA A LTDA', cnpj: '11.222.333/0001-81', regime: 'SN', painel_secoes_ocultas: [] },
    guias: montarGuias({ impostos, anexos, gerenciais }, COMP),
    gerenciais,
    historico: [{ competencia: '09/2026', faturamento_periodo: 9000 }, { competencia: '10/2026', faturamento_periodo: 10000 }],
    situacaoFiscal: null,
    cndManual: { situacao_federal: 'regular', anexo_federal_path: 'x', situacao_estadual: 'pendente', anexo_estadual_path: 'y', vencida_federal: false },
    honorarios: [{ id: 'h1', competencia: COMP, vencimento: dia(-1), status: 'pendente', valor: 500, tipo: 'mensal' }],
  };
}
function empresaB() {
  const impostos = [obrig('iss', 'ISS', dia(5))];
  const anexos = { iss: anexo('iss', 50) };
  const gerenciais = { competencia: COMP, faturamento_periodo: 5000, rbt12: 60000, aliquota_efetiva: 4, valor_das: 200 };
  return {
    cliente: { nome: 'EMPRESA B', painel_secoes_ocultas: ['honorarios'] },
    guias: montarGuias({ impostos, anexos, gerenciais }, COMP),
    gerenciais, historico: [{ competencia: '10/2026', faturamento_periodo: 5000 }],
    situacaoFiscal: null, cndManual: null,
    honorarios: [{ id: 'h2', competencia: COMP, vencimento: dia(-3), status: 'pendente', valor: 999 }],
  };
}

test('resumo da empresa bate com os cartões do painel dela', () => {
  const dados = empresaA();
  const r = resumirEmpresa('tokA', dados);
  const ind = indicadoresPainel({ guias: dados.guias, honorarios: montarHonorarios(dados.honorarios), pendencias: montarPendencias(null) });
  assert.equal(r.vencidos.valor, ind.vencidos.reduce((s, v) => s + v.valor, 0));
  assert.equal(r.vencidos.valor, 300 + 500); // DAS vencido + honorário atrasado
  assert.equal(r.aVencer.valor, 120); // FGTS; INSS já pago não conta
  assert.equal(r.aVencer.proximo, dia(10));
  assert.equal(r.nome, 'LOJA A LTDA');
  assert.equal(r.faturamento, 10000);
  assert.equal(r.das, 600);
  assert.equal(r.situacao, 'pendente'); // CND estadual com pendência
  assert.deepEqual(r.certidoes, { federal: 'regular', estadual: 'pendente', municipal: null });
  assert.deepEqual(r.guiasAbertas.map((g) => g.id), ['das', 'fgts']);
});

test('o que o escritório escondeu do cliente fica fora do consolidado', () => {
  const b = resumirEmpresa('tokB', empresaB());
  assert.equal(b.vencidos.qtd, 0); // honorário vencido oculto
  const dados = empresaA();
  dados.cliente.painel_secoes_ocultas = ['kpis', 'item:das', 'certidoes'];
  const a = resumirEmpresa('tokA', dados);
  assert.equal(a.faturamento, null);
  assert.equal(a.vencidos.valor, 500); // só o honorário: DAS oculto
  assert.deepEqual(a.guiasAbertas.map((g) => g.id), ['fgts']);
  assert.equal(a.certidoes.estadual, null);
});

test('grupo somado', () => {
  const t = consolidarGrupo([resumirEmpresa('tokA', empresaA()), resumirEmpresa('tokB', empresaB())]);
  assert.equal(t.empresas, 2);
  assert.equal(t.faturamento, 15000);
  assert.equal(t.das, 800);
  assert.ok(Math.abs(t.aliquota - (800 / 15000) * 100) < 1e-9);
  assert.equal(t.vencidos.valor, 800);
  assert.equal(t.vencidos.empresas, 1);
  assert.equal(t.aVencer.valor, 120 + 50);
  assert.equal(t.aVencer.proximo, dia(5));
  assert.deepEqual(t.guiasAbertas.map((g) => [g.id, g.empresa]), [['das', 'LOJA A LTDA'], ['iss', 'EMPRESA B'], ['fgts', 'LOJA A LTDA']]);
  assert.deepEqual(t.historico, [
    { competencia: '09/2026', faturamento_periodo: 9000, empresas: 1, parcial: true },
    { competencia: '10/2026', faturamento_periodo: 15000, empresas: 2, parcial: false },
  ]);
  assert.equal(t.comPendencia, 1);
});

test('grupo sem declaração e nome sem CNPJ na frente', () => {
  const d = empresaB(); d.gerenciais = null;
  const t = consolidarGrupo([resumirEmpresa('x', d)]);
  assert.equal(t.faturamento, null);
  assert.equal(t.aliquota, null);
  assert.equal(nomeCurtoEmpresa('48.976.362 AMANDA LIMA'), 'AMANDA LIMA');
});
