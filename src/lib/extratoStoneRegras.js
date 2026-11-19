// extratoStoneRegras.js
//
// Leitura por regra (sem IA) do "Extrato de conta corrente" da Stone (PDF
// baixado do app/portal). A IA não reconhecia o arquivo (21 páginas): o
// texto é limpo e em colunas fixas, então é lido por posição, como o Nubank
// e o Mercado Pago.
//
// Colunas: DATA (dd/mm/aa) | TIPO (Entrada/Saída) | DESCRIÇÃO | VALOR |
// SALDO | CONTRAPARTE. Cada movimentação ocupa ~3 linhas do pdf.js: a data,
// o tipo, o valor e o saldo numa linha (a "âncora"); a descrição em volta
// dela — em cima o nome (que pode quebrar em 2 linhas, a última na própria
// âncora) e embaixo a categoria ("Transferência | Pix", "Pix | Maquininha",
// "Antecipação"). Na venda de cartão: "Recebimento vendas" em cima e
// "Antecipação"/"Maestro | Débito" embaixo. "Tarifa" vem sozinha na âncora.
// O histórico sai como "Categoria - Nome" (formato usado pelas regras de
// classificação: extrairPadraoClassificacao pega o que vem depois do " - ").
//
// O extrato vem do mais novo pro mais antigo; a soma é conferida pelo saldo
// (saldo depois da movimentação mais nova − saldo antes da mais antiga).
//
// Parte PURA (recebe as linhas do pdf.js agrupadas por agruparEmLinhas, de
// extratoNubankRegras.js) — roda na tela e no servidor.
// Testado em src/lib/__tests__/extratoStone.test.mjs.

const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const RE_VALOR = /^(-?)\s*R\$\s*(-?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})$/;

// limites das colunas (x do pdf.js; o layout desloca ~2pt entre páginas)
const X_DATA_MAX = 60;
const X_DESC_MIN = 110;
const X_VALOR_MIN = 280;
const X_SALDO_MIN = 350;
const X_CONTRAPARTE_MIN = 420;
const ALCANCE = 20; // distância máxima (em y) de uma linha de descrição até a âncora

const r2 = (v) => Math.round(v * 100) / 100;

function lerValor(s) {
  const m = String(s || '').trim().match(RE_VALOR);
  if (!m) return null;
  const v = Number(m[3].replace(/\./g, '').replace(',', '.'));
  return m[1] === '-' || m[2] === '-' ? -v : v;
}

const juntar = (linhas) => linhas.join(' ').replace(/\s+/g, ' ').trim();

export function pareceExtratoStone(paginas) {
  const textos = paginas.flat().flatMap((l) => l.itens.map((i) => i.s));
  return textos.some((s) => /^Extrato de conta corrente$/i.test(s))
    && textos.some((s) => /Stone Institui[çc][ãa]o de Pagamento/i.test(s))
    && textos.some((s) => s === 'DESCRIÇÃO')
    && textos.some((s) => s === 'SALDO');
}

function lerMovimentacoes(paginas) {
  const movs = [];
  const avisos = [];
  for (const linhas of paginas) {
    const ancoras = linhas
      .map((l) => ({ l, data: l.itens.find((i) => i.x < X_DATA_MAX && RE_DATA.test(i.s)) }))
      .filter((a) => a.data);
    ancoras.forEach(({ l, data }, k) => {
      const [, dd, mm, aa] = data.s.match(RE_DATA);
      const dataIso = `20${aa}-${mm}-${dd}`;
      const tipoTxt = l.itens.find((i) => i.x > X_DATA_MAX && i.x < X_DESC_MIN)?.s ?? '';
      const valor = lerValor(l.itens.find((i) => i.x >= X_VALOR_MIN && i.x < X_SALDO_MIN)?.s);
      const saldo = lerValor(l.itens.find((i) => i.x >= X_SALDO_MIN && i.x < X_CONTRAPARTE_MIN)?.s);
      if (valor == null) {
        avisos.push(`Movimentação de ${dd}/${mm} (${tipoTxt || 'sem tipo'}) sem valor legível ficou de fora.`);
        return;
      }

      // descrição: linhas sem data entre a âncora anterior e a próxima, no
      // máximo a ALCANCE da âncora; cada linha fica com a âncora mais perto
      const yAcima = k > 0 ? ancoras[k - 1].l.y : Infinity;
      const yAbaixo = k + 1 < ancoras.length ? ancoras[k + 1].l.y : -Infinity;
      const desc = (linha) => juntar(linha.itens.filter((i) => i.x >= X_DESC_MIN && i.x < X_VALOR_MIN).map((i) => i.s));
      const acima = [];
      const abaixo = [];
      for (const outra of linhas) {
        if (outra === l || Math.abs(outra.y - l.y) > ALCANCE) continue;
        if (outra.y > l.y && outra.y - l.y >= yAcima - outra.y) continue;
        if (outra.y < l.y && l.y - outra.y >= outra.y - yAbaixo) continue;
        if (outra.itens.some((i) => i.x < X_DATA_MAX && RE_DATA.test(i.s))) continue;
        const t = desc(outra);
        if (t) (outra.y > l.y ? acima : abaixo).push(t);
      }
      const nome = juntar([...acima, desc(l)]);
      const categoria = juntar(abaixo);
      const descricao = categoria && categoria !== nome ? (nome ? `${categoria} - ${nome}` : categoria) : nome;

      // o sinal do valor manda; o TIPO só confirma
      if (tipoTxt && /^sa[íi]da$/i.test(tipoTxt) !== valor < 0) {
        avisos.push(`Movimentação de ${dd}/${mm} (${descricao}): tipo "${tipoTxt}" diferente do sinal do valor.`);
      }
      movs.push({ data: dataIso, descricao: descricao || tipoTxt || 'Movimentação Stone', valor: r2(valor), saldo });
    });
  }
  return { movs, avisos };
}

export function interpretarExtratoStone(paginas) {
  const { movs, avisos } = lerMovimentacoes(paginas);
  const transacoes = movs.map((m) => ({
    data: m.data,
    descricao: m.descricao,
    identificador: null,
    valor: Math.abs(m.valor),
    tipo: m.valor < 0 ? 'saida' : 'entrada',
  }));

  const soma = (f) => r2(movs.filter(f).reduce((s, m) => s + m.valor, 0));
  const lido = {
    qtd: movs.length,
    entradas: soma((m) => m.valor > 0),
    saidas: r2(-soma((m) => m.valor < 0)),
  };
  lido.variacao = r2(lido.entradas - lido.saidas);

  // saldo: o extrato vem do mais novo pro mais antigo
  const maisNova = movs[0];
  const maisAntiga = movs[movs.length - 1];
  let saldos = null;
  if (maisNova?.saldo != null && maisAntiga?.saldo != null) {
    saldos = { final: maisNova.saldo, inicial: r2(maisAntiga.saldo - maisAntiga.valor) };
    saldos.confere = Math.abs(r2(saldos.final - saldos.inicial) - lido.variacao) < 0.01;
    if (!saldos.confere) {
      avisos.unshift(`A soma das movimentações da Stone (${lido.variacao.toFixed(2)}) não bate com a variação do saldo (${saldos.inicial.toFixed(2)} → ${saldos.final.toFixed(2)}) — confira na aba Lançamentos.`);
    }
  }
  return { transacoes, lido, saldos, avisos };
}
