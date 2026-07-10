/**
 * Importa o plano de contas OneFlow (já usado no Conciliador) para a
 * tabela contas_contabeis do Gestor.
 *
 * Como usar:
 * 1. Gere plano_contas_oneflow.json nesta pasta com um array de objetos
 *    { codigo, nome, tipo?, natureza?, grupo_dre? }. Se tipo/natureza não
 *    vierem no JSON, são inferidos pelo primeiro dígito do código
 *    (ver classificar() abaixo).
 * 2. Rode: node scripts/import-plano-contas.js <empresa_id>
 *
 * Requer: npm install @supabase/supabase-js
 * Variáveis de ambiente esperadas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (use a service_role key só localmente, nunca no client — como as tabelas
 * contábeis não têm RLS neste projeto, a anon key também funciona aqui)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const empresaId = process.argv[2];
if (!empresaId) {
  console.error('Uso: node import_plano_contas.js <empresa_id>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Classifica automaticamente tipo/natureza pelo primeiro dígito do código
// no plano de contas padrão contábil (1=Ativo, 2=Passivo, 3=PL, 4=Receita,
// 5=Custo, 6=Despesa). Ajuste se seu plano OneFlow usar outra convenção.
function classificar(codigo) {
  const primeiroDigito = codigo.trim()[0];
  switch (primeiroDigito) {
    case '1': return { tipo: 'ativo', natureza: 'devedora' };
    case '2': return { tipo: 'passivo', natureza: 'credora' };
    case '3': return { tipo: 'patrimonio_liquido', natureza: 'credora' };
    case '4': return { tipo: 'receita', natureza: 'credora' };
    case '5': return { tipo: 'custo', natureza: 'devedora' };
    case '6': return { tipo: 'despesa', natureza: 'devedora' };
    default: return { tipo: 'ativo', natureza: 'devedora' };
  }
}

function calcularNivel(codigo) {
  return codigo.split('.').length;
}

async function main() {
  const jsonPath = path.join(__dirname, 'plano_contas_oneflow.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`Arquivo não encontrado: ${jsonPath}`);
    console.error('Exporte o plano de contas do Conciliador para esse arquivo primeiro.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const contas = raw.map((item) => {
    const codigo = String(item.codigo ?? item.code ?? '').trim();
    const nome = String(item.nome ?? item.descricao ?? item.name ?? '').trim();
    // usa tipo/natureza do JSON se vierem prontos (ex: já derivados do gdre/nat
    // reais do OneFlow); senão cai no chute pelo primeiro dígito do código
    const { tipo, natureza } = item.tipo && item.natureza
      ? { tipo: item.tipo, natureza: item.natureza }
      : classificar(codigo);
    const nivel = calcularNivel(codigo);
    return {
      empresa_id: empresaId,
      codigo,
      nome,
      tipo,
      natureza,
      nivel,
      aceita_lancamento: nivel >= 3, // ajuste conforme a profundidade real do seu plano
      grupo_dre: item.grupo_dre ?? null, // contas sem grupo_dre: classifique manualmente na tela de Plano de Contas
      ativo: true,
    };
  }).filter((c) => c.codigo && c.nome);

  console.log(`Importando ${contas.length} contas para empresa ${empresaId}...`);

  const BATCH = 200;
  for (let i = 0; i < contas.length; i += BATCH) {
    const lote = contas.slice(i, i + BATCH);
    const { error } = await supabase.from('contas_contabeis').upsert(lote, {
      onConflict: 'empresa_id,codigo',
    });
    if (error) {
      console.error(`Erro no lote ${i}-${i + BATCH}:`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH, contas.length)}/${contas.length} importadas`);
  }

  console.log('Importação concluída. Ainda falta: definir conta_pai_id (hierarquia) e grupo_dre nas contas de receita/despesa — isso dá pra fazer depois direto na tela de Plano de Contas do módulo.');
}

main();
