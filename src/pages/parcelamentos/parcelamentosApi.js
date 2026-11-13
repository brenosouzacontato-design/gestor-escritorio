// parcelamentosApi.js
// Camada de dados do módulo Parcelamentos (ParcelamentosPage.jsx).
//
// Cadastro pela guia: o escritório sobe o PDF, o navegador lê os dados
// (leitorGuiaParcelamento.js), aqui se acha a empresa, cria/atualiza o
// parcelamento (chave: origem + CPF/CNPJ do devedor + conta) e grava a guia
// em `documentos` (bucket "documentos"), ligada ao parcelamento. Quando a
// empresa tem uma obrigação de parcelamento em aberto na competência da guia,
// a guia é ligada a ela também — é isso que a faz aparecer na baixa de
// pagamentos (pagamentosApi.listarGuiasPendentes) e no painel do cliente.
// Parcelamento "avulso": devedor que não é cliente cadastrado. Fica sem
// empresa (cliente_id nulo); o robô busca a guia e manda no WhatsApp do
// mesmo jeito, só não liga a obrigação nem ao painel. Dá pra ligar a uma
// empresa depois (vincularEmpresa).
// Schema: supabase-schema-parcelamentos-guias.sql.
import { supabase } from '../../lib/supabase';
import { lerGuiaParcelamento } from './leitorGuiaParcelamento';
import { perguntarAvisoPainel } from '../../lib/avisoPainelFila';
import {
  ORIGENS, sugerirCliente, acharOuCriarParcelamento, acharObrigacaoParcelamento, camposGuiaParcelamento,
} from '../../lib/guiaParcelamento';

export { ORIGENS, sugerirCliente };

const BUCKET = 'documentos';

// ---------- LEITURA ----------

export async function listarParcelamentos() {
  const { data, error } = await supabase
    .from('parcelamentos')
    .select('*, clientes(id, nome, cnpj)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const ids = (data || []).map((p) => p.id);
  let guias = [];
  if (ids.length) {
    const { data: docs, error: errDocs } = await supabase
      .from('documentos')
      .select('id, parcelamento_id, nome_arquivo, storage_path, valor_guia, vencimento_guia, parcela_numero, pago_em, obrigacao_id, created_at')
      .in('parcelamento_id', ids)
      .order('vencimento_guia', { ascending: false, nullsFirst: false });
    if (errDocs) throw errDocs;
    guias = docs || [];
  }
  const porParc = {};
  for (const g of guias) (porParc[g.parcelamento_id] ||= []).push(g);
  return (data || []).map((p) => ({ ...p, guias: porParc[p.id] || [] }));
}

export async function urlDaGuia(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 10);
  if (error) throw error;
  return data.signedUrl;
}

// Liga um parcelamento avulso (e as guias dele) a uma empresa cadastrada.
export async function vincularEmpresa(parcelamentoId, clienteId) {
  await atualizarParcelamento(parcelamentoId, { cliente_id: clienteId });
  const { error } = await supabase.from('documentos').update({ cliente_id: clienteId })
    .eq('parcelamento_id', parcelamentoId).is('cliente_id', null);
  if (error) throw error;
}

export async function atualizarParcelamento(id, patch) {
  const { error } = await supabase
    .from('parcelamentos')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------- IMPORTAÇÃO (passo 1: ler e conferir, sem gravar) ----------

export async function prepararImportacao(arquivos, clientes, parcelamentos) {
  const itens = [];
  for (const arquivo of arquivos) {
    const item = { chave: crypto.randomUUID(), arquivo, dados: null, erro: null, clienteId: null, como: null, avulso: false, duplicada: false };
    try {
      item.dados = await lerGuiaParcelamento(arquivo);
      Object.assign(item, sugerirCliente(item.dados, clientes, parcelamentos));
    } catch (e) {
      item.erro = e.message;
    }
    itens.push(item);
  }

  // guias já importadas (mesma linha digitável)
  const linhas = itens.map((i) => i.dados?.linhaDigitavel).filter(Boolean);
  if (linhas.length) {
    const { data } = await supabase.from('documentos').select('linha_digitavel').in('linha_digitavel', linhas);
    const ja = new Set((data || []).map((d) => d.linha_digitavel));
    for (const i of itens) if (i.dados && ja.has(i.dados.linhaDigitavel)) i.duplicada = true;
  }
  return itens;
}

// ---------- IMPORTAÇÃO (passo 2: gravar) ----------

// Cadastro do parcelamento e vínculo com a obrigação: src/lib/guiaParcelamento.js
// (o grupo "Documentos" do WhatsApp usa o mesmo código).

export async function salvarGuia(item) {
  const { dados, arquivo, avulso } = item;
  const clienteId = avulso ? null : item.clienteId;
  if (!clienteId && !avulso) throw new Error('Escolha a empresa ou marque como avulso.');

  const parcelamento = await acharOuCriarParcelamento(supabase, dados, clienteId);

  const path = `parcelamentos/${crypto.randomUUID()}.pdf`;
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: 'application/pdf' });
  if (errUp) throw errUp;

  const obrigacaoId = clienteId ? await acharObrigacaoParcelamento(supabase, clienteId, dados).catch(() => null) : null;
  const agora = new Date().toISOString();
  const { error } = await supabase.from('documentos').insert({
    cliente_id: clienteId,
    nome_arquivo: arquivo.name,
    storage_path: path,
    tipo_mime: 'application/pdf',
    tamanho_bytes: arquivo.size,
    status: 'confirmado',
    confirmado_em: agora,
    ...camposGuiaParcelamento(dados, parcelamento.id, obrigacaoId, agora),
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  // guia nova: pergunta se avisa o cliente no WhatsApp
  perguntarAvisoPainel(clienteId);
  return { parcelamentoId: parcelamento.id, ligadaObrigacao: !!obrigacaoId };
}
