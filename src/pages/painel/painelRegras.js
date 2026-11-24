// painelRegras.js
// Regras puras do painel do cliente (sem React nem banco): o que é imposto,
// montagem das guias, pendências do Relatório de Situação Fiscal, honorários
// e os cartões "Vencidos / A vencer". Usadas pelo painel de cada empresa
// (PainelCompartilhadoPage.jsx) e pela aba Consolidado do painel de grupo
// (ConsolidadoGrupo.jsx) — os números das duas telas saem da mesma conta.

// Mesmo fallback de PainelClientePage.jsx pra obrigações legadas sem
// tipo_obrigacao_id, mais reconhecimento pelo nome (FGTS, DARF etc. nem
// sempre estão marcados como eh_imposto) — anexo de obrigação que não é
// imposto (ex: holerites na obrigação "Folha") não é guia a pagar.
const NOMES_IMPOSTO = new Set([
  'PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
  'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
  'INSS MENSAL',
]);
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia|maed|multa/i;
export function ehImposto(o) {
  return o.tipos_obrigacao?.eh_imposto || NOMES_IMPOSTO.has((o.tipo || '').toUpperCase())
    || TITULO_IMPOSTO.test(`${o.titulo || ''} ${o.tipo || ''}`);
}
// Recálculo do PGDAS não é o DAS do mês: não herda o valor da declaração
// nem a regra de "Sem movimento" — só aparece se tiver guia anexada.
export function ehDas(o) {
  const texto = `${o.titulo || ''} ${o.tipo || ''}`;
  return /\b(pg)?das\b/i.test(texto) && !/rec[aá]lculo/i.test(texto);
}


// O relatório da RFB traz o código da receita ("1099-01 - CP-SEGUR.") —
// traduz pro nome que o cliente reconhece. Sem correspondência, usa o
// texto original sem o período (que já aparece ao lado do nome).
const NOMES_TRIBUTO = [
  [/CP[\s.-]*SEGUR|1099|INSS\s*MENSAL/i, 'INSS Mensal'],
  [/CP[\s.-]*PATRONAL|1138/i, 'INSS Patronal'],
  [/CP[\s.-]*TERCEIROS|1170|1176|1191|1196|1200/i, 'INSS Terceiros'],
  [/CP[\s.-]*(GIL)?RAT|CP[\s.-]*SAT|1646/i, 'INSS RAT'],
  [/SIMPLES\s*NAC|\bDAS\b|\bSN\b/i, 'DAS — Simples Nacional'],
  [/\bMEI\b|SIMEI/i, 'DAS MEI'],
  [/IRRF|0561/i, 'IRRF'],
  [/IRPJ/i, 'IRPJ'],
  [/CSLL/i, 'CSLL'],
  [/COFINS/i, 'COFINS'],
  [/\bPIS\b/i, 'PIS'],
  [/FGTS/i, 'FGTS'],
];
export function nomeTributo(texto) {
  const t = texto || '';
  const achado = NOMES_TRIBUTO.find(([re]) => re.test(t));
  if (achado) return achado[1];
  return t.replace(/\s*(PA\s*)?\d{2}\/\d{4}\s*$/i, '').trim() || 'Débito';
}


export function diasParaVencer(vencimento) {
  if (!vencimento) return null;
  const hoje = new Date(new Date().toDateString());
  return Math.round((new Date(vencimento + 'T00:00:00') - hoje) / 86400000);
}

export function competenciaOrdinal(c) {
  if (!c) return 0;
  const [mes, ano] = c.split('/').map(Number);
  return ano * 100 + mes;
}
// Relatórios extraídos antes do campo "competencia" existir só trazem o
// período dentro do texto do tributo (ex: "1099-01 - CP-SEGUR. 06/2026").
export function competenciaDoTexto(texto) {
  const m = /(\d{2})\/(\d{4})/.exec(texto || '');
  return m ? `${m[1]}/${m[2]}` : null;
}
export const somaValores = (itens) => itens.reduce((s, it) => s + (Number(it.valor) || 0), 0);
export const temValor = (itens) => itens.some((it) => it.valor != null);

export function filtrarOutrasCompetencias({ impostos, outrasObrigacoes, tarefasArea, anexos }, competencia) {
  const outra = (item) => !!item.competencia && item.competencia !== competencia;
  const concluida = (o) => o.status === 'concluido' || o.status === 'nao_aplica';
  return {
    // guia de imposto só aparece no painel da própria competência: as da 09
    // (pagas ou não, mesmo vencendo em outubro) ficam no painel da 09 e não
    // aparecem no da 10. Débito antigo que a Receita ainda cobra aparece em
    // Pendências, pelo Relatório de Situação Fiscal.
    impostos: impostos.filter((o) => !outra(o)),
    outrasObrigacoes: outrasObrigacoes.filter((o) => !outra(o) || !concluida(o)),
    tarefasArea: tarefasArea.filter((t) => !outra(t) || !t.concluida),
  };
}

// Impostos da competência: com guia anexada, ou "aguardando guia" se ainda não concluídos. Exceção: o DAS de um mês
// com faturamento zerado na Declaração do Simples não tem guia (não há o
// que pagar) — entra como "Sem movimento" pro cliente saber que está ok.
export function montarGuias({ impostos, anexos, gerenciais, gerenciaisPorComp = {} }, competencia) {
  const zerado = (g) => g != null && g.faturamento_periodo != null && Number(g.faturamento_periodo) === 0;
  const semMovimento = zerado(gerenciais);
  // painel consolidado: cada DAS olha a Declaração do Simples da própria competência
  const gerDe = (o) => (!o.competencia || o.competencia === competencia ? gerenciais : gerenciaisPorComp[o.competencia]) || null;
  const guias = impostos
    // Sem guia anexada ainda: aparece como "aguardando guia" (com o vencimento), a não ser que a
    // obrigação já esteja concluída / não se aplique (ex.: apurado sem valor a pagar).
    .filter((o) => anexos[o.id] || (zerado(gerDe(o)) && ehDas(o)) || !(o.status === 'concluido' || o.status === 'nao_aplica'))
    .map((o) => {
      const das = ehDas(o);
      const ger = gerDe(o);
      const semMovimento = zerado(ger);
      const anexo = anexos[o.id] || null;
      const aguardandoGuia = !anexo && !(das && semMovimento);
      // valor lido da própria guia (IA) tem prioridade — já vem com multa/
      // juros se for o caso; o DAS cai no valor da declaração enquanto a
      // guia não foi lida
      const valorGuia = anexo?.valor_guia != null ? Number(anexo.valor_guia) : null;
      // vencimento impresso na guia é o que vale pro pagamento — o da
      // obrigação às vezes está cadastrado errado (ex: FGTS Digital)
      const vencimento = anexo?.vencimento_guia || o.vencimento || null;
      return {
        id: o.id,
        titulo: o.titulo || o.tipo,
        competencia: o.competencia || competencia,
        area: o.departamentos?.nome || null,
        vencimento,
        // vencida + concluída = o escritório já deu baixa, não é alerta
        dias: diasParaVencer(vencimento),
        concluida: o.status === 'concluido' || o.status === 'nao_aplica',
        // pagamento confirmado pelo comprovante (ou marcado na mão no modo de edição)
        paga: !!anexo?.pago_em,
        pagoEm: anexo?.pago_em || null,
        semMovimento: das && semMovimento,
        aguardandoGuia,
        valor: (das && semMovimento) || aguardandoGuia ? null
          : valorGuia ?? (das && ger?.valor_das != null ? Number(ger.valor_das) : null),
        anexo,
      };
    });
  if (semMovimento && !impostos.some((o) => ehDas(o) && (!o.competencia || o.competencia === competencia))) {
    guias.push({ id: 'das-sem-movimento', titulo: 'DAS — Simples Nacional', competencia, area: 'Fiscal',
      vencimento: null, dias: null, concluida: true, semMovimento: true, valor: null, anexo: null });
  }
  return guias.sort((a, b) => (a.vencimento || '9999-99-99').localeCompare(b.vencimento || '9999-99-99'));
}

// Débitos (RFB) + inscrições em Dívida Ativa (PGFN) do relatório mais
// recente, ordenados por competência. `valor` já é o saldo atualizado
// (ver extrair-situacao-fiscal.js).
// Exportada para o painel completo (PainelClientePage) ocultar as mesmas linhas.
export function montarPendencias(situacaoFiscal) {
  if (!situacaoFiscal) return [];
  const debitos = (situacaoFiscal.debitos || []).map((d, i) => ({
    id: `deb-${i}`, origem: 'Receita Federal', nome: nomeTributo(d.tributo), codigo: d.tributo || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: d.vencimento || null,
    valorOriginal: d.valorOriginal ?? null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  const dividas = (situacaoFiscal.dividas_ativas || []).map((d, i) => ({
    id: `pgfn-${i}`, origem: 'Dívida Ativa (PGFN)', nome: d.tributo ? nomeTributo(d.tributo) : 'Dívida ativa',
    codigo: [d.tributo, d.inscricao ? `Inscrição ${d.inscricao}` : null].filter(Boolean).join(' · ') || null,
    competencia: d.competencia || competenciaDoTexto(d.tributo), vencimento: null,
    valorOriginal: null, valor: d.valor ?? null, situacao: d.situacao || null,
  }));
  // "A vencer": o vencimento do relatório ainda não passou; relatório lido
  // antes do campo vencimento existir só tem o texto da situação ("A VENCER")
  return [...debitos, ...dividas].map((p) => {
    const dias = diasParaVencer(p.vencimento);
    // `chave` identifica o débito pro recado da linha — o id é só a posição
    // no relatório e mudaria a cada relatório novo enviado
    const chave = `pend-${p.id.split('-')[0]}-${p.codigo || p.nome}-${p.competencia || ''}`;
    return { ...p, chave, dias, aVencer: dias != null ? dias >= 0 : /a\s*vencer/i.test(p.situacao || '') };
  }).sort((a, b) => competenciaOrdinal(a.competencia) - competenciaOrdinal(b.competencia));
}

// Chave da linha de parcelamento do relatório (só o painel completo mostra);
// sem o nº de parcelas, que muda a cada relatório.
export const chaveParcelamentoFiscal = (p) => `pend-parc-${p?.modalidade || ''}`;


// Honorário como "obrigação a pagar" — mesmo formato das guias pra entrar
// nos cards de vencidos/a vencer. Avulso usa a descrição como título.
export function montarHonorarios(honorarios) {
  return (honorarios || []).map((h) => ({
    id: `hon-${h.id}`,
    titulo: h.tipo === 'avulso' ? (h.descricao || 'Honorário avulso') : 'Honorário contábil',
    competencia: h.competencia,
    vencimento: h.vencimento,
    dias: diasParaVencer(h.vencimento),
    concluida: h.status === 'pago',
    dataPagamento: h.data_pagamento,
    valor: h.valor != null ? Number(h.valor) : null,
  }));
}

export const alertaVencida = (g) => !g.semMovimento && !g.concluida && !g.paga && g.dias != null && g.dias < 0;
export const alertaUrgente = (g) => !g.semMovimento && !g.paga && g.dias != null && g.dias >= 0 && g.dias <= 3;

// Cartões "Vencidos / A vencer" e total da lista de impostos, com as mesmas
// regras do painel da empresa:
//   - seção oculta pelo escritório (painel_secoes_ocultas) sai da soma, e item
//     oculto ("item:<id>") também — o cliente não teria como conferir;
//   - "aguardando guia" não entra (sem valor nem guia);
//   - "Vencidos" junta guias vencidas sem baixa, honorários atrasados e débitos
//     do Relatório de Situação Fiscal; débito ainda no prazo é "a vencer", e
//     não conta se a guia do mesmo tributo/competência já está anexada.
// guias: montarGuias(...); honorarios: montarHonorarios(...); pendencias: montarPendencias(...)
// oculta(chave) / itemOculto(id): seção / item escondido do cliente.
export function indicadoresPainel({ guias, honorarios, pendencias, oculta = () => false, itemOculto = () => false }) {
  const guiasCard = guias && !oculta('impostos') ? guias.filter((g) => !g.aguardandoGuia && !itemOculto(g.id)) : [];
  const honorariosCard = oculta('honorarios') ? [] : (honorarios || []).filter((h) => !itemOculto(h.id));
  const pendenciasCard = pendencias && !oculta('pendencias') ? pendencias : [];
  const honorariosAVencer = honorariosCard.filter((h) => !h.concluida && !(h.dias != null && h.dias < 0));
  const honorariosVencidos = honorariosCard.filter(alertaVencida);
  const guiasAVencer = guiasCard.filter((g) => !g.semMovimento && !g.paga && !alertaVencida(g) && !(g.concluida && g.dias != null && g.dias < 0));
  const pendenciasVencidas = pendenciasCard.filter((p) => !p.aVencer);
  const pendenciasAVencer = pendenciasCard.filter((p) => p.aVencer
    && !guiasCard.some((g) => g.competencia === p.competencia && nomeTributo(g.titulo) === p.nome));
  const aVencer = [...guiasAVencer, ...honorariosAVencer, ...pendenciasAVencer]
    .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999'));
  const guiasVencidas = guiasCard.filter(alertaVencida);
  // Total da lista de impostos: só o que ainda falta pagar (guia vencida em
  // que o escritório já deu baixa não conta)
  const guiasEmAberto = (guias || []).filter((g) => !itemOculto(g.id) && !g.semMovimento && !g.paga && !(g.concluida && g.dias != null && g.dias < 0));
  const vencidos = [...guiasVencidas, ...honorariosVencidos, ...pendenciasVencidas];
  return {
    guiasCard, honorariosCard, pendenciasCard, honorariosAVencer, honorariosVencidos, guiasAVencer, guiasVencidas,
    pendenciasVencidas, pendenciasAVencer, aVencer, vencidos, guiasEmAberto,
  };
}

// Selo "Situação fiscal" do cabeçalho do painel: 'regular', 'pendente' ou null
// (nada informado). Federal: a CND mais nova que o relatório da Receita vence;
// CND vencida não conta. Débito do relatório ainda no prazo (soAVencer) não
// deixa a empresa irregular.
export function situacaoFiscalGeral({ situacaoFiscal, cndManual, soAVencer = false }) {
  const cnd = (esfera) => (cndManual && !cndManual[`vencida_${esfera}`] ? cndManual[`situacao_${esfera}`] : null);
  const relatorio = soAVencer && situacaoFiscal?.situacao_geral === 'pendente' ? 'regular' : situacaoFiscal?.situacao_geral;
  const cndFederalMaisNova = cnd('federal') && (!situacaoFiscal
    || competenciaOrdinal(cndManual.competencia_federal) >= competenciaOrdinal(situacaoFiscal.competencia));
  const federal = cndFederalMaisNova ? cnd('federal') : relatorio;
  const esferas = [federal, cnd('estadual'), cnd('municipal')].filter(Boolean);
  if (esferas.length === 0) return null;
  return esferas.includes('pendente') ? 'pendente' : 'regular';
}

// Guia que sai da lista de impostos do cliente (no modo de edição o escritório
// ainda vê, esmaecida): concluída e vencida sem pagamento registrado (o
// escritório já deu baixa). Guia paga continua na lista, como "Paga", com o
// comprovante para baixar. Só chegam aqui guias da própria competência do
// painel (filtrarOutrasCompetencias tira as das outras).
export function guiaSaiDaLista(g) {
  if (g.paga) return false;
  return !!g.concluida && g.dias != null && g.dias < 0;
}
