// contabilApi.js
// Camada de dados do módulo contábil. Importa o client Supabase já
// existente no Gestor.
import { supabase, tokenPainelAtivo, rpcAusente } from '../../lib/supabase';

// ---------- PLANO DE CONTAS ----------

export async function listarContas(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .order('codigo');
  if (error) throw error;
  return data;
}

// Grupo "Disponível" (caixa, bancos, aplicações) e conta transitória
// "Valores a Identificar" — ver planoContasConstantes.js (valem pro plano
// padrão OneFlow e pro Plano Enxuto).
import { PREFIXO_DISPONIVEL, ehContaPendente } from './planoContasConstantes';
// Regras da importação de extrato compartilhadas com o servidor (extrato
// enviado pelo grupo Documentos do WhatsApp) — ver src/lib/contabilExtrato.js.
import {
  extrairPadraoClassificacao, encontrarRegraAplicavel, inserirLancamentosEmLote, calcularDREPorContaCom,
} from '../../lib/contabilExtrato';
export { extrairPadraoClassificacao, encontrarRegraAplicavel };

// Lista só as contas de banco/caixa — usada no seletor "conta bancária do
// extrato" da importação. Não aparece na tela de Plano de Contas (que agora
// só mostra Receita/Despesa), mas continua existindo pra sustentar a
// partida dobrada por baixo dos panos.
export async function listarContasBanco(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .eq('aceita_lancamento', true)
    .like('codigo', `${PREFIXO_DISPONIVEL}%`)
    .order('codigo');
  if (error) throw error;
  return data;
}

// Lista plana (sem hierarquia) das contas de Receita e Despesa — alimenta
// os seletores de classificação da importação de extrato e a DRE (o Plano
// de Contas em si mostra todos os tipos, ver listarContasTodasGerenciamento).
export async function listarContasReceitaDespesa(empresaId, tipos = ['receita', 'despesa']) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('ativo', true)
    .in('tipo', tipos)
    .order('nome');
  if (error) throw error;
  return data;
}

// Lista TODOS os tipos de conta (Ativo, Passivo, Patrimônio Líquido,
// Receita, Custo, Despesa), ativas e desativadas — é o que a tela de Plano
// de Contas mostra (versão completa, porém em lista plana/simples, sem a
// hierarquia de código do plano padrão original).
export async function listarContasTodasGerenciamento(empresaId) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('nome');
  if (error) throw error;
  return data;
}

export async function criarConta(conta) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .insert(conta)
    .select()
    .single();
  if (error) throw error;
  return data;
}

const PREFIXO_POR_TIPO = {
  ativo: 'ATV', passivo: 'PAS', patrimonio_liquido: 'PL',
  receita: 'REC', custo: 'CUS', despesa: 'DESP',
};
const NATUREZA_POR_TIPO = {
  ativo: 'devedora', custo: 'devedora', despesa: 'devedora',
  passivo: 'credora', patrimonio_liquido: 'credora', receita: 'credora',
};

// Acha o código pra uma conta raiz nova (sem base) do tipo escolhido —
// ancora no branch numérico real do plano importado (ex: despesa nasce em
// "5.1.01...", então uma raiz nova vira "5.1.99.NNN"), usando ".99." como
// branch reservado pra conta criada pelo usuário — não colide com os
// branches ("01", "02"...) do plano padrão. Sem isso, o código antigo
// ("DESP-001") não tem nada a ver com a numeração real e a conta acaba
// ordenada fora de lugar (o dígito "D" vem depois de todo número no
// código), quebrando a hierarquia visual do Plano de Contas. Se a empresa
// ainda não tiver nenhuma conta numérica desse tipo (plano não importado),
// cai no esquema antigo — não tem em cima do que ancorar.
async function proximoCodigoRaiz(empresaId, tipo) {
  const { data: menor, error: errMenor } = await supabase
    .from('contas_contabeis')
    .select('codigo')
    .eq('empresa_id', empresaId)
    .eq('tipo', tipo)
    .order('codigo')
    .limit(1)
    .maybeSingle();
  if (errMenor) throw errMenor;

  const partes = menor?.codigo?.split('.') ?? [];
  if (partes.length < 2 || !/^\d+$/.test(partes[0])) {
    const prefixo = PREFIXO_POR_TIPO[tipo];
    const { count, error: errCount } = await supabase
      .from('contas_contabeis')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('tipo', tipo);
    if (errCount) throw errCount;
    return `${prefixo}-${String((count ?? 0) + 1).padStart(3, '0')}`;
  }

  const prefixoRaiz = `${partes[0]}.${partes[1]}.99`;
  const { count, error: errCount } = await supabase
    .from('contas_contabeis')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .like('codigo', `${prefixoRaiz}.%`);
  if (errCount) throw errCount;
  return `${prefixoRaiz}.${String((count ?? 0) + 1).padStart(3, '0')}`;
}

// Cria uma conta de qualquer tipo pra tela de Plano de Contas — nome + tipo
// é tudo que o usuário escolhe; código (ver proximoCodigoRaiz), natureza e
// nível são derivados automaticamente a partir do tipo. "sintetica" marca a
// conta como agrupadora pura (aceita_lancamento=false) — não recebe
// lançamento direto, só existe pra somar as contas analíticas (filhas) por
// baixo dela.
export async function criarContaQualquerTipo(empresaId, nome, tipo, sintetica = false) {
  const codigo = await proximoCodigoRaiz(empresaId, tipo);
  return criarConta({
    empresa_id: empresaId,
    codigo,
    nome,
    tipo,
    natureza: NATUREZA_POR_TIPO[tipo],
    nivel: 1,
    aceita_lancamento: !sintetica,
  });
}

// Cria uma conta "a partir de" uma conta-base já existente — modelo
// clássico de plano de contas, onde você parte de uma conta de referência
// (ex: "Itaú") pra criar uma nova relacionada (ex: "Bradesco"). Duas
// situações bem diferentes, dependendo do que a base é:
//
// 1) Base SINTÉTICA (grupo de verdade, aceita_lancamento=false) — a nova
//    conta nasce como FILHA real dela (conta_pai_id = base.id), um nível
//    abaixo: é "criar uma sub-conta dentro deste grupo".
//
// 2) Base ANALÍTICA (aceita_lancamento=true — o caso da esmagadora maioria
//    das contas, incluindo TODO o plano padrão importado, que não tem
//    conta_pai_id real, só código hierárquico "visual") — a nova conta
//    nasce como IRMÃ dela, no mesmo grupo (mesmo prefixo de código, um
//    segmento a mais que o grupo, conta_pai_id herdado da base). Antes
//    disso, criar "a partir de" QUALQUER conta analítica (ou seja, quase
//    sempre) transformava essa conta-folha num novo grupo sintético com um
//    único filho aninhado um nível abaixo dela — um subgrupo espúrio que
//    não existia no plano de contas real, em vez de simplesmente colocar a
//    conta nova ao lado dela.
export async function criarContaFilha(empresaId, nome, contaBaseId, sintetica = false) {
  const { data: base, error: errBase } = await supabase
    .from('contas_contabeis')
    .select('id, codigo, tipo, natureza, nivel, conta_pai_id, aceita_lancamento')
    .eq('id', contaBaseId)
    .single();
  if (errBase) throw errBase;

  const ehGrupoReal = !base.aceita_lancamento;
  const contaPaiId = ehGrupoReal ? base.id : (base.conta_pai_id ?? null);
  const nivel = ehGrupoReal ? (base.nivel ?? 0) + 1 : (base.nivel ?? 0);
  const partesBase = base.codigo.split('.');
  const prefixoGrupo = ehGrupoReal ? base.codigo : partesBase.slice(0, -1).join('.');

  let codigo;
  if (partesBase.length <= 1) {
    // código raiz sem separador (esquema antigo "TIPO-001") — não tem
    // grupo/prefixo pra ancorar uma irmã, cai no mesmo fluxo de raiz nova.
    codigo = await proximoCodigoRaiz(empresaId, base.tipo);
  } else {
    const { data: existentes, error: errExistentes } = await supabase
      .from('contas_contabeis')
      .select('codigo')
      .eq('empresa_id', empresaId)
      .like('codigo', `${prefixoGrupo}.%`);
    if (errExistentes) throw errExistentes;
    // profundidade exata do próximo nível do grupo — ignora netos/bisnetos
    // que por acaso compartilhem o mesmo prefixo mais longo.
    const profundidadeAlvo = prefixoGrupo.split('.').length + 1;
    const numeros = existentes
      .map((c) => c.codigo.split('.'))
      .filter((partes) => partes.length === profundidadeAlvo)
      .map((partes) => parseInt(partes[partes.length - 1], 10))
      .filter((n) => !Number.isNaN(n));
    // máximo em vez de contagem — contagem erra o próximo número assim que
    // há uma lacuna (conta excluída no meio do grupo), gerando código
    // duplicado com uma conta já existente.
    const proximoNumero = (numeros.length > 0 ? Math.max(...numeros) : 0) + 1;
    codigo = `${prefixoGrupo}.${String(proximoNumero).padStart(3, '0')}`;
  }

  return criarConta({
    empresa_id: empresaId,
    codigo,
    nome,
    tipo: base.tipo,
    natureza: base.natureza,
    conta_pai_id: contaPaiId,
    nivel,
    aceita_lancamento: !sintetica,
  });
}

// Uma conta só pode ser excluída de vez se nunca teve lançamento (senão
// quebraria o histórico) — nesse caso só desativa (soft delete via "ativo").
export async function excluirOuDesativarConta(id) {
  const { count, error: errCount } = await supabase
    .from('partidas_contabeis')
    .select('id', { count: 'exact', head: true })
    .eq('conta_id', id);
  if (errCount) throw errCount;
  if (count > 0) {
    await atualizarConta(id, { ativo: false });
    return { desativada: true };
  }
  const { error } = await supabase.from('contas_contabeis').delete().eq('id', id);
  if (error) throw error;
  return { desativada: false };
}

export async function atualizarConta(id, patch) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Edição simples de nome/tipo pela tela de Plano de Contas ou pelo sidebar
// de lançamentos — recalcula a natureza a partir do novo tipo (mesma regra
// de criarContaQualquerTipo), pra não deixar tipo e natureza dessincronizados.
export async function editarContaBasico(id, { nome, tipo, aceitaLancamento }) {
  const patch = { nome, tipo, natureza: NATUREZA_POR_TIPO[tipo] };
  if (aceitaLancamento !== undefined) patch.aceita_lancamento = aceitaLancamento;
  return atualizarConta(id, patch);
}

export async function contaTemLancamentos(id) {
  const { count, error } = await supabase
    .from('partidas_contabeis')
    .select('id', { count: 'exact', head: true })
    .eq('conta_id', id);
  if (error) throw error;
  return count > 0;
}

export async function atualizarContasEmLote(ids, patch) {
  const { data, error } = await supabase
    .from('contas_contabeis')
    .update(patch)
    .in('id', ids)
    .select();
  if (error) throw error;
  return data;
}

// ---------- LANÇAMENTOS ----------

// partidas: [{ conta_id, tipo: 'debito'|'credito', valor }, ...]
// soma dos débitos precisa ser igual à soma dos créditos (validado no banco também)
export async function criarLancamento({ empresaId, data, historico, numeroDocumento, origem = 'manual', partidas, extratoReferencia }) {
  const totalDebito = partidas.filter(p => p.tipo === 'debito').reduce((s, p) => s + Number(p.valor), 0);
  const totalCredito = partidas.filter(p => p.tipo === 'credito').reduce((s, p) => s + Number(p.valor), 0);
  if (Math.abs(totalDebito - totalCredito) > 0.005) {
    throw new Error(`Lançamento não bate: débito R$ ${totalDebito.toFixed(2)} x crédito R$ ${totalCredito.toFixed(2)}`);
  }

  const { data: lancamento, error: errLanc } = await supabase
    .from('lancamentos_contabeis')
    .insert({
      empresa_id: empresaId,
      data,
      historico,
      numero_documento: numeroDocumento ?? null,
      origem,
      extrato_referencia: extratoReferencia ?? null,
    })
    .select()
    .single();
  if (errLanc) throw errLanc;

  const partidasComLancamento = partidas.map(p => ({
    lancamento_id: lancamento.id,
    conta_id: p.conta_id,
    tipo: p.tipo,
    valor: p.valor,
  }));

  const { error: errPartidas } = await supabase
    .from('partidas_contabeis')
    .insert(partidasComLancamento);
  if (errPartidas) throw errPartidas;

  return lancamento;
}

// Insere vários lançamentos de uma vez (usado pela importação de extrato —
// evita 2 round-trips sequenciais por transação, que fica lento demais com
// extratos grandes). Usa extratoReferencia com índice único parcial em
// (empresa_id, extrato_referencia) pra pular transações já importadas antes
// (ON CONFLICT DO NOTHING) em vez de duplicar.
// itens: [{ data, historico, numeroDocumento, origem, extratoReferencia, conciliado, partidas }]
export async function criarLancamentosEmLote(empresaId, itens) {
  return inserirLancamentosEmLote(supabase, empresaId, itens);
}

// Reclassifica um lançamento importado que caiu em "Valores a Identificar":
// troca a conta da partida indicada e marca o lançamento como conciliado.
export async function reclassificarLancamento(lancamentoId, partidaId, novaContaId) {
  const { error: errPartida } = await supabase
    .from('partidas_contabeis')
    .update({ conta_id: novaContaId })
    .eq('id', partidaId);
  if (errPartida) throw errPartida;

  const { data, error: errLanc } = await supabase
    .from('lancamentos_contabeis')
    .update({ conciliado: true })
    .eq('id', lancamentoId)
    .select('*, partidas_contabeis(*, contas_contabeis(codigo, nome))')
    .single();
  if (errLanc) throw errLanc;
  return data;
}

// Mesma ideia que reclassificarLancamento, mas pra várias partidas
// pendentes de uma vez, todas indo pra mesma conta escolhida.
export async function reclassificarLancamentosEmLote(partidaIds, lancamentoIds, novaContaId) {
  const { error: errPartidas } = await supabase
    .from('partidas_contabeis')
    .update({ conta_id: novaContaId })
    .in('id', partidaIds);
  if (errPartidas) throw errPartidas;

  const { error: errLancs } = await supabase
    .from('lancamentos_contabeis')
    .update({ conciliado: true })
    .in('id', lancamentoIds);
  if (errLancs) throw errLancs;
}

// ---------- REGRAS DE CLASSIFICAÇÃO AUTOMÁTICA ----------

// extrairPadraoClassificacao / encontrarRegraAplicavel: em
// src/lib/contabilExtrato.js (reexportadas no topo deste arquivo).

export async function listarRegrasClassificacao(empresaId) {
  const { data, error } = await supabase
    .from('regras_classificacao')
    .select('*, contas_contabeis(codigo, nome)')
    .eq('empresa_id', empresaId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data;
}

function normalizarTexto(texto) {
  return (texto ?? '').trim().toUpperCase();
}

// Grava/atualiza a regra "esse padrão sempre cai nessa conta" — chamado
// toda vez que um lançamento é classificado (manual, em lote ou na
// importação de extrato), pra ir aprendendo sozinho com o histórico.
export async function salvarRegraClassificacao(empresaId, historico, contaId) {
  const padrao = extrairPadraoClassificacao(historico);
  if (!padrao) return;
  const { error } = await supabase
    .from('regras_classificacao')
    .upsert({ empresa_id: empresaId, padrao, conta_id: contaId, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,padrao' });
  if (error) throw error;
}

// Cadastro manual de regra: o usuário escolhe o trecho (não precisa ser a
// contraparte inteira) e a conta, direto na tela de Regras.
export async function salvarRegraManual(empresaId, padraoBruto, contaId) {
  const padrao = normalizarTexto(padraoBruto);
  if (!padrao) throw new Error('Informe um trecho do histórico pra regra.');
  const { error } = await supabase
    .from('regras_classificacao')
    .upsert({ empresa_id: empresaId, padrao, conta_id: contaId, updated_at: new Date().toISOString() }, { onConflict: 'empresa_id,padrao' });
  if (error) throw error;
}

export async function excluirRegraClassificacao(id) {
  const { error } = await supabase.from('regras_classificacao').delete().eq('id', id);
  if (error) throw error;
}

export async function listarLancamentos(empresaId, { dataInicio, dataFim } = {}) {
  // paginado: o PostgREST corta em 1000 linhas e um extrato de alguns meses
  // já passa disso (os mais antigos sumiam da tela sem aviso)
  const todos = [];
  for (let de = 0; ; de += 1000) {
    let query = supabase
      .from('lancamentos_contabeis')
      // contas_contabeis(*) em vez de colunas fixas: traz o cnpj (fornecedor)
      // usado na exportação p/ OneFlow sem quebrar se a coluna ainda não existir
      .select('*, partidas_contabeis(*, contas_contabeis(*))')
      .eq('empresa_id', empresaId)
      .order('data', { ascending: false })
      .order('id');
    if (dataInicio) query = query.gte('data', dataInicio);
    if (dataFim) query = query.lte('data', dataFim);
    const { data, error } = await query.range(de, de + 999);
    if (error) throw error;
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

// Link curto pra identificação de uma lista específica de lançamentos
// (filtro aplicado ou seleção manual em LancamentosTab.jsx) — listar um
// UUID por lançamento direto na URL (?ids=id1,id2,...) deixava o link
// enorme (uma centena de lançamentos já passa de 10 mil caracteres), então
// a lista fica guardada em lancamentos_identificacao_links (ver
// supabase-schema-lancamentos-identificacao-links.sql) e a URL leva só o
// id curto dessa linha (?link=<id>), resolvido de volta pra lista completa
// em obterLancamentoIdsDoLink.
export async function criarLinkIdentificacao(empresaId, lancamentoIds) {
  const { data, error } = await supabase
    .from('lancamentos_identificacao_links')
    .insert({ empresa_id: empresaId, lancamento_ids: lancamentoIds })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function obterLancamentoIdsDoLink(linkId) {
  const { data, error } = await supabase
    .from('lancamentos_identificacao_links')
    .select('lancamento_ids')
    .eq('id', linkId)
    .single();
  if (error) throw error;
  return data.lancamento_ids;
}

// Lançamentos pra "enviar pro cliente pra identificação": ele recebe essa
// lista (sem precisar logar, mesmo modelo do link de compartilhamento do
// Balancete/DRE) e preenche o que foi cada um; a resposta fica em
// observacao_cliente pra ajudar a classificar depois.
// ids: quando informado (LancamentosTab.jsx manda o que está filtrado/
// selecionado na tela), filtra só por eles, ignora dataInicio/dataFim e
// NÃO restringe por conciliado — quem decidiu o que mandar foi a tela (ex:
// "só as entradas", independente de já estarem conciliadas ou não); sem
// ids, cai pro período inteiro e aí sim só os ainda não conciliados (é o
// que faz sentido perguntar quando não há filtro nenhum aplicado).
export async function listarLancamentosAIdentificar(empresaId, { dataInicio, dataFim, ids } = {}) {
  let query = supabase
    .from('lancamentos_contabeis')
    .select('id, data, historico, numero_documento, observacao_cliente, partidas_contabeis(tipo, valor, contas_contabeis(codigo))')
    .eq('empresa_id', empresaId)
    .order('data');
  if (ids && ids.length > 0) {
    query = query.in('id', ids);
  } else {
    query = query.eq('conciliado', false);
    if (dataInicio) query = query.gte('data', dataInicio);
    if (dataFim) query = query.lte('data', dataFim);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.map((l) => {
    const debitoPartidas = l.partidas_contabeis?.filter((p) => p.tipo === 'debito') ?? [];
    const creditoPartidas = l.partidas_contabeis?.filter((p) => p.tipo === 'credito') ?? [];
    const valor = debitoPartidas.reduce((s, p) => s + Number(p.valor), 0);
    const ehContaDisponivelReal = (codigo) => codigo?.startsWith(PREFIXO_DISPONIVEL) && !ehContaPendente(codigo);
    const tocaDisponivelDebito = debitoPartidas.some((p) => ehContaDisponivelReal(p.contas_contabeis?.codigo));
    const tocaDisponivelCredito = creditoPartidas.some((p) => ehContaDisponivelReal(p.contas_contabeis?.codigo));
    const natureza = tocaDisponivelDebito === tocaDisponivelCredito ? null : (tocaDisponivelDebito ? 'entrada' : 'saida');
    return {
      id: l.id,
      data: l.data,
      historico: l.historico,
      numeroDocumento: l.numero_documento,
      observacaoCliente: l.observacao_cliente ?? '',
      valor,
      natureza,
    };
  });
}

// No link público (cliente respondendo) grava pela RPC, que só mexe na
// coluna observacao_cliente e só em lançamento da empresa do token. Dentro
// do app, ou sem a RPC no banco ainda, grava direto como antes.
export async function salvarObservacaoCliente(lancamentoId, observacao) {
  if (tokenPainelAtivo()) {
    const { error } = await supabase.rpc('painel_salvar_observacao', { p_lancamento_id: lancamentoId, p_observacao: observacao });
    if (!rpcAusente(error)) {
      if (error) throw error;
      return;
    }
  }
  const { error } = await supabase
    .from('lancamentos_contabeis')
    .update({ observacao_cliente: observacao })
    .eq('id', lancamentoId);
  if (error) throw error;
}

export async function excluirLancamento(id) {
  const { error } = await supabase.from('lancamentos_contabeis').delete().eq('id', id);
  if (error) throw error;
}

export async function excluirLancamentosEmLote(ids) {
  const { error } = await supabase.from('lancamentos_contabeis').delete().in('id', ids);
  if (error) throw error;
}

// ---------- SOMAS POR HIERARQUIA (contas sintéticas x analíticas) ----------

// Uma conta com filhas (via conta_pai_id — só as criadas pelo fluxo "criar
// a partir de uma conta base" têm isso de verdade, ver criarContaFilha)
// vira uma "sintética": a linha dela passa a mostrar a soma de tudo (ela +
// filhas, recursivo). As filhas aparecem primeiro, indentadas, com seus
// valores próprios, e a soma sintética fecha o grupo por último — estilo
// subtotal de rodapé, não duplica o total, só resume o que veio antes.
// linhas: [{ conta, ...camposNumericos }]; campos: chaves numéricas a somar.
export function comSomasDeFilhas(linhas, campos) {
  const porId = new Map(linhas.map((l) => [l.conta.id, l]));
  const filhosPorPai = new Map();
  for (const l of linhas) {
    const paiId = l.conta.conta_pai_id;
    if (paiId && porId.has(paiId)) {
      if (!filhosPorPai.has(paiId)) filhosPorPai.set(paiId, []);
      filhosPorPai.get(paiId).push(l);
    }
  }

  const cache = new Map();
  function somaAgregada(l) {
    if (cache.has(l.conta.id)) return cache.get(l.conta.id);
    const filhos = filhosPorPai.get(l.conta.id) ?? [];
    const total = {};
    for (const campo of campos) total[campo] = l[campo] ?? 0;
    for (const filho of filhos) {
      const somaFilho = somaAgregada(filho);
      for (const campo of campos) total[campo] += somaFilho[campo];
    }
    cache.set(l.conta.id, total);
    return total;
  }

  // Filhas primeiro, soma sintética depois — como um subtotal de rodapé
  // (estilo clássico de razão contábil), não como cabeçalho antes do
  // detalhe. Mais fácil de ler: primeiro vê o que compõe, depois o total.
  function montar(l, nivel) {
    const agregada = somaAgregada(l);
    const filhos = (filhosPorPai.get(l.conta.id) ?? [])
      .sort((a, b) => a.conta.codigo.localeCompare(b.conta.codigo, undefined, { numeric: true }));
    return [
      ...filhos.flatMap((f) => montar(f, nivel + 1)),
      { ...l, ...agregada, nivelExibicao: nivel, temFilhas: filhos.length > 0 },
    ];
  }

  const raizes = linhas
    .filter((l) => !l.conta.conta_pai_id || !porId.has(l.conta.conta_pai_id))
    .sort((a, b) => a.conta.codigo.localeCompare(b.conta.codigo, undefined, { numeric: true }));

  return raizes.flatMap((l) => montar(l, 0));
}

// Soma só as linhas-raiz (nivelExibicao === 0) de um resultado já passado
// por comSomasDeFilhas — usado pra totais de grupo/resumo (Total Ativo,
// Total Passivo...): como cada raiz já carrega a soma agregada dela +
// filhas, somar todo mundo contaria a filha duas vezes.
export function somarRaizes(linhasComSoma, campos) {
  const raizes = linhasComSoma.filter((l) => l.nivelExibicao === 0);
  const total = {};
  for (const campo of campos) total[campo] = raizes.reduce((s, l) => s + (l[campo] ?? 0), 0);
  return total;
}

// ---------- BALANCETE ----------

// Retorna saldo por conta no período, já considerando a natureza da conta
// (devedora: saldo = débito - crédito | credora: saldo = crédito - débito)
export async function calcularBalancete(empresaId, { dataInicio, dataFim }) {
  const [{ data: contas, error: errContas }, { data: movimento, error: errMov }] = await Promise.all([
    supabase.from('contas_contabeis').select('*').eq('empresa_id', empresaId).eq('ativo', true).order('codigo'),
    supabase.from('vw_movimento_contas').select('*').eq('empresa_id', empresaId).gte('data', dataInicio).lte('data', dataFim),
  ]);
  if (errContas) throw errContas;
  if (errMov) throw errMov;

  // saldo anterior (tudo antes de dataInicio)
  const { data: movimentoAnterior, error: errAnterior } = await supabase
    .from('vw_movimento_contas')
    .select('*')
    .eq('empresa_id', empresaId)
    .lt('data', dataInicio);
  if (errAnterior) throw errAnterior;

  const porConta = {};
  for (const c of contas) {
    porConta[c.id] = {
      conta: c,
      saldoAnterior: 0,
      debito: 0,
      credito: 0,
      saldoAtual: 0,
    };
  }

  for (const m of movimentoAnterior) {
    if (!porConta[m.conta_id]) continue;
    const c = porConta[m.conta_id].conta;
    const delta = c.natureza === 'devedora'
      ? Number(m.total_debito) - Number(m.total_credito)
      : Number(m.total_credito) - Number(m.total_debito);
    porConta[m.conta_id].saldoAnterior += delta;
  }

  for (const m of movimento) {
    if (!porConta[m.conta_id]) continue;
    porConta[m.conta_id].debito += Number(m.total_debito);
    porConta[m.conta_id].credito += Number(m.total_credito);
  }

  for (const id of Object.keys(porConta)) {
    const linha = porConta[id];
    const movLiquido = linha.conta.natureza === 'devedora'
      ? linha.debito - linha.credito
      : linha.credito - linha.debito;
    linha.saldoAtual = linha.saldoAnterior + movLiquido;
  }

  return Object.values(porConta).sort((a, b) => a.conta.codigo.localeCompare(b.conta.codigo));
}

// ---------- DRE ----------

const ORDEM_DRE = [
  { grupo: 'receita_bruta', label: 'Receita Bruta', sinal: 1 },
  { grupo: 'deducao', label: '(-) Deduções', sinal: -1 },
  { grupo: 'custo', label: '(-) Custos', sinal: -1 },
  { grupo: 'despesa_administrativa', label: '(-) Despesas Administrativas', sinal: -1 },
  { grupo: 'despesa_comercial', label: '(-) Despesas Comerciais', sinal: -1 },
  { grupo: 'despesa_financeira', label: '(-) Despesas Financeiras', sinal: -1 },
  { grupo: 'outras_receitas', label: '(+) Outras Receitas', sinal: 1 },
  { grupo: 'outras_despesas', label: '(-) Outras Despesas', sinal: -1 },
  { grupo: 'ir_csll', label: '(-) IRPJ / CSLL', sinal: -1 },
];

export async function calcularDRE(empresaId, { dataInicio, dataFim }) {
  const balancete = await calcularBalancete(empresaId, { dataInicio, dataFim });

  const porGrupo = {};
  for (const linha of balancete) {
    const grupo = linha.conta.grupo_dre;
    if (!grupo) continue;
    const movimentoPeriodo = linha.conta.natureza === 'devedora'
      ? linha.debito - linha.credito
      : linha.credito - linha.debito;
    porGrupo[grupo] = (porGrupo[grupo] ?? 0) + movimentoPeriodo;
  }

  const linhas = ORDEM_DRE.map(({ grupo, label, sinal }) => ({
    grupo,
    label,
    valor: sinal * (porGrupo[grupo] ?? 0),
  }));

  const receitaBruta = linhas.find(l => l.grupo === 'receita_bruta')?.valor ?? 0;
  const deducoes = linhas.find(l => l.grupo === 'deducao')?.valor ?? 0;
  const custos = linhas.find(l => l.grupo === 'custo')?.valor ?? 0;
  const despesasOperacionais = ['despesa_administrativa', 'despesa_comercial', 'despesa_financeira']
    .reduce((s, g) => s + (linhas.find(l => l.grupo === g)?.valor ?? 0), 0);
  const outras = ['outras_receitas', 'outras_despesas']
    .reduce((s, g) => s + (linhas.find(l => l.grupo === g)?.valor ?? 0), 0);
  const irCsll = linhas.find(l => l.grupo === 'ir_csll')?.valor ?? 0;

  const receitaLiquida = receitaBruta + deducoes;
  const lucroBruto = receitaLiquida + custos;
  const resultadoOperacional = lucroBruto + despesasOperacionais;
  const resultadoAntesIR = resultadoOperacional + outras;
  const resultadoLiquido = resultadoAntesIR + irCsll;

  return {
    linhas,
    totais: {
      receitaBruta,
      receitaLiquida,
      lucroBruto,
      resultadoOperacional,
      resultadoAntesIR,
      resultadoLiquido,
    },
  };
}

// DRE simplificada: uma linha por conta de Receita/Despesa/Custo (sem os 9
// grupos fixos de antes) — cada conta já é a própria linha, "resultado" é
// receitas menos despesas menos custos. Mesma lógica de "movimento do
// período" que calcularDRE já usa por grupo, só que por conta. Custo entra
// aqui igual despesa (natureza devedora, reduz o resultado) — sem isso,
// contas de custo (ex: Telecomunicações, Energia Elétrica) ficam de fora da
// DRE mesmo tendo movimento, já que só apareciam no Balancete.
export async function calcularDREPorConta(empresaId, periodo) {
  return calcularDREPorContaCom(supabase, empresaId, periodo);
}

// Lançamentos individuais que compõem o total de uma conta num período —
// alimenta o razão contábil (sidebar de drill-down ao clicar numa conta na
// DRE/Balancete). Traz também a contrapartida (o outro lado da partida
// dobrada) pra dar pra reclassificar ela direto do razão, sem precisar ir
// até Lançamentos — em lançamento composto (mais de 2 partidas), pega só a
// primeira contrapartida encontrada, mesma simplificação já usada em
// LancamentosTab.jsx (PartidaCell).
export async function listarLancamentosPorConta(empresaId, contaId, { dataInicio, dataFim }) {
  let query = supabase
    .from('partidas_contabeis')
    .select(`id, tipo, valor, lancamento_id,
      lancamentos_contabeis!inner(id, data, historico, numero_documento, origem, empresa_id, conciliado,
        partidas_contabeis(id, tipo, valor, conta_id, contas_contabeis(id, codigo, nome)))`)
    .eq('conta_id', contaId)
    .eq('lancamentos_contabeis.empresa_id', empresaId);
  if (dataInicio) query = query.gte('lancamentos_contabeis.data', dataInicio);
  if (dataFim) query = query.lte('lancamentos_contabeis.data', dataFim);

  const { data, error } = await query;
  if (error) throw error;
  return data
    .map((p) => {
      const contrapartida = (p.lancamentos_contabeis.partidas_contabeis ?? []).find((x) => x.id !== p.id) ?? null;
      return {
        id: p.id,
        lancamentoId: p.lancamento_id,
        tipo: p.tipo,
        valor: Number(p.valor),
        data: p.lancamentos_contabeis.data,
        historico: p.lancamentos_contabeis.historico,
        numeroDocumento: p.lancamentos_contabeis.numero_documento,
        origem: p.lancamentos_contabeis.origem,
        conciliado: p.lancamentos_contabeis.conciliado,
        contrapartida: contrapartida ? {
          partidaId: contrapartida.id,
          contaId: contrapartida.conta_id,
          tipo: contrapartida.tipo,
          codigo: contrapartida.contas_contabeis?.codigo,
          nome: contrapartida.contas_contabeis?.nome,
        } : null,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

// Edita metadados de um lançamento (histórico, data, nº documento) — usado
// pelo razão contábil editável. Não mexe em valor/partidas, pra não quebrar
// o balanceamento débito=crédito.
export async function atualizarLancamento(id, patch) {
  const { data, error } = await supabase
    .from('lancamentos_contabeis')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Ponte com o OneFlow (aba "Lançar no OneFlow") ----------------------
// O OneFlow não tem API pra receber lançamentos: o Gestor gera a planilha
// oficial e registra o envio, marcando os lançamentos que foram nela
// (supabase-schema-contabil-oneflow-envios.sql) — assim o próximo arquivo
// leva só o que ainda não foi.

// lançamentos que nasceram de nota fiscal — o OneFlow já tem pelo Fiscal
export async function idsLancamentosDoFiscal(empresaId) {
  const { data, error } = await supabase
    .from('documentos_fiscais_erp')
    .select('lancamento_id')
    .eq('cliente_id', empresaId)
    .not('lancamento_id', 'is', null);
  if (error) throw error;
  return new Set((data ?? []).map((d) => d.lancamento_id));
}

export async function listarEnviosOneflow(empresaId) {
  const { data, error } = await supabase
    .from('oneflow_envios')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

// cria o envio e marca os lançamentos (em lotes, pra URL não estourar)
export async function registrarEnvioOneflow(empresaId, { lancamentoIds, dataInicio, dataFim, qtdLinhas, total, modo, arquivo, criadoPor }) {
  const { data: envio, error } = await supabase
    .from('oneflow_envios')
    .insert({
      empresa_id: empresaId, data_inicio: dataInicio, data_fim: dataFim,
      qtd_lancamentos: lancamentoIds.length, qtd_linhas: qtdLinhas, total, modo, arquivo, criado_por: criadoPor ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  const agora = new Date().toISOString();
  try {
    for (let i = 0; i < lancamentoIds.length; i += 150) {
      const { error: e2 } = await supabase
        .from('lancamentos_contabeis')
        .update({ oneflow_envio_id: envio.id, oneflow_enviado_em: agora })
        .in('id', lancamentoIds.slice(i, i + 150));
      if (e2) throw e2;
    }
  } catch (e) {
    await desfazerEnvioOneflow(envio.id).catch(() => {});
    throw e;
  }
  return envio;
}

// volta os lançamentos do envio para "a enviar" e apaga o registro
export async function desfazerEnvioOneflow(envioId) {
  const { error } = await supabase
    .from('lancamentos_contabeis')
    .update({ oneflow_envio_id: null, oneflow_enviado_em: null })
    .eq('oneflow_envio_id', envioId);
  if (error) throw error;
  const { error: e2 } = await supabase.from('oneflow_envios').delete().eq('id', envioId);
  if (e2) throw e2;
}

export async function listarLancamentosDoEnvio(envioId) {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from('lancamentos_contabeis')
      .select('*, partidas_contabeis(*, contas_contabeis(*))')
      .eq('oneflow_envio_id', envioId)
      .order('data')
      .order('id')
      .range(de, de + 999);
    if (error) throw error;
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}
