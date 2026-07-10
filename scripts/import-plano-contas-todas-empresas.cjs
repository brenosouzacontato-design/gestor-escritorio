const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const contasBase = JSON.parse(fs.readFileSync('C:/projetos/gestor-escritorio/scripts/plano_contas_oneflow.json', 'utf-8'));

async function main() {
  const { data: clientes, error } = await supabase.from('clientes').select('id, nome').order('nome');
  if (error) { console.error('erro ao listar clientes:', error.message); process.exit(1); }

  console.log(`Importando plano de contas (${contasBase.length} contas) para ${clientes.length} empresas...`);

  for (const cliente of clientes) {
    const contas = contasBase.map((c) => ({ ...c, empresa_id: cliente.id, nivel: c.codigo.split('.').length, aceita_lancamento: true, ativo: true }));
    const BATCH = 200;
    let falhou = false;
    for (let i = 0; i < contas.length; i += BATCH) {
      const lote = contas.slice(i, i + BATCH);
      const { error: errLote } = await supabase.from('contas_contabeis').upsert(lote, { onConflict: 'empresa_id,codigo' });
      if (errLote) {
        console.error(`  [${cliente.nome}] erro no lote ${i}-${i + BATCH}:`, errLote.message);
        falhou = true;
        break;
      }
    }
    console.log(`${falhou ? 'FALHOU' : 'OK'} — ${cliente.nome} (${cliente.id})`);
  }

  console.log('Concluído.');
}

main();
