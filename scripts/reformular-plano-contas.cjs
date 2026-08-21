// scripts/reformular-plano-contas.js
//
// Migração ÚNICA: cria os grupos sintéticos por cima do plano de contas
// achatado (743 contas "folha" por empresa, importado da Omie), religando
// cada conta existente ao seu grupo via conta_pai_id. Não altera código,
// nome, tipo ou valor de nenhuma conta já existente — só adiciona contas
// de grupo (aceita_lancamento=false) e preenche conta_pai_id.
//
// Também cria uma conta sintética nova "Fornecedores" dentro do grupo
// "Fornecedores e Contas a Pagar Diversas" (2.1.06.001) — não existia
// nenhuma conta de fornecedores no plano original; é nela que a tela de
// Notas Fiscais vai criar a sub-conta de cada fornecedor.
//
// Uso: node scripts/reformular-plano-contas.js [--empresa=<id>] [--dry-run]
//   sem --empresa roda em todas as empresas ativas.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente antes de rodar.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MAPA_GRUPOS = require('./plano-contas-grupos.json'); // { codigo: nome }

const NATUREZA_POR_TIPO = {
  ativo: 'devedora', custo: 'devedora', despesa: 'devedora',
  passivo: 'credora', patrimonio_liquido: 'credora', receita: 'credora',
};

function tipoDoPrefixo(codigo) {
  const raiz = codigo.split('.')[0];
  if (raiz === '1') return 'ativo';
  if (raiz === '2') return codigo.startsWith('2.3') ? 'patrimonio_liquido' : 'passivo';
  if (raiz === '3') return 'receita';
  if (raiz === '4') return 'custo';
  if (raiz === '5') return 'despesa';
  if (raiz === '6') return 'despesa';
  return 'despesa';
}

const DRY_RUN = process.argv.includes('--dry-run');
const argEmpresa = process.argv.find((a) => a.startsWith('--empresa='));
const EMPRESA_UNICA = argEmpresa ? argEmpresa.split('=')[1] : null;

async function migrarEmpresa(empresa) {
  const log = (msg) => console.log(`[${empresa.nome}] ${msg}`);

  const { data: existentes, error: errExistentes } = await supabase
    .from('contas_contabeis')
    .select('id, codigo')
    .eq('empresa_id', empresa.id);
  if (errExistentes) throw errExistentes;

  const idPorCodigo = new Map(existentes.map((c) => [c.codigo, c.id]));
  const jaTinhaGrupos = existentes.some((c) => MAPA_GRUPOS[c.codigo]);
  if (jaTinhaGrupos) {
    log('já tem grupos criados, pulando (idempotente).');
    return { criados: 0, religados: 0, fornecedoresCriado: false };
  }

  // 1) Cria os grupos em ordem de nível (pais antes de filhos), um lote
  // bulk-insert por nível — os ids retornados alimentam o nível seguinte.
  const porNivel = new Map();
  for (const codigo of Object.keys(MAPA_GRUPOS)) {
    const nivel = codigo.split('.').length;
    (porNivel.get(nivel) || porNivel.set(nivel, []).get(nivel)).push(codigo);
  }
  const niveis = [...porNivel.keys()].sort((a, b) => a - b);

  let criados = 0;
  for (const nivel of niveis) {
    const codigos = porNivel.get(nivel);
    const linhas = codigos.map((codigo) => {
      const partes = codigo.split('.');
      const paiCodigo = partes.slice(0, -1).join('.');
      const tipo = tipoDoPrefixo(codigo);
      return {
        empresa_id: empresa.id,
        codigo,
        nome: MAPA_GRUPOS[codigo].replace(' (⚠ ver nota)', ''),
        tipo,
        natureza: NATUREZA_POR_TIPO[tipo],
        nivel,
        aceita_lancamento: false,
        conta_pai_id: paiCodigo ? (idPorCodigo.get(paiCodigo) || null) : null,
      };
    });
    if (DRY_RUN) {
      log(`(dry-run) criaria ${linhas.length} grupos no nível ${nivel}`);
      codigos.forEach((c) => idPorCodigo.set(c, `dry-${c}`)); // permite níveis seguintes resolverem o pai
      continue;
    }
    const { data, error } = await supabase.from('contas_contabeis').insert(linhas).select('id, codigo');
    if (error) throw error;
    data.forEach((row) => idPorCodigo.set(row.codigo, row.id));
    criados += data.length;
  }
  log(`${criados} grupos criados.`);

  // 2) Religa as contas EXISTENTES (folha) ao seu grupo pai imediato —
  // agrupa por pai e faz um update em lote por grupo (não um por conta).
  const idsPorPai = new Map(); // paiCodigo -> [contaId, ...]
  for (const conta of existentes) {
    const partes = conta.codigo.split('.');
    if (partes.length <= 1) continue;
    const paiCodigo = partes.slice(0, -1).join('.');
    if (!MAPA_GRUPOS[paiCodigo]) continue; // não é um dos grupos que criamos
    (idsPorPai.get(paiCodigo) || idsPorPai.set(paiCodigo, []).get(paiCodigo)).push(conta.id);
  }
  let religados = 0;
  for (const [paiCodigo, ids] of idsPorPai) {
    const paiId = idPorCodigo.get(paiCodigo);
    if (!paiId) continue;
    if (DRY_RUN) { log(`(dry-run) religaria ${ids.length} contas em "${paiCodigo}"`); religados += ids.length; continue; }
    const { error } = await supabase.from('contas_contabeis').update({ conta_pai_id: paiId }).in('id', ids);
    if (error) throw error;
    religados += ids.length;
  }
  log(`${religados} contas religadas ao grupo.`);

  // 3) Cria a conta sintética "Fornecedores" — novidade, não existia no
  // plano original. Fica dentro de "2.1.06.001" (Fornecedores e Contas a
  // Pagar Diversas), com o próximo número de 3 dígitos livre no grupo,
  // mesma convenção usada em criarContaFilha (contabilApi.js).
  const codigoPaiFornecedores = '2.1.06.001';
  const paiFornecedoresId = idPorCodigo.get(codigoPaiFornecedores);
  let fornecedoresCriado = false;
  if (paiFornecedoresId) {
    const { data: irmaos, error: errIrmaos } = await supabase
      .from('contas_contabeis')
      .select('codigo')
      .eq('empresa_id', empresa.id)
      .like('codigo', `${codigoPaiFornecedores}.%`);
    if (errIrmaos) throw errIrmaos;
    const numeros = irmaos
      .map((c) => c.codigo.split('.').pop())
      .map((n) => parseInt(n, 10))
      .filter((n) => !Number.isNaN(n));
    const proximoNumero = (numeros.length > 0 ? Math.max(...numeros) : 0) + 1;
    const codigoFornecedores = `${codigoPaiFornecedores}.${String(proximoNumero).padStart(3, '0')}`;
    if (DRY_RUN) {
      log(`(dry-run) criaria conta sintética "Fornecedores" em ${codigoFornecedores}`);
    } else {
      const { error: errFornecedores } = await supabase.from('contas_contabeis').insert({
        empresa_id: empresa.id,
        codigo: codigoFornecedores,
        nome: 'Fornecedores',
        tipo: 'passivo',
        natureza: 'credora',
        nivel: codigoFornecedores.split('.').length,
        aceita_lancamento: false,
        conta_pai_id: paiFornecedoresId,
      });
      if (errFornecedores) throw errFornecedores;
      log(`conta sintética "Fornecedores" criada em ${codigoFornecedores}.`);
    }
    fornecedoresCriado = true;
  } else {
    log('AVISO: grupo 2.1.06.001 não foi criado, não deu pra criar "Fornecedores".');
  }

  return { criados, religados, fornecedoresCriado };
}

async function main() {
  let empresas;
  if (EMPRESA_UNICA) {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('id', EMPRESA_UNICA).single();
    if (error) throw error;
    empresas = [data];
  } else {
    const { data, error } = await supabase.from('clientes').select('id, nome').eq('ativo', true).order('nome');
    if (error) throw error;
    empresas = data;
  }

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Migrando ${empresas.length} empresa(s)...\n`);
  const resumo = [];
  for (const empresa of empresas) {
    try {
      const r = await migrarEmpresa(empresa);
      resumo.push({ empresa: empresa.nome, ...r });
    } catch (e) {
      console.error(`[${empresa.nome}] ERRO:`, e.message);
      resumo.push({ empresa: empresa.nome, erro: e.message });
    }
  }
  console.log('\n=== RESUMO ===');
  console.table(resumo);
}

main().catch((e) => { console.error(e); process.exit(1); });
