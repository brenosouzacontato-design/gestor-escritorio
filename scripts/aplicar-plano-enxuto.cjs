// scripts/aplicar-plano-enxuto.cjs
//
// Troca o plano de contas de uma empresa no Gestor do Plano Padrão OneFlow
// (743 contas) para o Plano Enxuto Breno Contador — o MESMO plano cadastrado
// no OneFlow ("Plano Enxuto Breno Contador"), pra que a exportação de
// lançamentos (aba Lançamentos > Exportar p/ OneFlow) bata conta a conta.
//
// O que faz, por empresa:
//  1. cria/atualiza as contas do enxuto (src/pages/contabil/planos/plano_contas_enxuto.json)
//     com hierarquia (conta_pai_id), grupo_dre e aceita_lancamento certos;
//  2. move as partidas e as regras de classificação de cada conta antiga
//     pra conta nova, pelo de-para (src/pages/contabil/planos/depara_padrao_para_enxuto.json);
//     - contas de banco 1.1.01.003.001..005 viram 1.1.01.002..006 e a conta
//       nova herda o nome do banco (ex.: "Nubank");
//     - sub-contas de fornecedor criadas pelo Gestor são mantidas, só
//       mudam de código pra dentro do grupo 2.1.01 (Fornecedores);
//  3. desativa (ativo=false) todas as contas antigas — nada é apagado.
//
// Uso (variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente):
//   node scripts/aplicar-plano-enxuto.cjs --empresa=<id>            (simulação, não grava)
//   node scripts/aplicar-plano-enxuto.cjs --empresa=<id> --aplicar  (grava)
//   node scripts/aplicar-plano-enxuto.cjs --todas [--aplicar]
// Opcional: --fallback  -> conta antiga sem de-para (ex.: criada à mão) vai
//   pra conta "genérica" do tipo (Outras Receitas / Despesas Diversas /
//   Materiais Aplicados). Sem essa flag a empresa é pulada e o script lista
//   as contas que precisam de de-para.

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PLANO = require(path.join(__dirname, '../src/pages/contabil/planos/plano_contas_enxuto.json'));
const DEPARA = require(path.join(__dirname, '../src/pages/contabil/planos/depara_padrao_para_enxuto.json'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APLICAR = process.argv.includes('--aplicar');
const FALLBACK = process.argv.includes('--fallback');
const argEmpresa = process.argv.find((a) => a.startsWith('--empresa='));
const TODAS = process.argv.includes('--todas');

const CODIGOS_ENXUTO = new Set(PLANO.map((c) => c.codigo));
const ANALITICAS_ENXUTO = new Set(PLANO.filter((c) => !c.sintetica).map((c) => c.codigo));
const FALLBACK_POR_TIPO = { receita: '3.2.01.003', despesa: '4.2.02.099', custo: '4.1.01.002' };
const MARCADOR = '1.1.01.099'; // "Valores a Identificar" do enxuto: se existe, plano já aplicado

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function contarPartidas(ids) {
  const contagem = new Map();
  for (const lote of chunks(ids, 150)) {
    let de = 0;
    for (;;) {
      const { data, error } = await supabase.from('partidas_contabeis').select('conta_id').in('conta_id', lote).range(de, de + 999);
      if (error) throw error;
      for (const p of data) contagem.set(p.conta_id, (contagem.get(p.conta_id) || 0) + 1);
      if (data.length < 1000) break;
      de += 1000;
    }
  }
  return contagem;
}

async function migrarEmpresa(empresa) {
  const log = (m) => console.log(`[${empresa.nome}] ${m}`);
  const { data: contas, error } = await supabase.from('contas_contabeis')
    .select('id, codigo, nome, tipo, aceita_lancamento, ativo, conta_pai_id').eq('empresa_id', empresa.id);
  if (error) throw error;
  if (contas.some((c) => c.codigo === MARCADOR)) { log('já está no Plano Enxuto — pulando.'); return; }

  const { data: regras, error: errRegras } = await supabase.from('regras_classificacao')
    .select('id, conta_id').eq('empresa_id', empresa.id);
  if (errRegras) throw errRegras;

  const contagem = await contarPartidas(contas.map((c) => c.id));
  const comRegra = new Set(regras.map((r) => r.conta_id));
  const porId = new Map(contas.map((c) => [c.id, c]));

  // grupo "Fornecedores" criado pela reformulação sobre o plano padrão
  const grupoFornAntigo = contas.find((c) => c.nome.trim().toLowerCase() === 'fornecedores' && !c.aceita_lancamento && !CODIGOS_ENXUTO.has(c.codigo));
  const ehSubFornecedor = (c) => grupoFornAntigo && c.conta_pai_id === grupoFornAntigo.id;

  const mapa = new Map(); // id antigo -> código novo
  const renomearBanco = new Map(); // código novo -> nome do banco
  const semDepara = [];
  for (const c of contas) {
    if (CODIGOS_ENXUTO.has(c.codigo) || ehSubFornecedor(c)) continue;
    const usada = (contagem.get(c.id) || 0) > 0 || comRegra.has(c.id);
    if (!usada) continue;
    let novo = DEPARA[c.codigo];
    if (novo && /^1\.1\.01\.003\.\d+$/.test(c.codigo)) renomearBanco.set(novo, c.nome);
    if (!novo && FALLBACK) novo = FALLBACK_POR_TIPO[c.tipo];
    if (!novo || !ANALITICAS_ENXUTO.has(novo)) { semDepara.push(c); continue; }
    mapa.set(c.id, novo);
  }
  if (semDepara.length) {
    log(`PULADA — ${semDepara.length} conta(s) com movimento sem de-para (use --fallback ou acrescente no de-para):`);
    for (const c of semDepara) log(`   ${c.codigo}  ${c.nome}  (${c.tipo}, ${contagem.get(c.id) || 0} partidas)`);
    return;
  }
  const subFornecedores = contas.filter(ehSubFornecedor);
  log(`${mapa.size} conta(s) antigas com movimento serão migradas; ${subFornecedores.length} fornecedor(es) mantidos; ${renomearBanco.size} banco(s) renomeados.`);
  if (!APLICAR) {
    const resumo = new Map();
    for (const [id, novo] of mapa) resumo.set(novo, [...(resumo.get(novo) || []), porId.get(id).codigo]);
    for (const [novo, antigos] of [...resumo].sort()) log(`   ${novo} <- ${antigos.join(', ')}`);
    log('(simulação — nada gravado; rode com --aplicar)');
    return;
  }

  // 1) upsert das contas do enxuto, nível a nível (pai antes do filho)
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]));
  const niveis = [...new Set(PLANO.map((c) => c.codigo.split('.').length))].sort((a, b) => a - b);
  for (const nivel of niveis) {
    const linhas = PLANO.filter((c) => c.codigo.split('.').length === nivel).map((c) => {
      const pai = c.codigo.split('.').slice(0, -1).join('.');
      return {
        empresa_id: empresa.id,
        codigo: c.codigo,
        nome: renomearBanco.get(c.codigo) || c.nome,
        tipo: c.tipo,
        natureza: c.natureza,
        nivel,
        aceita_lancamento: !c.sintetica,
        grupo_dre: c.grupo_dre,
        conta_pai_id: pai ? idPorCodigo.get(pai) ?? null : null,
        ativo: true,
      };
    });
    const { data, error: errUp } = await supabase.from('contas_contabeis')
      .upsert(linhas, { onConflict: 'empresa_id,codigo' }).select('id, codigo');
    if (errUp) throw errUp;
    for (const r of data) idPorCodigo.set(r.codigo, r.id);
  }

  // 2) partidas e regras: conta antiga -> conta nova
  for (const [idAntigo, codigoNovo] of mapa) {
    const idNovo = idPorCodigo.get(codigoNovo);
    const { error: e1 } = await supabase.from('partidas_contabeis').update({ conta_id: idNovo }).eq('conta_id', idAntigo);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from('regras_classificacao').update({ conta_id: idNovo }).eq('conta_id', idAntigo);
    if (e2) throw e2;
  }

  // 3) fornecedores do Gestor passam pro grupo 2.1.01 (2.1.01.101, .102...)
  const grupoForn = idPorCodigo.get('2.1.01');
  let seq = 100;
  for (const f of subFornecedores.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    seq += 1;
    const { error: e3 } = await supabase.from('contas_contabeis')
      .update({ codigo: `2.1.01.${seq}`, conta_pai_id: grupoForn, nivel: 4, tipo: 'passivo', natureza: 'credora', ativo: true })
      .eq('id', f.id);
    if (e3) throw e3;
  }

  // 4) desativa o resto do plano antigo
  const manter = new Set([...idPorCodigo.entries()].filter(([cod]) => CODIGOS_ENXUTO.has(cod)).map(([, id]) => id));
  for (const f of subFornecedores) manter.add(f.id);
  const desativar = contas.filter((c) => !manter.has(c.id) && c.ativo).map((c) => c.id);
  for (const lote of chunks(desativar, 150)) {
    const { error: e4 } = await supabase.from('contas_contabeis').update({ ativo: false }).in('id', lote);
    if (e4) throw e4;
  }
  log(`OK — plano enxuto aplicado; ${desativar.length} conta(s) antigas desativadas.`);
}

async function main() {
  if (!argEmpresa && !TODAS) {
    console.error('Uso: node scripts/aplicar-plano-enxuto.cjs --empresa=<id> | --todas [--aplicar] [--fallback]');
    process.exit(1);
  }
  let query = supabase.from('clientes').select('id, nome').order('nome');
  if (argEmpresa) query = query.eq('id', argEmpresa.split('=')[1]);
  const { data: empresas, error } = await query;
  if (error) throw error;
  for (const empresa of empresas) {
    try { await migrarEmpresa(empresa); } catch (e) { console.error(`[${empresa.nome}] ERRO: ${e.message}`); }
  }
}

main();
