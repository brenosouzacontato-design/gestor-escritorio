// src/lib/resumoFinanceiro.js
//
// Resumo do Financeiro (aba Resumo, src/pages/contabil/ResumoTab.jsx): o
// Gestor é a ponte entre o extrato e o OneFlow — as demonstrações (DRE,
// balancete) ficam no OneFlow. Aqui só o retrato do extrato no período:
// entradas e saídas, por banco, por mês, por conta, quanto falta identificar
// e quanto já foi lançado no OneFlow.
// Puro, sem Supabase — testado em src/lib/__tests__/resumoFinanceiro.test.mjs.
// Entrada: lançamentos de listarLancamentos (partidas_contabeis com
// contas_contabeis aninhadas).

import { ehContaPendente } from '../pages/contabil/planoContasConstantes.js';
import { ehDisponivel } from './dreGerencial.js';

const r2 = (v) => Math.round(v * 100) / 100;
const codigoDa = (p) => p.contas_contabeis?.codigo ?? '';

// natureza do lançamento olhando o lado do banco/caixa:
//  entrada = banco debitado; saída = banco creditado; transferência = os dois
//  lados são banco/caixa; outro = nenhum lado é banco (ex.: provisão de NF)
export function classificarLancamento(l) {
  const partidas = l.partidas_contabeis ?? [];
  const banco = partidas.filter((p) => ehDisponivel(codigoDa(p)));
  const debBanco = banco.filter((p) => p.tipo === 'debito');
  const creBanco = banco.filter((p) => p.tipo === 'credito');
  const soma = (ps) => ps.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const pendente = partidas.some((p) => ehContaPendente(codigoDa(p)));
  const contrapartida = partidas.find((p) => !ehDisponivel(codigoDa(p)));
  let natureza = 'outro';
  let valor = soma(partidas.filter((p) => p.tipo === 'debito'));
  if (debBanco.length && creBanco.length) natureza = 'transferencia';
  else if (debBanco.length) { natureza = 'entrada'; valor = soma(debBanco); }
  else if (creBanco.length) { natureza = 'saida'; valor = soma(creBanco); }
  const contaBanco = (debBanco[0] ?? creBanco[0])?.contas_contabeis ?? null;
  return {
    natureza,
    valor: r2(valor),
    pendente,
    enviado: !!l.oneflow_envio_id,
    contaBanco,
    contrapartida: contrapartida?.contas_contabeis ?? null,
  };
}

export function montarResumoFinanceiro(lancamentos, { idsDoFiscal = new Set() } = {}) {
  const totais = { entradas: 0, saidas: 0, transferencias: 0, qtd: 0, qtdEntradas: 0, qtdSaidas: 0 };
  const identificacao = { qtdPendentes: 0, valorPendente: 0, qtdClassificados: 0 };
  const oneflow = { qtdEnviados: 0, qtdProntos: 0, valorProntos: 0, qtdBloqueados: 0, qtdDoFiscal: 0, ultimoEnvio: null };
  const porBanco = new Map();
  const porMes = new Map();
  const porConta = { entrada: new Map(), saida: new Map() };

  for (const l of lancamentos) {
    const c = classificarLancamento(l);
    totais.qtd += 1;
    const mes = String(l.data).slice(0, 7);

    if (c.natureza === 'entrada' || c.natureza === 'saida') {
      const ent = c.natureza === 'entrada';
      if (ent) { totais.entradas += c.valor; totais.qtdEntradas += 1; } else { totais.saidas += c.valor; totais.qtdSaidas += 1; }

      const kb = c.contaBanco?.codigo ?? '?';
      const b = porBanco.get(kb) ?? { codigo: kb, nome: c.contaBanco?.nome ?? 'Banco', entradas: 0, saidas: 0, qtd: 0 };
      if (ent) b.entradas += c.valor; else b.saidas += c.valor;
      b.qtd += 1;
      porBanco.set(kb, b);

      const m = porMes.get(mes) ?? { mes, entradas: 0, saidas: 0, qtd: 0 };
      if (ent) m.entradas += c.valor; else m.saidas += c.valor;
      m.qtd += 1;
      porMes.set(mes, m);

      const mapa = porConta[c.natureza];
      const chave = c.pendente ? '__pendente' : (c.contrapartida?.codigo ?? '?');
      const g = mapa.get(chave) ?? {
        codigo: c.pendente ? '' : (c.contrapartida?.codigo ?? ''),
        nome: c.pendente ? 'A identificar' : (c.contrapartida?.nome ?? 'Sem conta'),
        pendente: c.pendente, total: 0, qtd: 0,
      };
      g.total += c.valor;
      g.qtd += 1;
      mapa.set(chave, g);
    } else if (c.natureza === 'transferencia') {
      totais.transferencias += c.valor;
    }

    if (c.pendente) { identificacao.qtdPendentes += 1; identificacao.valorPendente += c.valor; } else identificacao.qtdClassificados += 1;

    if (idsDoFiscal.has(l.id)) oneflow.qtdDoFiscal += 1;
    else if (c.enviado) {
      oneflow.qtdEnviados += 1;
      if (l.oneflow_enviado_em && (!oneflow.ultimoEnvio || l.oneflow_enviado_em > oneflow.ultimoEnvio)) oneflow.ultimoEnvio = l.oneflow_enviado_em;
    } else if (c.pendente) oneflow.qtdBloqueados += 1;
    else { oneflow.qtdProntos += 1; oneflow.valorProntos += c.valor; }
  }

  const arred = (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = r2(o[k]); return o; };
  const lista = (m) => [...m.values()].map(arred).sort((a, b) => b.total - a.total);
  arred(totais);
  totais.saldo = r2(totais.entradas - totais.saidas);
  arred(identificacao);
  const base = identificacao.qtdPendentes + identificacao.qtdClassificados;
  identificacao.pctClassificado = base ? Math.round((identificacao.qtdClassificados / base) * 100) : 100;
  arred(oneflow);

  return {
    totais,
    identificacao,
    oneflow,
    porBanco: [...porBanco.values()].map(arred).map((b) => ({ ...b, saldo: r2(b.entradas - b.saidas) })).sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas)),
    porMes: [...porMes.values()].map(arred).map((m) => ({ ...m, saldo: r2(m.entradas - m.saidas) })).sort((a, b) => a.mes.localeCompare(b.mes)),
    entradasPorConta: lista(porConta.entrada),
    saidasPorConta: lista(porConta.saida),
  };
}

// separa o que vai para o OneFlow: prontos (classificados e ainda não
// enviados), bloqueados (em "Valores a Identificar"), enviados e os que
// vieram de nota fiscal (o OneFlow já tem pelo Fiscal)
export function separarParaOneflow(lancamentos, idsDoFiscal = new Set()) {
  const out = { prontos: [], bloqueados: [], enviados: [], doFiscal: [] };
  for (const l of lancamentos) {
    if (idsDoFiscal.has(l.id)) out.doFiscal.push(l);
    else if (l.oneflow_envio_id) out.enviados.push(l);
    else if ((l.partidas_contabeis ?? []).some((p) => ehContaPendente(codigoDa(p)))) out.bloqueados.push(l);
    else out.prontos.push(l);
  }
  return out;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export function rotuloMesCurto(mes) {
  const [a, m] = mes.split('-');
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
}
