// carneLeao.js
//
// Quanto o prestador de serviço pagaria se recebesse como PESSOA FÍSICA
// (autônomo, recolhendo carnê-leão) em vez de pela empresa — usado no
// comparativo "PJ x PF" do painel do cliente (só nos clientes em que o
// escritório liga a seção; ver PainelCompartilhadoPage.jsx).
//
// Premissas (estimativa, não substitui o Carnê-Leão Web):
//  - toda a receita do mês recebida de pessoas físicas (pacientes/clientes);
//  - INSS como contribuinte individual: 20% sobre a receita, entre o salário
//    mínimo e o teto do INSS;
//  - base do IR = receita − INSS, ou receita − desconto simplificado mensal,
//    o que for mais vantajoso (sem despesas de livro-caixa nem dependentes);
//  - tabela progressiva mensal + redução da Lei 15.270/2025 (a partir de
//    01/2026: imposto zero até R$ 5.000,00 de rendimentos no mês, redução
//    decrescente até R$ 7.350,00);
//  - não inclui ISS de autônomo (valor fixo do município).
//
// Revisar os valores abaixo quando a tabela do IR, o teto do INSS ou o
// salário mínimo mudarem.

export const PARAMETROS_PF = {
  ano: 2026,
  // tabela progressiva mensal (Lei 15.191/2025, desde 05/2025): [até, alíquota, parcela a deduzir]
  tabelaIr: [
    [2428.80, 0, 0],
    [2826.65, 0.075, 182.16],
    [3751.05, 0.15, 394.16],
    [4664.68, 0.225, 675.49],
    [Infinity, 0.275, 908.73],
  ],
  descontoSimplificado: 607.20,
  // Lei 15.270/2025 — redução do imposto mensal
  reducaoAte: 5000.00, // até aqui o imposto zera (redução de até R$ 312,89)
  reducaoLimite: 7350.00, // acima disso não há redução
  reducaoFixa: 978.62,
  reducaoFator: 0.133145,
  // INSS contribuinte individual (Portaria MPS/MF 13/2026)
  inssAliquota: 0.20,
  inssTeto: 8475.55,
  salarioMinimo: 1621.00,
};

const r2 = (v) => Math.round(v * 100) / 100;

export function irTabelaMensal(base, p = PARAMETROS_PF) {
  if (!(base > 0)) return 0;
  const [, aliquota, deduzir] = p.tabelaIr.find(([ate]) => base <= ate);
  return Math.max(0, base * aliquota - deduzir);
}

// redução da Lei 15.270/2025, sobre os rendimentos tributáveis do mês
export function reducaoLei15270(rendimentos, imposto, p = PARAMETROS_PF) {
  if (rendimentos <= p.reducaoAte) return imposto;
  if (rendimentos <= p.reducaoLimite) return Math.min(imposto, Math.max(0, p.reducaoFixa - p.reducaoFator * rendimentos));
  return 0;
}

export function calcularPessoaFisica(receita, p = PARAMETROS_PF) {
  const bruto = Number(receita) || 0;
  if (bruto <= 0) return null;
  const inss = r2(p.inssAliquota * Math.min(Math.max(bruto, p.salarioMinimo), p.inssTeto));
  const deducao = Math.max(inss, p.descontoSimplificado);
  const usouSimplificado = p.descontoSimplificado > inss;
  const base = Math.max(0, bruto - deducao);
  const irTabela = irTabelaMensal(base, p);
  const reducao = reducaoLei15270(bruto, irTabela, p);
  const irpf = r2(Math.max(0, irTabela - reducao));
  const total = r2(irpf + inss);
  return {
    receita: r2(bruto), inss, base: r2(base), usouSimplificado,
    irTabela: r2(irTabela), reducao: r2(reducao), irpf, total,
    aliquotaEfetiva: (total / bruto) * 100,
  };
}
