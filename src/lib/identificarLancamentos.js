// src/lib/identificarLancamentos.js
//
// Identificação dos lançamentos parados em "Valores a Identificar":
//  1) cruzarComNotas — casa a saída do banco com a NF de entrada do mesmo
//     fornecedor (valor, data e nome), uma NF por lançamento;
//  2) agruparPorContraparte — o que sobrou vai agrupado por contraparte
//     pra IA sugerir a conta (netlify/functions/identificar-lancamentos.js).
// Puro, sem Supabase — testado em src/lib/__tests__/identificarLancamentos.test.mjs.

import { ehContaPendente } from '../pages/contabil/planoContasConstantes.js';
import { contraparteDoHistorico, ehDisponivel } from './dreGerencial.js';

const PALAVRAS_VAZIAS = new Set([
  'LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S', 'A', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'COMERCIO', 'COM', 'IND', 'INDUSTRIA',
  'SERVICOS', 'SERV', 'DISTRIBUIDORA', 'DIST', 'CIA', 'MEI', 'PAGAMENTOS', 'PIX', 'BANCO', 'INSTITUICAO', 'PAGAMENTO',
]);

export function tokensNome(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !PALAVRAS_VAZIAS.has(t) && !/^\d+$/.test(t));
}

// 0..1 — fração dos tokens do nome menor que aparecem no maior
export function similaridadeNomes(a, b) {
  const ta = new Set(tokensNome(a));
  const tb = new Set(tokensNome(b));
  if (!ta.size || !tb.size) return 0;
  const [menor, maior] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let comuns = 0;
  for (const t of menor) if (maior.has(t)) comuns += 1;
  return comuns / menor.size;
}

const diasEntre = (a, b) => Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);

// lançamentos com uma partida em "Valores a Identificar"
export function pendentesDosLancamentos(lancamentos, contas) {
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const out = [];
  for (const l of lancamentos) {
    const partidas = l.partidas_contabeis ?? [];
    const pend = partidas.find((p) => ehContaPendente(contaPorId.get(p.conta_id)?.codigo ?? p.contas_contabeis?.codigo));
    if (!pend) continue;
    const banco = partidas.find((p) => ehDisponivel(contaPorId.get(p.conta_id)?.codigo ?? p.contas_contabeis?.codigo));
    // pendente no débito = dinheiro saiu do banco sem destino conhecido
    const natureza = pend.tipo === 'debito' ? 'saida' : 'entrada';
    out.push({
      id: l.id,
      data: String(l.data).slice(0, 10),
      historico: l.historico ?? '',
      contraparte: contraparteDoHistorico(l.historico),
      valor: Number(pend.valor) || 0,
      natureza,
      partidaPendenteId: pend.id,
      temBanco: !!banco,
    });
  }
  return out;
}

/**
 * Casa saídas pendentes com NFs de entrada.
 * Pontuação: valor (igual 50 · até 1% 35 · até 5% 15), data (pagamento de
 * 5 dias antes a 60 depois da emissão: até 20) e nome (até 40).
 * Aceita a partir de 70 — valor igual + nome parecido, ou valor igual +
 * data próxima + algum nome. Cada NF casa com um lançamento só.
 */
export function cruzarComNotas(pendentes, notas, { minimo = 70 } = {}) {
  const candidatas = [];
  const notasValidas = notas.filter((n) => n.tipo_movimento === 'entrada'
    && !/cancel/i.test(n.situacao_documento ?? '')
    && !n.lancamento_id
    && Number(n.valor_total) > 0);
  for (const l of pendentes) {
    if (l.natureza !== 'saida') continue;
    for (const n of notasValidas) {
      const vn = Number(n.valor_total);
      const dif = Math.abs(vn - l.valor) / Math.max(vn, 0.01);
      let sValor = 0;
      if (Math.abs(vn - l.valor) <= 0.01) sValor = 50;
      else if (dif <= 0.01) sValor = 35;
      else if (dif <= 0.05) sValor = 15;
      else continue;
      const emissao = String(n.data_emissao ?? '').slice(0, 10);
      let sData = 0;
      if (emissao) {
        const d = diasEntre(l.data, emissao);
        if (d < -5 || d > 60) continue;
        sData = d >= -2 && d <= 7 ? 20 : d <= 30 ? 12 : 6;
      }
      const sim = similaridadeNomes(l.contraparte, n.razao_social_terceiro);
      const sNome = Math.round(sim * 40);
      const score = sValor + sData + sNome;
      if (score >= minimo) {
        candidatas.push({
          lancamentoId: l.id, notaId: n.id, score, similaridade: sim,
          motivo: `NF ${n.numero ?? ''} de ${n.razao_social_terceiro ?? 'fornecedor'} — ${Number(n.valor_total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} emitida em ${emissao.split('-').reverse().join('/')}`,
        });
      }
    }
  }
  candidatas.sort((a, b) => b.score - a.score);
  const usadosL = new Set();
  const usadasN = new Set();
  const casados = [];
  for (const c of candidatas) {
    if (usadosL.has(c.lancamentoId) || usadasN.has(c.notaId)) continue;
    usadosL.add(c.lancamentoId);
    usadasN.add(c.notaId);
    casados.push(c);
  }
  return casados;
}

// fornecedor das NFs com nome parecido com a contraparte (sem casar valor)
// — vai como pista pra IA ("é fornecedor de mercadoria")
export function fornecedorDasNotas(contraparte, notas, minimo = 0.6) {
  let melhor = null;
  for (const n of notas) {
    if (n.tipo_movimento !== 'entrada') continue;
    const s = similaridadeNomes(contraparte, n.razao_social_terceiro);
    if (s >= minimo && (!melhor || s > melhor.s)) melhor = { s, nome: n.razao_social_terceiro };
  }
  if (!melhor) return null;
  const doFornecedor = notas.filter((n) => n.tipo_movimento === 'entrada' && n.razao_social_terceiro === melhor.nome);
  const naturezas = [...new Set(doFornecedor.flatMap((n) => itensDaNota(n)).filter(Boolean))].slice(0, 5);
  return { nome: melhor.nome, qtdNotas: doFornecedor.length, total: doFornecedor.reduce((s, n) => s + Number(n.valor_total || 0), 0), itens: naturezas };
}

// descrição dos produtos/serviços da NF, quando o JSON da Omie/OneFlow trouxer
export function itensDaNota(n) {
  const d = n.dados ?? {};
  const det = d.det ?? d.itens ?? d.produtos ?? d.Itens ?? null;
  if (Array.isArray(det)) {
    return det.map((i) => i?.descricaoProduto ?? i?.prod?.xProd ?? i?.descricao ?? i?.xProd ?? i?.produto?.descricao ?? null).filter(Boolean).slice(0, 3);
  }
  const disc = d.discriminacao ?? d.servico?.discriminacao ?? d.descricao_servico ?? null;
  return disc ? [String(disc).slice(0, 120)] : [];
}

// agrupa por contraparte + natureza (entrada/saída) pra mandar à IA
export function agruparPorContraparte(pendentes, { excluirIds = new Set(), notas = [] } = {}) {
  const grupos = new Map();
  for (const l of pendentes) {
    if (excluirIds.has(l.id)) continue;
    const chave = `${l.natureza}|${l.contraparte.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()}`;
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, contraparte: l.contraparte, natureza: l.natureza, qtd: 0, total: 0, lancamentos: [], exemplos: [] };
      grupos.set(chave, g);
    }
    g.qtd += 1;
    g.total += l.valor;
    g.lancamentos.push(l);
    if (g.exemplos.length < 3 && !g.exemplos.includes(l.historico)) g.exemplos.push(l.historico);
  }
  const lista = [...grupos.values()].sort((a, b) => b.total - a.total);
  for (const g of lista) {
    g.total = Math.round(g.total * 100) / 100;
    g.fornecedorNf = notas.length ? fornecedorDasNotas(g.contraparte, notas) : null;
  }
  return lista;
}

// conta sugerida para a saída paga a fornecedor de NF de entrada:
// regra existente pro fornecedor > compras de mercadoria (CMV) > insumos (CPV)
export function contaParaCompraDeNota(contas, nota, regras = [], encontrarRegra = null) {
  const lancavel = (c) => c.aceita_lancamento && c.ativo !== false && !ehContaPendente(c.codigo) && !ehDisponivel(c.codigo);
  if (encontrarRegra && nota?.razao_social_terceiro) {
    const regra = encontrarRegra(nota.razao_social_terceiro, regras);
    const c = regra && contas.find((x) => x.id === regra.conta_id);
    if (c && lancavel(c) && !c.codigo.startsWith('2')) return c;
  }
  const opcoes = contas.filter(lancavel).filter((c) => c.codigo.startsWith('4') && !c.nome.trim().startsWith('(-)'));
  const porNome = (re) => opcoes.find((c) => re.test(c.nome.trim()));
  return porNome(/^compras? de mercadorias$/i)
    ?? porNome(/^compras? de mat[eé]rias?-?primas/i)
    ?? porNome(/^compras?/i)
    ?? porNome(/mercadorias vendidas|produtos vendidos/i)
    ?? null;
}
