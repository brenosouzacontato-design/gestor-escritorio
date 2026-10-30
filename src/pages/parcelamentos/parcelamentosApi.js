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
// Schema: supabase-schema-parcelamentos-guias.sql.
import { supabase } from '../../lib/supabase';
import { lerGuiaParcelamento } from './leitorGuiaParcelamento';

const BUCKET = 'documentos';
const soDigitos = (s) => (s || '').replace(/\D/g, '');
const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export const ORIGENS = {
  PARCMEI: { label: 'PARCMEI', desc: 'Parcelamento MEI — Receita', tipoDocumento: 'PARCELAMENTO MEI' },
  PGFN:    { label: 'PGFN',    desc: 'Dívida ativa — SISPAR/Regularize', tipoDocumento: 'PARCELAMENTO PGFN' },
};

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

export async function atualizarParcelamento(id, patch) {
  const { error } = await supabase
    .from('parcelamentos')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------- IMPORTAÇÃO (passo 1: ler e conferir, sem gravar) ----------

// Empresa da guia: pelo CNPJ; senão por um parcelamento já cadastrado com o
// mesmo devedor (PGFN de MEI vem no CPF da pessoa); senão pelo CPF colado no
// nome do MEI ("FULANO 12345678901"); senão pelo nome.
export function sugerirCliente(dados, clientes, parcelamentos) {
  const doc = dados.documentoDigitos;
  const porCnpj = clientes.find((c) => soDigitos(c.cnpj) === doc);
  if (porCnpj) return { clienteId: porCnpj.id, como: 'CNPJ' };

  const parc = parcelamentos.find((p) => p.documento_devedor === doc && p.cliente_id);
  if (parc) return { clienteId: parc.cliente_id, como: 'parcelamento anterior' };

  if (doc.length === 11) {
    const porCpf = clientes.find((c) => soDigitos(c.nome).includes(doc));
    if (porCpf) return { clienteId: porCpf.id, como: 'CPF no nome' };
  }
  const nome = normalizar(dados.nome);
  if (nome) {
    const porNome = clientes.filter((c) => normalizar(c.nome).replace(/\s*\d+$/, '') === nome);
    if (porNome.length === 1) return { clienteId: porNome[0].id, como: 'nome' };
  }
  return { clienteId: null, como: null };
}

export async function prepararImportacao(arquivos, clientes, parcelamentos) {
  const itens = [];
  for (const arquivo of arquivos) {
    const item = { chave: crypto.randomUUID(), arquivo, dados: null, erro: null, clienteId: null, como: null, duplicada: false };
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

async function acharOuCriarParcelamento(dados, clienteId) {
  const { data: existente, error } = await supabase
    .from('parcelamentos')
    .select('*')
    .eq('origem', dados.origem)
    .eq('documento_devedor', dados.documentoDigitos)
    .eq('conta', dados.conta)
    .maybeSingle();
  if (error) throw error;

  const maisNova = !existente?.ultima_guia_vencimento || (dados.vencimento && dados.vencimento >= existente.ultima_guia_vencimento);
  const agora = new Date().toISOString();

  if (existente) {
    const patch = { updated_at: agora };
    if (!existente.cliente_id) patch.cliente_id = clienteId;
    if (dados.totalParcelas) patch.total_parcelas = dados.totalParcelas;
    if (dados.parcela && dados.parcela > (existente.parcela_atual || 0)) patch.parcela_atual = dados.parcela;
    if (maisNova) {
      patch.ultima_guia_vencimento = dados.vencimento;
      if (dados.valor != null) patch.valor_parcela = dados.valor;
    }
    const { data, error: errUp } = await supabase.from('parcelamentos').update(patch).eq('id', existente.id).select().single();
    if (errUp) throw errUp;
    return data;
  }

  const { data, error: errIns } = await supabase.from('parcelamentos').insert({
    cliente_id: clienteId,
    origem: dados.origem,
    conta: dados.conta,
    documento_devedor: dados.documentoDigitos,
    nome_devedor: dados.nome,
    tipo: ORIGENS[dados.origem].tipoDocumento,
    numero_processo: dados.conta,
    descricao: ORIGENS[dados.origem].desc,
    total_parcelas: dados.totalParcelas,
    parcela_atual: dados.parcela,
    valor_parcela: dados.valor,
    vencimento_dia: dados.vencimento ? Number(dados.vencimento.slice(8, 10)) : null,
    ultima_guia_vencimento: dados.vencimento,
    status: 'ativo',
  }).select().single();
  if (errIns) throw errIns;
  return data;
}

// Obrigação de parcelamento em aberto da empresa na competência da guia
// (mês do vencimento). Só liga quando a escolha é inequívoca.
async function acharObrigacao(clienteId, dados) {
  if (!dados.vencimento) return null;
  const competencia = `${dados.vencimento.slice(5, 7)}/${dados.vencimento.slice(0, 4)}`;
  const { data } = await supabase
    .from('obrigacoes')
    .select('id, titulo, tipo')
    .eq('cliente_id', clienteId)
    .eq('competencia', competencia)
    .in('status', ['pendente', 'vencido']);
  const deParcelamento = (data || []).filter((o) => /PARCEL/i.test(`${o.titulo || ''} ${o.tipo || ''}`));
  if (deParcelamento.length === 1) return deParcelamento[0].id;
  const daOrigem = deParcelamento.filter((o) => {
    const t = `${o.titulo || ''} ${o.tipo || ''}`;
    return dados.origem === 'PARCMEI' ? /MEI/i.test(t) : /PGFN|D[IÍ]VIDA|ATIVA/i.test(t);
  });
  return daOrigem.length === 1 ? daOrigem[0].id : null;
}

export async function salvarGuia(item) {
  const { dados, arquivo, clienteId } = item;
  if (!clienteId) throw new Error('Escolha a empresa.');

  const parcelamento = await acharOuCriarParcelamento(dados, clienteId);

  const path = `parcelamentos/${crypto.randomUUID()}.pdf`;
  const { error: errUp } = await supabase.storage.from(BUCKET).upload(path, arquivo, { contentType: 'application/pdf' });
  if (errUp) throw errUp;

  const obrigacaoId = await acharObrigacao(clienteId, dados).catch(() => null);
  const agora = new Date().toISOString();
  const { error } = await supabase.from('documentos').insert({
    cliente_id: clienteId,
    nome_arquivo: arquivo.name,
    storage_path: path,
    tipo_mime: 'application/pdf',
    tamanho_bytes: arquivo.size,
    tipo_documento_sugerido: ORIGENS[dados.origem].tipoDocumento,
    status: 'confirmado',
    confirmado_em: agora,
    obrigacao_id: obrigacaoId,
    valor_guia: dados.valor,
    vencimento_guia: dados.vencimento,
    valor_guia_extraido_em: agora,
    linha_digitavel: dados.linhaDigitavel,
    codigos_extraidos_em: agora,
    parcelamento_id: parcelamento.id,
    parcela_numero: dados.parcela,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return { parcelamentoId: parcelamento.id, ligadaObrigacao: !!obrigacaoId };
}
