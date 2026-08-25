// scripts/diagnosticar-sync-nf.cjs
//
// Roda a sincronização de documentos fiscais localmente (não via Netlify
// Function) pra ver o erro de cada empresa individualmente, sem cair no
// timeout de conexão que a chamada HTTP direta enfrenta.
const { createClient } = require('@supabase/supabase-js');
const { renovarTokenEmpresa, sincronizarDocumentosCliente, competenciaAtual, competenciaAnterior } = require('../netlify/functions/lib/oneflowFiscal');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const { data: cfg } = await supabase.from('configuracoes').select('valor').eq('chave', 'of_user_token').maybeSingle();
  const userToken = cfg?.valor;
  if (!userToken) { console.error('of_user_token ausente'); process.exit(1); }

  const { data: clientes } = await supabase.from('clientes').select('id, nome, oneflow_app_hash').eq('ativo', true).not('oneflow_app_hash', 'is', null).order('nome');
  console.log(`Sincronizando ${clientes.length} empresas...\n`);

  const competencias = [competenciaAtual(), competenciaAnterior()];
  let ok = 0;
  const falhas = [];

  for (const cliente of clientes) {
    try {
      const token = await renovarTokenEmpresa(cliente.oneflow_app_hash, userToken);
      let totalLinhas = 0;
      for (const competencia of competencias) {
        totalLinhas += await sincronizarDocumentosCliente(supabase, cliente, token, competencia);
      }
      console.log(`OK  ${cliente.nome} — ${totalLinhas} linhas`);
      ok++;
    } catch (e) {
      console.log(`ERRO ${cliente.nome} — ${e.message}`);
      falhas.push({ nome: cliente.nome, erro: e.message });
    }
  }

  console.log(`\n=== RESUMO: ${ok}/${clientes.length} ok, ${falhas.length} falhas ===`);
  falhas.forEach((f) => console.log(` - ${f.nome}: ${f.erro}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
