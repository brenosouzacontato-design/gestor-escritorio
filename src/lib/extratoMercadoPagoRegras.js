// extratoMercadoPagoRegras.js
//
// Leitura por regra (sem IA) do "Extrato de Vendas" do Mercado Pago — o
// relatório de vendas com valor bruto, taxa e valor líquido de cada
// movimentação. Não é um extrato de conta: "Pagamento" ali é VENDA recebida
// (entrada) e "Reembolso", "Estorno", "Mediação" e "Contestação" vêm com
// valor bruto negativo (dinheiro devolvido). A IA lia "Pagamento" como
// pagamento feito (saída) e a correção por descrição transformava reembolso
// e estorno em entrada — as entradas não batiam com o arquivo (RENATA VAN
// PETTEN, out/2026).
//
// Cada movimentação vira até duas transações no banco Mercado Pago:
//  - o valor bruto: venda (entrada) ou devolução (saída);
//  - a taxa: tarifa cobrada (saída) ou tarifa devolvida no reembolso (entrada).
// Assim a receita fica pelo bruto (o que o arquivo chama de "Vendas totais
// brutas"), a taxa vira despesa e o saldo do banco fecha pelo líquido.
//
// Parte PURA (recebe as linhas do pdf.js agrupadas por agruparEmLinhas, de
// extratoNubankRegras.js) — roda na tela e no servidor.
// Testado em src/lib/__tests__/extratoMercadoPago.test.mjs.

const RE_DATA = /^(\d{2})-(\d{2})-(\d{4})$/;
const RE_VALOR_G = /R\$\s?(-?)\s?(\d{1,3}(?:\.\d{3})*,\d{2})/g;

const paraNumero = (sinal, txt) => Number(txt.replace(/\./g, '').replace(',', '.')) * (sinal === '-' ? -1 : 1);
const valoresDo = (s) => [...s.matchAll(RE_VALOR_G)].map((m) => paraNumero(m[1], m[2]));
const r2 = (v) => Math.round(v * 100) / 100;

export function pareceExtratoVendasMercadoPago(paginas) {
  const textos = paginas.flat().flatMap((l) => l.itens.map((i) => i.s));
  return textos.some((s) => /EXTRATO DE VENDAS/i.test(s))
    && textos.some((s) => /Mercado Pago/i.test(s))
    && textos.some((s) => /^ID:\d+/.test(s));
}

// Totais do quadro "Totais" do cabeçalho, pra conferir a leitura.
function lerTotais(paginas) {
  const totais = {};
  const rotulos = {
    brutas: /^Vendas totais brutas/i, taxas: /^Taxas:/i, liquidas: /^Vendas totais l[ií]quidas/i,
    devolucoes: /^Devolu[çc][õo]es/i, contestacoes: /^Contesta[çc][õo]es/i,
  };
  for (const linha of paginas[0] ?? []) {
    for (let i = 0; i < linha.itens.length; i++) {
      for (const [k, re] of Object.entries(rotulos)) {
        if (totais[k] == null && re.test(linha.itens[i].s)) {
          const v = valoresDo(linha.itens[i + 1]?.s ?? '')[0];
          if (v != null) totais[k] = v;
        }
      }
    }
  }
  return Object.keys(totais).length ? totais : null;
}

// Uma movimentação ocupa ~3 linhas do pdf.js: na de cima a data, o tipo e o
// valor bruto; no meio a ferramenta e o valor líquido; embaixo a hora, o ID e
// a taxa. Ancora na data da 1ª coluna e junta o que estiver até a próxima.
function lerMovimentacoes(paginas) {
  const movs = [];
  const avisos = [];
  for (const linhas of paginas) {
    const itens = linhas.flatMap((l) => l.itens.map((i) => ({ ...i, y: l.y })));
    const ancoras = itens
      .filter((i) => i.x < 45 && RE_DATA.test(i.s))
      .sort((a, b) => b.y - a.y);
    ancoras.forEach((a, k) => {
      const yFim = k + 1 < ancoras.length ? ancoras[k + 1].y + 2 : -Infinity;
      const doBloco = itens.filter((i) => i.y <= a.y + 2 && i.y > yFim && i.y >= a.y - 16);
      const [, dd, mm, aaaa] = a.s.match(RE_DATA);
      const id = doBloco.find((i) => /^ID:\d+/.test(i.s))?.s.slice(3) ?? null;
      const tipo = doBloco.find((i) => i.x > 85 && i.x < 150 && Math.abs(i.y - a.y) <= 2 && !/^ID:/.test(i.s))?.s ?? '';
      const ferramenta = doBloco.find((i) => i.x > 185 && i.x < 245)?.s ?? '';
      const meio = doBloco.filter((i) => i.x > 245 && i.x < 300 && !/R\$/.test(i.s)).sort((p, q) => q.y - p.y).map((i) => i.s).join(' ');

      // valores: bruto e taxa na coluna do meio (bruto em cima), líquido à
      // direita. Um item pode trazer dois valores grudados ("R$204,55R$-11,64").
      const colMeio = [];
      let liquido = null;
      for (const i of doBloco.filter((x) => /R\$/.test(x.s) && x.x > 290).sort((p, q) => q.y - p.y || p.x - q.x)) {
        const vs = valoresDo(i.s);
        if (i.x >= 380 && vs.length === 1 && liquido == null) liquido = vs[0];
        else colMeio.push(...vs);
      }
      const [bruto, taxa = 0] = colMeio;
      if (bruto == null) { avisos.push(`Movimentação de ${dd}/${mm} (${tipo || 'sem tipo'}) sem valor legível ficou de fora.`); return; }
      if (liquido != null && Math.abs(r2(bruto + taxa) - liquido) > 0.01) {
        avisos.push(`Movimentação ${id ?? ''} de ${dd}/${mm}: bruto ${bruto} + taxa ${taxa} não fecha com o líquido ${liquido}.`);
      }
      movs.push({ data: `${aaaa}-${mm}-${dd}`, tipo, id, ferramenta, meio, bruto: r2(bruto), taxa: r2(taxa), liquido: liquido ?? r2(bruto + taxa) });
    });
  }
  return { movs, avisos };
}

export function interpretarExtratoVendasMercadoPago(paginas) {
  const { movs, avisos } = lerMovimentacoes(paginas);
  const transacoes = [];
  for (const m of movs) {
    // Só a venda leva a ferramenta ("Checkouts") na descrição: as regras de
    // classificação costumam ter "CHECKOUTS" -> Vendas, e tarifa ou
    // devolução não pode cair em receita por isso.
    const venda = m.bruto > 0 && /^pagamento$/i.test(m.tipo);
    if (m.bruto) {
      const descricao = venda
        ? `Venda - Mercado Pago ${[m.ferramenta, m.meio].filter(Boolean).join(' ')}`
        : `${m.tipo || (m.bruto > 0 ? 'Entrada' : 'Devolução')} de venda - Mercado Pago ${m.meio}`;
      transacoes.push({
        data: m.data, descricao: descricao.trim(), identificador: m.id,
        valor: Math.abs(m.bruto), tipo: m.bruto > 0 ? 'entrada' : 'saida',
      });
    }
    if (m.taxa) {
      transacoes.push({
        data: m.data,
        descricao: m.taxa < 0 ? 'Tarifa de venda - Mercado Pago' : `Tarifa devolvida (${m.tipo || 'estorno'}) - Mercado Pago`,
        identificador: m.id ? `${m.id}-taxa` : null,
        valor: Math.abs(m.taxa), tipo: m.taxa < 0 ? 'saida' : 'entrada',
      });
    }
  }

  const soma = (f) => r2(movs.filter(f).reduce((s, m) => s + m.bruto, 0));
  const lido = {
    brutas: soma((m) => m.bruto > 0),
    taxas: r2(movs.filter((m) => m.bruto > 0).reduce((s, m) => s + m.taxa, 0)),
    liquido: r2(movs.reduce((s, m) => s + m.liquido, 0)),
    qtd: movs.length,
  };
  const totais = lerTotais(paginas);
  if (totais?.brutas != null && Math.abs(totais.brutas - lido.brutas) > 0.01) {
    avisos.unshift(`Vendas brutas lidas (${lido.brutas.toFixed(2)}) não batem com o total do extrato (${totais.brutas.toFixed(2)}) — confira na aba Lançamentos.`);
  }
  return { transacoes, movimentacoes: movs, totais, lido, avisos };
}
