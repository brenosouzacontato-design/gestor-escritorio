// consolidadoGrupo.js
// Aba "Consolidado" do painel de grupo (ConsolidadoGrupo.jsx): resume cada
// empresa com as mesmas regras do painel dela (painelRegras.js) e soma o
// grupo. Sem React nem banco — testes em src/lib/__tests__/consolidadoGrupo.test.mjs.
//
// O que o escritório escondeu no painel de uma empresa (seção ou item, em
// painel_secoes_ocultas) também fica de fora do consolidado: o cliente não
// teria como conferir um total com coisas que ele não vê.

import {
  competenciaOrdinal, somaValores, temValor, montarHonorarios, montarPendencias,
  indicadoresPainel, situacaoFiscalGeral,
} from './painelRegras.js';

const ESFERAS = ['federal', 'estadual', 'municipal'];

// Nomes herdados da sincronização com o ERP vêm com o CNPJ na frente
// ("48.976.362 AMANDA LIMA GONCALVES") — mostra só o nome.
export const nomeCurtoEmpresa = (nome) => (nome || '').replace(/^[\d./-]+\s+/, '');

// dados: o que o painel da empresa carrega (carregarEmpresaConsolidado em ConsolidadoGrupo.jsx):
//   { cliente: { nome, cnpj, regime, painel_secoes_ocultas }, guias, gerenciais, historico,
//     situacaoFiscal, cndManual, honorarios }
// `id` é o que a barra do grupo usa pra abrir a empresa (token no link público).
export function resumirEmpresa(id, dados) {
  const secoesOcultas = dados.cliente?.painel_secoes_ocultas || [];
  const oculta = (chave) => secoesOcultas.includes(chave);
  const itemOculto = (itemId) => secoesOcultas.includes(`item:${itemId}`);

  const pendencias = montarPendencias(dados.situacaoFiscal).filter((p) => !itemOculto(p.chave));
  const honorarios = montarHonorarios(dados.honorarios);
  const ind = indicadoresPainel({ guias: dados.guias, honorarios, pendencias, oculta, itemOculto });

  // Faturamento / DAS da Declaração do Simples — só se o cliente vê os números
  const g = !oculta('kpis') ? dados.gerenciais : null;
  const num = (v) => (v == null ? null : Number(v));
  const faturamento = num(g?.faturamento_periodo);
  const semMovimento = faturamento === 0;

  // Certidões: situação vigente de cada esfera (vencida conta à parte)
  const cnd = dados.cndManual && !oculta('certidoes') ? dados.cndManual : null;
  const certidoes = Object.fromEntries(ESFERAS.map((e) => [e,
    !cnd || !(cnd[`situacao_${e}`] || cnd[`anexo_${e}_path`]) ? null
      : cnd[`vencida_${e}`] ? 'vencida' : cnd[`situacao_${e}`] || 'regular',
  ]));

  // Impostos em aberto (a lista que o cliente vê), com o nome da empresa
  const guiasAbertas = oculta('impostos') ? [] : ind.guiasEmAberto.map((gu) => ({ ...gu, empresaId: id }));

  return {
    id,
    nome: nomeCurtoEmpresa(dados.cliente?.nome),
    cnpj: dados.cliente?.cnpj || null,
    regime: dados.cliente?.regime || null,
    competenciaDeclaracao: g ? g.competencia || null : null,
    faturamento,
    rbt12: num(g?.rbt12),
    das: semMovimento ? 0 : num(g?.valor_das),
    aliquota: semMovimento ? null : num(g?.aliquota_efetiva),
    semMovimento,
    vencidos: { qtd: ind.vencidos.length, valor: somaValores(ind.vencidos), temValor: temValor(ind.vencidos), semValor: ind.vencidos.some((v) => v.valor == null) },
    aVencer: {
      qtd: ind.aVencer.length, valor: somaValores(ind.aVencer), temValor: temValor(ind.aVencer), semValor: ind.aVencer.some((v) => v.valor == null),
      proximo: ind.aVencer.find((v) => v.vencimento && v.dias >= 0)?.vencimento || null,
    },
    guiasAbertas,
    situacao: oculta('certidoes') && oculta('pendencias') ? null : situacaoFiscalGeral({
      situacaoFiscal: oculta('pendencias') ? null : dados.situacaoFiscal,
      cndManual: cnd,
      soAVencer: pendencias.length > 0 && pendencias.every((p) => p.aVencer),
    }),
    certidoes,
    historico: oculta('grafico') ? [] : (dados.historico || []),
  };
}

// Soma do grupo. resumos: [resumirEmpresa(...)]
export function consolidarGrupo(resumos) {
  const lista = resumos || [];
  const comDeclaracao = lista.filter((r) => r.faturamento != null);
  const faturamento = comDeclaracao.reduce((s, r) => s + r.faturamento, 0);
  const das = comDeclaracao.reduce((s, r) => s + (r.das || 0), 0);

  // Evolução do faturamento do grupo: soma por competência (últimos 12 meses).
  // Mês em que nem toda empresa tem declaração fica marcado como parcial.
  const porComp = new Map();
  for (const r of lista) {
    for (const h of r.historico) {
      if (h.faturamento_periodo == null) continue;
      const atual = porComp.get(h.competencia) || { competencia: h.competencia, faturamento_periodo: 0, empresas: 0 };
      atual.faturamento_periodo += Number(h.faturamento_periodo);
      atual.empresas += 1;
      porComp.set(h.competencia, atual);
    }
  }
  const empresasComHistorico = lista.filter((r) => r.historico.length > 0).length;
  const historico = [...porComp.values()]
    .sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia))
    .slice(-12)
    .map((h) => ({ ...h, parcial: h.empresas < empresasComHistorico }));

  const guiasAbertas = lista.flatMap((r) => r.guiasAbertas.map((g) => ({ ...g, empresa: r.nome })))
    .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
  const somaCard = (campo) => ({
    qtd: lista.reduce((s, r) => s + r[campo].qtd, 0),
    valor: lista.reduce((s, r) => s + r[campo].valor, 0),
    temValor: lista.some((r) => r[campo].temValor),
    semValor: lista.some((r) => r[campo].semValor),
    empresas: lista.filter((r) => r[campo].qtd > 0).length,
  });
  const proximos = lista.map((r) => r.aVencer.proximo).filter(Boolean).sort();

  return {
    empresas: lista.length,
    comDeclaracao: comDeclaracao.length,
    faturamento: comDeclaracao.length ? faturamento : null,
    das: comDeclaracao.length ? das : null,
    // alíquota efetiva do grupo = DAS total / faturamento total
    aliquota: faturamento > 0 ? (das / faturamento) * 100 : null,
    vencidos: somaCard('vencidos'),
    aVencer: { ...somaCard('aVencer'), proximo: proximos[0] || null },
    guiasAbertas,
    comPendencia: lista.filter((r) => r.situacao === 'pendente').length,
    regulares: lista.filter((r) => r.situacao === 'regular').length,
    historico,
  };
}
