// netlify/functions/lib/comprovantePagamento.js
//
// Baixa de guia por comprovante de pagamento: o cliente manda o comprovante,
// o escritório encaminha pro grupo "Documentos" do WhatsApp
// (whatsapp-webhook.js) e aqui a IA diz se o arquivo é um comprovante e de
// qual guia em aberto ele é. Quando bate com segurança, a guia é marcada
// como paga (documentos.pago_em — supabase-schema-guia-pagamento.sql) e o
// comprovante fica disponível pra download no painel do cliente
// (PainelCompartilhadoPage.jsx).
//
// Diferente do resto do pipeline de documentos (que só SUGERE e espera um
// humano confirmar), aqui a baixa é automática — por isso só acontece com
// confiança "alta" E valor pago compatível com o da guia; qualquer dúvida
// cai no fluxo normal de revisão, e dá pra marcar/desmarcar na mão no modo
// de edição do painel.

const crypto = require('crypto');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';
const MIME_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EXTENSAO_POR_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Mesmo critério de "é imposto" do painel (PainelCompartilhadoPage.jsx) —
// anexo de obrigação que não é imposto (ex: holerites) não é guia a pagar.
const TITULO_IMPOSTO = /\b(pg)?das\b|pgmei|inss|fgts|darf|dctfweb|irrf|irpj|csll|pis|cofins|icms|iss|difal|parcelamento|guia/i;

const SYSTEM_PROMPT = `Você é um assistente de escritório contábil brasileiro. Recebe um arquivo e uma lista de guias de imposto em aberto de vários clientes. Precisa dizer: 1) se o arquivo é um COMPROVANTE DE PAGAMENTO já efetuado (recibo do banco, comprovante de PIX, comprovante de pagamento de boleto/arrecadação); 2) de qual guia da lista é esse pagamento.

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"ehComprovante":true|false,"guiaId":"id da lista ou null","valorPago":number ou null,"dataPagamento":"YYYY-MM-DD ou null","confianca":"alta"|"media"|"baixa","observacao":"string curta"}

Regras:
- "ehComprovante": true só se o documento confirma um pagamento JÁ REALIZADO. A guia/boleto em si (documento de arrecadação ainda a pagar) NÃO é comprovante. Comprovante de AGENDAMENTO também não é pagamento realizado: false.
- "guiaId": só preencha se o pagador/contribuinte (nome ou CNPJ/CPF) bater com o cliente da guia E o tributo e o valor forem compatíveis com ela (valor pago igual ao valor da guia, ou um pouco maior quando pago depois do vencimento, com multa e juros). Se houver mais de uma guia possível e não der pra distinguir, null. Nunca invente.
- "valorPago": valor total pago, número com ponto decimal, sem "R$".
- "dataPagamento": data em que o pagamento foi efetuado.
- "confianca": "alta" só quando cliente, tributo e valor batem com a guia escolhida; "media" quando algum deles ficou incerto; "baixa" quando pouca coisa foi identificada.
- "observacao": uma frase curta explicando a escolha (ou por que ficou null).`;

// Guias anexadas (documento confirmado ligado a uma obrigação de imposto)
// que ainda não têm pagamento marcado, das mais recentes pras mais antigas.
async function listarGuiasEmAberto(supabase) {
  const { data, error } = await supabase
    .from('documentos')
    .select('id, valor_guia, vencimento_guia, obrigacoes!inner(titulo, tipo, competencia, vencimento, cliente_id, clientes(nome, cnpj))')
    .eq('status', 'confirmado')
    .not('obrigacao_id', 'is', null)
    .is('pago_em', null)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data || [])
    .filter((d) => TITULO_IMPOSTO.test(`${d.obrigacoes.titulo || ''} ${d.obrigacoes.tipo || ''}`))
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

async function perguntarIA({ arquivoBase64, filename, mimeType, guias, apiKey, timeoutMs }) {
  const lista = guias
    .map((g) => `- id: ${g.id} | cliente: ${g.clienteNome}${g.cnpj ? ` (CNPJ ${g.cnpj})` : ''} | guia: ${g.titulo}${g.competencia ? ` ${g.competencia}` : ''} | valor: ${g.valor != null ? g.valor.toFixed(2) : 'não informado'} | vencimento: ${g.vencimento || 'não informado'}`)
    .join('\n');
  const conteudoArquivo = MIME_IMAGEM.includes(mimeType)
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: arquivoBase64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivoBase64 } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [conteudoArquivo, { type: 'text', text: `Arquivo: "${filename || 'documento'}".\n\nGuias em aberto:\n${lista}` }],
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

// Devolve:
//   { ehComprovante: false }                         — não é comprovante
//   { ehComprovante: true, guia: null, observacao }  — é, mas sem guia segura
//   { ehComprovante: true, guia, valorPago, dataPagamento } — guia marcada como paga
// Lança erro em falha de infra (IA fora do ar/timeout, coluna pago_em ainda
// não criada) — quem chama segue o fluxo normal de documentos.
async function darBaixaPorComprovante(supabase, { arquivoBase64, filename, mimeType, apiKey, timeoutMs = 10000 }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada.');
  const guias = await listarGuiasEmAberto(supabase);
  if (guias.length === 0) return { ehComprovante: false };

  const r = await perguntarIA({ arquivoBase64, filename, mimeType, guias, apiKey, timeoutMs });
  if (!r.ehComprovante) return { ehComprovante: false };

  const guia = r.guiaId ? guias.find((g) => g.id === r.guiaId) : null;
  const valorPago = r.valorPago != null && Number.isFinite(Number(r.valorPago)) ? Number(r.valorPago) : null;
  if (!guia || r.confianca !== 'alta' || !valorCompativel(valorPago, guia.valor)) {
    return { ehComprovante: true, guia: null, observacao: r.observacao || '' };
  }

  const comprovantePath = `${crypto.randomUUID()}.${EXTENSAO_POR_MIME[mimeType] || 'bin'}`;
  const { error: errStorage } = await supabase.storage
    .from('documentos')
    .upload(comprovantePath, Buffer.from(arquivoBase64, 'base64'), { contentType: mimeType });
  if (errStorage) throw errStorage;

  const dataPagamento = /^\d{4}-\d{2}-\d{2}$/.test(r.dataPagamento || '') ? r.dataPagamento : null;
  const { error: errUpdate } = await supabase
    .from('documentos')
    .update({
      // meio-dia UTC pra data não "voltar um dia" quando exibida no fuso do Brasil
      pago_em: dataPagamento ? `${dataPagamento}T12:00:00Z` : new Date().toISOString(),
      valor_pago: valorPago,
      comprovante_path: comprovantePath,
      comprovante_nome: filename || 'comprovante',
    })
    .eq('id', guia.id)
    .is('pago_em', null); // não sobrescreve se alguém marcou nesse meio tempo
  if (errUpdate) throw errUpdate;

  return { ehComprovante: true, guia, valorPago, dataPagamento };
}

module.exports = { darBaixaPorComprovante, listarGuiasEmAberto, valorCompativel };
