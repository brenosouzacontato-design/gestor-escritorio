// src/lib/guiaParcelamento.js
//
// Guia de parcelamento (PARCMEI da Receita ou PGFN-SISPAR): leitura do texto
// da guia e cadastro/atualização do parcelamento. Código compartilhado entre
// a tela Parcelamentos (navegador: parcelamentosApi.js, que passa o cliente
// Supabase logado) e o grupo "Documentos" do WhatsApp (servidor:
// netlify/functions/documento-processar-background.mjs, com a service key).
// Nada aqui importa o Supabase nem o pdf.js: quem chama entrega o texto da
// guia e o cliente do banco.

export const ORIGENS = {
  PARCMEI: { label: 'PARCMEI', desc: 'Parcelamento MEI — Receita', tipoDocumento: 'PARCELAMENTO MEI' },
  PGFN:    { label: 'PGFN',    desc: 'Dívida ativa — SISPAR/Regularize', tipoDocumento: 'PARCELAMENTO PGFN' },
};

const RE_CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const RE_LINHA = /(8\d{10})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)\s+(\d{11})\s+(\d)/;
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const brParaNumero = (s) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) : null);
const dataBrParaIso = (s) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "Maio/2026" → "05/2026" (formato de competência do Gestor)
function periodoParaCompetencia(periodo) {
  const m = /^([A-Za-zÀ-ú]+)\/(\d{4})$/.exec(periodo || '');
  if (!m) return null;
  const idx = MESES.indexOf(semAcento(m[1]));
  return idx >= 0 ? `${String(idx + 1).padStart(2, '0')}/${m[2]}` : null;
}

// Devolve null quando o texto não parece guia de parcelamento.
export function interpretarTextoGuia(texto) {
  const t = (texto || '').replace(/ /g, ' ');
  let origem = null;
  if (/PARCMEI/i.test(t)) origem = 'PARCMEI';
  else if (/SISPAR/i.test(t)) origem = 'PGFN';
  if (!origem) return null;

  // Documento do devedor: o primeiro CNPJ/CPF do cabeçalho
  const cnpj = RE_CNPJ.exec(t);
  const cpf = RE_CPF.exec(t);
  const doc = cnpj && (!cpf || cnpj.index < cpf.index) ? cnpj[0] : cpf?.[0] || null;

  // Nome: o que vem logo depois do documento, na mesma linha.
  // MEI costuma vir com o CPF colado no fim ("FULANO 12345678901").
  let nome = null;
  if (doc) {
    const linha = t.slice(t.indexOf(doc) + doc.length).split('\n')[0];
    nome = linha.replace(/\s+/g, ' ').trim()
      .replace(/^\d{2}\.\d{3}\.\d{3}\s+/, '')
      .replace(/\s+\d{11}$/, '') || null;
  }

  const linhaM = RE_LINHA.exec(t);
  const numeroDoc = /Número:\s*(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/.exec(t)?.[1]
    || /\b(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)\b/.exec(t)?.[1] || null;
  const vencimento = dataBrParaIso(/Pagar até:\s*(\d{2}\/\d{2}\/\d{4})/.exec(t)?.[1]);
  const valor = brParaNumero(/Valor:\s*([\d.]+,\d{2})/.exec(t)?.[1]
    || /Valor Total do Documento\s+([\d.]+,\d{2})/.exec(t)?.[1]);

  const parc = /Número da Parcela:\s*(\d+)\s*\/\s*(\d+)/.exec(t);
  const conta = origem === 'PGFN'
    ? /SISPAR:\s*(\d+)/.exec(t)?.[1] || null
    : /Número do Parcelamento:\s*(\d+)/.exec(t)?.[1] || null;
  const periodo = /\b([A-Za-zÀ-ú]+\/\d{4})\b/.exec(t)?.[1] || null;

  return {
    origem,                                   // 'PARCMEI' | 'PGFN'
    documento: doc,                           // formatado, como veio na guia
    documentoDigitos: soDigitos(doc),
    nome,
    conta,                                    // nº do PARCMEI (1, 2…) ou conta SISPAR
    parcela: parc ? Number(parc[1]) : null,
    totalParcelas: parc ? Number(parc[2]) : null,
    competencia: periodoParaCompetencia(periodo),   // só PGFN traz o mês da parcela
    vencimento,                               // ISO yyyy-mm-dd
    valor,
    linhaDigitavel: linhaM ? linhaM.slice(1).join('') : null,
    numeroDocumento: numeroDoc,
  };
}

const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

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
  // devedor já cadastrado como avulso antes: continua avulso
  if (parcelamentos.some((p) => p.documento_devedor === doc && !p.cliente_id)) {
    return { clienteId: null, como: null, avulso: true };
  }
  return { clienteId: null, como: null };
}

// Parcelamento da guia (chave: origem + CPF/CNPJ do devedor + conta): cria ou
// atualiza parcela atual, total, valor e último vencimento.
// Devolve a linha de `parcelamentos` + `criado` (true quando é novo).
export async function acharOuCriarParcelamento(supabase, dados, clienteId) {
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
    if (!existente.cliente_id && clienteId) patch.cliente_id = clienteId;
    if (!existente.nome_devedor && dados.nome) patch.nome_devedor = dados.nome;
    if (dados.totalParcelas) patch.total_parcelas = dados.totalParcelas;
    if (dados.parcela && dados.parcela > (existente.parcela_atual || 0)) patch.parcela_atual = dados.parcela;
    if (maisNova) {
      patch.ultima_guia_vencimento = dados.vencimento;
      if (dados.valor != null) patch.valor_parcela = dados.valor;
    }
    const { data, error: errUp } = await supabase.from('parcelamentos').update(patch).eq('id', existente.id).select().single();
    if (errUp) throw errUp;
    return { ...data, criado: false };
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
  return { ...data, criado: true };
}

// Obrigação de parcelamento em aberto da empresa na competência da guia
// (mês do vencimento). Só liga quando a escolha é inequívoca.
export async function acharObrigacaoParcelamento(supabase, clienteId, dados) {
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

// Campos da guia na linha de `documentos` (valor, vencimento, linha digitável
// e o vínculo com o parcelamento).
export function camposGuiaParcelamento(dados, parcelamentoId, obrigacaoId, agora = new Date().toISOString()) {
  return {
    tipo_documento_sugerido: ORIGENS[dados.origem].tipoDocumento,
    obrigacao_id: obrigacaoId || null,
    valor_guia: dados.valor,
    vencimento_guia: dados.vencimento,
    valor_guia_extraido_em: agora,
    linha_digitavel: dados.linhaDigitavel,
    codigos_extraidos_em: agora,
    parcelamento_id: parcelamentoId,
    parcela_numero: dados.parcela,
  };
}
