// netlify/functions/lib/comprovantePagamento.js
//
// Baixa de guia por comprovante de pagamento. O comprovante chega pelo
// WhatsApp (grupo "Pagamentos" — e, como antes, comprovantes que caem no
// grupo "Documentos"; ver whatsapp-webhook.js) e aqui:
//   1. a IA lê o comprovante (pagador, CNPJ/CPF, valor, data, descrição,
//      banco) e tenta casar com uma guia de imposto anexada ainda sem
//      pagamento;
//   2. a empresa é identificada pela guia escolhida ou, sem guia, pelo
//      CNPJ/CPF do pagador comparado com o cadastro de clientes;
//   3. com confiança "alta" E valor compatível com o da guia, a baixa é
//      automática (documentos.pago_em + comprovante disponível no painel do
//      cliente); senão o comprovante fica na fila (comprovantes_pagamento,
//      status 'pendente') pra o escritório conferir na tela Pagamentos
//      (src/pages/pagamentos/PagamentosPage.jsx).
// Todo comprovante recebido fica registrado em comprovantes_pagamento,
// inclusive os baixados automaticamente (auditoria e "desfazer").
// Honorários: o mesmo comprovante pode ser o cliente pagando o HONORÁRIO do
// escritório (PIX/transferência para o escritório). A IA recebe também a
// lista de honorários em aberto; com confiança "alta" e valor compatível, o
// honorário é marcado como pago (honorarios.status = 'pago') com o
// comprovante. Colunas: supabase-schema-honorarios-comprovante.sql — sem
// elas aplicadas, a baixa do honorário grava só status e data.

const crypto = require('crypto');
const { EXTENSAO_POR_MIME, tipoReal, leituraPossivel, blocoArquivo, limparBase64, textoLegenda } = require('./midiaWhatsapp');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';
// Mesmo critério de "é imposto" do painel (PainelCompartilhadoPage.jsx) —
// anexo de obrigação que não é imposto (ex: holerites) não é guia a pagar.
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia|maed|multa/i;

const SYSTEM_PROMPT = `Você é um assistente de escritório contábil brasileiro. Recebe um arquivo, uma lista de guias de imposto em aberto de vários clientes e uma lista de honorários do escritório em aberto. Precisa: 1) dizer se o arquivo é um COMPROVANTE DE PAGAMENTO já efetuado (recibo do banco, comprovante de PIX, comprovante de pagamento de boleto/arrecadação); 2) ler as informações básicas dele; 3) dizer de qual guia da lista é esse pagamento OU, se for o cliente pagando o escritório, de qual honorário.

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"ehComprovante":true|false,"pagadorNome":"string ou null","pagadorDocumento":"CNPJ/CPF ou null","valorPago":number ou null,"dataPagamento":"YYYY-MM-DD ou null","descricao":"string ou null","banco":"string ou null","guiaId":"id da lista ou null","honorarioId":"id da lista de honorários ou null","confianca":"alta"|"media"|"baixa","observacao":"string curta"}

Regras:
- "ehComprovante": true só se o documento confirma um pagamento JÁ REALIZADO. A guia/boleto em si (documento de arrecadação ainda a pagar) NÃO é comprovante. Comprovante de AGENDAMENTO também não é pagamento realizado: false.
- "pagadorNome"/"pagadorDocumento": o contribuinte/empresa a que o pagamento se refere (em DARF/DAS/GPS é o contribuinte da guia; em PIX/boleto, o pagador). Documento só com os dígitos que aparecem, sem inventar.
- "valorPago": valor total pago, número com ponto decimal, sem "R$".
- "dataPagamento": data em que o pagamento foi efetuado.
- "descricao": o que foi pago, curto (ex: "DAS Simples Nacional 09/2026", "DARF 1099 INSS 09/2026", "PIX para Fulano"). Inclua o período de apuração se aparecer.
- "banco": instituição que emitiu o comprovante, se aparecer.
- "guiaId": só preencha se o pagador/contribuinte (nome ou CNPJ/CPF) bater com o cliente da guia E o tributo e o valor forem compatíveis com ela (valor pago igual ao valor da guia, ou um pouco maior quando pago depois do vencimento, com multa e juros). Se houver mais de uma guia possível e não der pra distinguir, null. Nunca invente.
- "honorarioId": só preencha quando o pagamento foi feito PARA O ESCRITÓRIO (favorecido/recebedor é o escritório ou a chave PIX dele, ou a descrição fala em honorário/mensalidade da contabilidade), o pagador (nome ou CNPJ/CPF) bater com o cliente do honorário e o valor for igual ao do honorário (ou um pouco maior, com juros). Pagamento de imposto (DAS, DARF, GPS, FGTS...) nunca é honorário. Se preencher honorarioId, deixe guiaId null. Se houver mais de um honorário possível do mesmo cliente, prefira o de vencimento mais antigo só se o valor bater; na dúvida, null.
- "confianca": "alta" só quando cliente, tributo e valor batem com a guia escolhida (ou cliente, recebedor e valor batem com o honorário escolhido); "media" quando algum deles ficou incerto; "baixa" quando pouca coisa foi identificada.
- "observacao": uma frase curta explicando a escolha (ou por que ficou null).
- O arquivo pode ser PDF, foto ou print de tela (app do banco, comprovante de PIX, internet banking). Leia o que estiver visível; se a imagem estiver cortada ou ilegível, preencha só o que der e use confiança "baixa".
- Se vier uma mensagem junto com o arquivo (ex: "DAS da Loja pago"), use como pista para achar a guia, mas só conte como certo o que o próprio comprovante mostrar.
- Mesmo quando não for comprovante, preencha o que conseguir ler.`;

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Guias anexadas (documento confirmado ligado a uma obrigação de imposto)
// que ainda não têm pagamento marcado, das mais recentes pras mais antigas.
async function listarGuiasEmAberto(supabase) {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, valor_guia, nome_arquivo, tipo_documento_sugerido, vencimento_guia, obrigacoes!inner(titulo, tipo, competencia, vencimento, cliente_id, clientes(nome, cnpj))')
    .eq('status', 'confirmado')
    .not('obrigacao_id', 'is', null)
    .is('pago_em', null)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data || [])
    .filter((d) => TITULO_IMPOSTO.test(`${d.obrigacoes.titulo || ''} ${d.obrigacoes.tipo || ''} ${d.tipo_documento_sugerido || ''} ${d.nome_arquivo || ''}`))
    .map((d) => ({
      id: d.id,
      clienteId: d.obrigacoes.cliente_id,
      clienteNome: d.obrigacoes.clientes?.nome || '—',
      cnpj: d.obrigacoes.clientes?.cnpj || null,
      titulo: d.obrigacoes.titulo || d.obrigacoes.tipo,
      competencia: d.obrigacoes.competencia || null,
      valor: d.valor_guia != null ? Number(d.valor_guia) : null,
      vencimento: d.vencimento_guia || d.obrigacoes.vencimento || null,
    }));
}

// Honorários do escritório ainda pendentes (só de clientes cadastrados).
// Sem a tabela/permite falhar: a leitura de guias segue sem honorários.
async function listarHonorariosEmAberto(supabase) {
  try {
    const { data, error } = await supabase
      .from('honorarios')
      .select('id, competencia, valor, vencimento, cliente_id, clientes(nome, cnpj)')
      .eq('status', 'pendente')
      .not('cliente_id', 'is', null)
      .order('vencimento', { ascending: true })
      .limit(300);
    if (error) throw error;
    return (data || []).map((h) => ({
      id: h.id,
      clienteId: h.cliente_id,
      clienteNome: h.clientes?.nome || '—',
      cnpj: h.clientes?.cnpj || null,
      titulo: 'Honorário',
      competencia: h.competencia || null,
      valor: h.valor != null ? Number(h.valor) : null,
      vencimento: h.vencimento || null,
    }));
  } catch (e) {
    console.error('Honorários em aberto indisponíveis:', e.message);
    return [];
  }
}

// Quem recebe os honorários (Honorários → Configurar PIX): ajuda a IA a
// reconhecer um PIX feito para o escritório.
async function recebedorEscritorio(supabase) {
  try {
    const { data } = await supabase.from('configuracoes').select('chave, valor')
      .in('chave', ['honorarios_pix_chave', 'honorarios_pix_favorecido']);
    const c = Object.fromEntries((data || []).map((x) => [x.chave, x.valor]));
    return [c.honorarios_pix_favorecido, c.honorarios_pix_chave && `chave PIX ${c.honorarios_pix_chave}`].filter(Boolean).join(' · ');
  } catch { return ''; }
}

async function perguntarIA({ arquivoBase64, filename, mimeType: mimeInformado, legenda, guias, honorarios = [], recebedor = '', apiKey, timeoutMs }) {
  const mimeType = tipoReal(arquivoBase64, mimeInformado);
  const leitura = leituraPossivel(arquivoBase64, mimeType);
  if (!leitura.ok) throw new Error(`Leitura automática indisponível: ${leitura.motivo}.`);
  const lista = guias
    .map((g) => `- id: ${g.id} | cliente: ${g.clienteNome}${g.cnpj ? ` (CNPJ ${g.cnpj})` : ''} | guia: ${g.titulo}${g.competencia ? ` ${g.competencia}` : ''} | valor: ${g.valor != null ? g.valor.toFixed(2) : 'não informado'} | vencimento: ${g.vencimento || 'não informado'}`)
    .join('\n');
  const listaHon = honorarios
    .map((h) => `- id: ${h.id} | cliente: ${h.clienteNome}${h.cnpj ? ` (CNPJ ${h.cnpj})` : ''} | honorário ${h.competencia || ''} | valor: ${h.valor != null ? h.valor.toFixed(2) : 'não informado'} | vencimento: ${h.vencimento || 'não informado'}`)
    .join('\n');
  const conteudoArquivo = blocoArquivo(arquivoBase64, mimeType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [conteudoArquivo, { type: 'text', text: `Arquivo: "${filename || 'documento'}".${textoLegenda(legenda)}\n\nGuias em aberto:\n${lista || '(nenhuma guia em aberto no momento)'}\n\nHonorários do escritório em aberto (pagos AO escritório${recebedor ? ` — recebedor: ${recebedor}` : ''}):\n${listaHon || '(nenhum honorário em aberto)'}` }],
        }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`Erro na API da Anthropic (${resp.status}): ${await resp.text()}`);
  const data = await resp.json();
  const texto = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(texto.replace(/```json|```/g, '').trim());
}

// Valor pago compatível com o da guia: igual (tolerância de centavos) ou até
// 30% maior (multa e juros de quem pagou atrasado). Sem valor num dos lados,
// não dá pra conferir — fica por conta da confiança da IA.
function valorCompativel(valorPago, valorGuia) {
  if (valorPago == null || valorGuia == null) return true;
  return valorPago >= valorGuia - 0.05 && valorPago <= valorGuia * 1.3;
}

// Empresa pelo CNPJ/CPF do pagador. Compara só dígitos; CNPJ também casa pela
// raiz (8 primeiros) quando o comprovante é de uma filial.
async function clientePorDocumento(supabase, documento) {
  const dig = soDigitos(documento);
  if (dig.length !== 11 && dig.length !== 14) return null;
  const { data, error } = await supabase.from('clientes').select('id, nome, cnpj').eq('ativo', true);
  if (error) throw error;
  const exato = (data || []).find((c) => soDigitos(c.cnpj) === dig);
  if (exato) return exato;
  if (dig.length === 14) {
    const mesmaRaiz = (data || []).filter((c) => soDigitos(c.cnpj).length === 14 && soDigitos(c.cnpj).slice(0, 8) === dig.slice(0, 8));
    if (mesmaRaiz.length === 1) return mesmaRaiz[0];
  }
  return null;
}

// Só a leitura (IA), sem gravar nada — o webhook usa no grupo "Documentos"
// pra decidir se o arquivo segue pro fluxo de comprovante ou de documento.
async function analisarComprovante(supabase, { arquivoBase64, filename, mimeType, legenda = null, apiKey, timeoutMs = 12000 }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada.');
  const [guias, honorarios, recebedor] = await Promise.all([
    listarGuiasEmAberto(supabase), listarHonorariosEmAberto(supabase), recebedorEscritorio(supabase),
  ]);
  const r = await perguntarIA({ arquivoBase64, filename, mimeType, legenda, guias, honorarios, recebedor, apiKey, timeoutMs });
  const guia = r.guiaId ? guias.find((g) => g.id === r.guiaId) || null : null;
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
  return {
    ehComprovante: !!r.ehComprovante,
    pagadorNome: r.pagadorNome || null,
    pagadorDocumento: r.pagadorDocumento || null,
    valorPago: num(r.valorPago),
    dataPagamento: /^\d{4}-\d{2}-\d{2}$/.test(r.dataPagamento || '') ? r.dataPagamento : null,
    descricao: r.descricao || null,
    banco: r.banco || null,
    guia,
    honorario: !guia && r.honorarioId ? honorarios.find((h) => h.id === r.honorarioId) || null : null,
    confianca: ['alta', 'media', 'baixa'].includes(r.confianca) ? r.confianca : 'baixa',
    observacao: r.observacao || '',
  };
}

// Grava o comprovante (Storage + comprovantes_pagamento) e, quando é seguro,
// já dá a baixa na guia. `analise` pode vir pronta (analisarComprovante) pra
// não repetir a chamada de IA. Devolve { comprovanteId, baixaAutomatica,
// guia, cliente, analise }.
async function registrarComprovante(supabase, { arquivoBase64, filename, mimeType, legenda = null, apiKey, remetente = null, origem = 'whatsapp', analise = null }) {
  const a = analise || await analisarComprovante(supabase, { arquivoBase64, filename, mimeType, legenda, apiKey });

  const alvo = a.guia || a.honorario || null;
  const cliente = alvo
    ? { id: alvo.clienteId, nome: alvo.clienteNome }
    : await clientePorDocumento(supabase, a.pagadorDocumento).catch(() => null);
  const automatica = !!a.guia && a.ehComprovante && a.confianca === 'alta' && valorCompativel(a.valorPago, a.guia.valor);
  const automaticaHon = !a.guia && !!a.honorario && a.ehComprovante && a.confianca === 'alta' && valorCompativel(a.valorPago, a.honorario.valor);

  const mime = tipoReal(arquivoBase64, mimeType);
  const storagePath = `${crypto.randomUUID()}.${EXTENSAO_POR_MIME[mime] || 'bin'}`;
  const { error: errStorage } = await supabase.storage
    .from('documentos')
    .upload(storagePath, Buffer.from(limparBase64(arquivoBase64), 'base64'), { contentType: mime });
  if (errStorage) throw errStorage;

  const agora = new Date().toISOString();
  if (automatica) {
    const { data: atualizada, error: errUpdate } = await supabase
      .from('documentos')
      .update({
        // meio-dia UTC pra data não "voltar um dia" quando exibida no fuso do Brasil
        pago_em: a.dataPagamento ? `${a.dataPagamento}T12:00:00Z` : agora,
        valor_pago: a.valorPago,
        comprovante_path: storagePath,
        comprovante_nome: filename || 'comprovante',
        baixa_manual: false,
        baixa_por: 'automática (IA)',
        baixa_registrada_em: agora,
      })
      .eq('id', a.guia.id)
      .is('pago_em', null) // não sobrescreve se alguém marcou nesse meio tempo
      .select('id');
    if (errUpdate) throw errUpdate;
    if (!atualizada?.length) return registrarNaFila(false);
  }
  if (automaticaHon) {
    const baixouHon = await baixarHonorario(supabase, a.honorario.id, {
      dataPagamento: a.dataPagamento || agora.slice(0, 10), valorPago: a.valorPago,
      comprovantePath: storagePath, comprovanteNome: filename || 'comprovante', por: 'automática (IA)',
    });
    return registrarNaFila(false, baixouHon);
  }
  return registrarNaFila(automatica);

  async function registrarNaFila(baixou, baixouHon = false) {
    const linha = {
      origem,
      remetente,
      nome_arquivo: filename || 'comprovante',
      storage_path: storagePath,
      tipo_mime: mime,
      eh_comprovante: a.ehComprovante,
      pagador_nome: a.pagadorNome,
      pagador_documento: a.pagadorDocumento,
      valor_pago: a.valorPago,
      data_pagamento: a.dataPagamento,
      descricao: a.descricao,
      banco: a.banco,
      observacao_ia: a.observacao,
      confianca: a.confianca,
      cliente_id: cliente?.id || null,
      guia_sugerida_id: a.guia?.id || null,
      status: baixou || baixouHon ? 'baixado' : 'pendente',
      guia_id: baixou ? a.guia.id : null,
      baixa_automatica: baixou || baixouHon,
      resolvido_por: baixou || baixouHon ? 'automática (IA)' : null,
      resolvido_em: baixou || baixouHon ? agora : null,
    };
    const colunasHon = { honorario_id: baixouHon ? a.honorario.id : null, honorario_sugerido_id: a.honorario?.id || null };
    let { data, error } = await supabase.from('comprovantes_pagamento').insert({ ...linha, ...colunasHon }).select('id').single();
    // schema de honorários no comprovante ainda não aplicado: grava sem as colunas novas
    if (error && colunaFaltando(error)) ({ data, error } = await supabase.from('comprovantes_pagamento').insert(linha).select('id').single());
    if (error) throw error;
    return {
      comprovanteId: data.id, baixaAutomatica: baixou || baixouHon,
      guia: baixou ? a.guia : null, honorario: baixouHon ? a.honorario : null, cliente, analise: a,
    };
  }
}

const colunaFaltando = (e) => ['42703', 'PGRST204'].includes(e?.code) || /column .* does not exist|Could not find the '.*' column/i.test(e?.message || '');

// Marca o honorário como pago com o comprovante. Só mexe se ainda estiver
// pendente (não sobrescreve baixa feita nesse meio tempo). true = baixou.
async function baixarHonorario(supabase, honorarioId, { dataPagamento, valorPago = null, comprovantePath = null, comprovanteNome = null, por = null }) {
  const basico = { status: 'pago', data_pagamento: dataPagamento };
  const completo = { ...basico, valor_pago: valorPago, comprovante_path: comprovantePath, comprovante_nome: comprovanteNome, baixa_por: por };
  let { data, error } = await supabase.from('honorarios').update(completo).eq('id', honorarioId).eq('status', 'pendente').select('id');
  if (error && colunaFaltando(error)) ({ data, error } = await supabase.from('honorarios').update(basico).eq('id', honorarioId).eq('status', 'pendente').select('id'));
  if (error) throw error;
  return !!data?.length;
}

module.exports = { analisarComprovante, registrarComprovante, listarGuiasEmAberto, listarHonorariosEmAberto, baixarHonorario, valorCompativel };
