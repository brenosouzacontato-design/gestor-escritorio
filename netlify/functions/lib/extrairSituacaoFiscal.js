// netlify/functions/lib/extrairSituacaoFiscal.js
//
// Chamada à IA de extrair-situacao-fiscal.js (ver o cabeçalho de lá), separada pra ser
// usada também pelo grupo "Documentos" do WhatsApp
// (documento-processar-background.mjs). Lança erro com mensagem em português.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-haiku-4-5-20251001';

function montarSystemPrompt(temClientes) {
  return `Você é um assistente contábil brasileiro. Recebe um documento fiscal — um Relatório de Situação Fiscal emitido pela Receita Federal (RFB) OU uma certidão de débitos (CND) federal, estadual ou municipal — e extrai as informações principais dele.${temClientes ? ' Também recebe uma lista de clientes cadastrados e precisa identificar de qual cliente da lista é o documento.' : ''}

Devolva APENAS um JSON, sem texto antes ou depois, sem markdown e sem crases, no formato exato:
{"tipoDocumento":"relatorio"|"cnd_federal"|"cnd_estadual"|"cnd_municipal"|"outro","validade":"YYYY-MM-DD ou null","dataEmissao":"YYYY-MM-DD ou null","situacaoGeral":"regular"|"pendente"|null,"debitos":[{"tributo":"string","competencia":"MM/YYYY ou null","vencimento":"YYYY-MM-DD ou null","valorOriginal":number,"valor":number,"situacao":"string"}],"parcelamentos":[{"modalidade":"string","valor":number,"parcelas":"string"}],"dividasAtivas":[{"inscricao":"string","tributo":"string","competencia":"MM/YYYY ou null","valor":number,"situacao":"string"}]${temClientes ? ',"clienteId":"id da lista ou null"' : ''},"observacao":"string curta"}

Regras:
- "tipoDocumento": "relatorio" para o Relatório de Situação Fiscal (Relatório de Situação Fiscal do Contribuinte / Informações de Apoio para Emissão de Certidão, da RFB). "cnd_federal" para a Certidão de Débitos Relativos a Créditos Tributários Federais e à Dívida Ativa da União (RFB/PGFN). "cnd_estadual" para certidão emitida pela Secretaria da Fazenda/Receita do Estado (ex: SEF-MG, SEFAZ). "cnd_municipal" para certidão emitida pela Prefeitura/Secretaria Municipal de Fazenda. "outro" se não for nenhum desses.
- "validade": só para certidão — data até quando ela é válida ("Válida até"); null se não houver ou se for relatório.
- Para certidão: "situacaoGeral" é "regular" quando ela é NEGATIVA ou POSITIVA COM EFEITOS DE NEGATIVA; "pendente" quando é POSITIVA (sem efeito de negativa). As listas de débitos/parcelamentos/dívidas ficam vazias [].
- "dataEmissao": data em que o relatório ou a certidão foi gerado/emitido.
- "situacaoGeral": "regular" se o relatório indicar que não há pendências fiscais impeditivas, "pendente" se houver qualquer pendência/débito/irregularidade.
- "debitos": lista de débitos/pendências em aberto na Receita Federal (não inclui os já inscritos em Dívida Ativa), UM ITEM POR LINHA de débito do relatório (cada período de apuração separado, nunca somado). "tributo" é o código/nome da receita (ex: "1099-01 - CP-SEGUR."), "competencia" é o período de apuração (PA) no formato "MM/YYYY" (se o PA for anual ou trimestral, use o último mês do período), "vencimento" é a data de vencimento (Dt. Vcto), "valorOriginal" é o valor original (Vl. Original), "valor" é o saldo devedor ATUALIZADO/consolidado (coluna "Sdo. Dev. Cons." — com multa e juros; se não houver essa coluna, use o saldo devedor), "situacao" é o status descrito no relatório (ex: "DEVEDOR", "em cobrança", "exigibilidade suspensa"). Valores numéricos sem "R$", ponto como separador decimal.
- "parcelamentos": lista de parcelamentos ativos junto à RFB. "modalidade" é o tipo/nome do parcelamento, "parcelas" é o texto descrevendo parcelas pagas/total (ex: "12/60") se disponível.
- "dividasAtivas": lista de débitos já inscritos em Dívida Ativa da União (PGFN). "inscricao" é o número da inscrição, se houver; "tributo" é a receita/natureza da dívida; "competencia" é o período de apuração mais recente da inscrição no formato "MM/YYYY", se informado; "valor" é o valor consolidado/atualizado da inscrição.
- Se não houver nenhum item numa das três listas, devolva array vazio [], não null.${temClientes ? '\n- "clienteId": só preencha se o nome ou CNPJ do documento bater com um item da lista de clientes. Se não tiver certeza, null — não invente.' : ''}
- Se não conseguir identificar um campo com confiança, use null pra ele (ou [] pras listas) — não invente números ou textos.
- "observacao": uma frase curta com qualquer ressalva relevante.
- Se o PDF não parecer um Relatório de Situação Fiscal nem uma certidão, devolva tipoDocumento "outro", situacaoGeral null, listas vazias, e explique em "observacao".`;
}

async function extrairSituacaoFiscal({ pdfBase64, filename = 'situacao-fiscal.pdf', clientes = null, apiKey }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify.');
  if (!pdfBase64) throw new Error('pdfBase64 não informado.');

  const temClientes = !!(clientes && clientes.length > 0);
  const listaClientes = temClientes
    ? clientes.map((c) => `- id: ${c.id} | nome: ${c.nome} | cnpj: ${c.cnpj || '—'}`).join('\n')
    : '';

  const anthropicResp = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 4096,
      system: montarSystemPrompt(temClientes),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            {
              type: 'text',
              text: temClientes
                ? `Extraia os dados do Relatório de Situação Fiscal "${filename}".\n\nClientes cadastrados:\n${listaClientes}`
                : `Extraia os dados do Relatório de Situação Fiscal "${filename}".`,
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicResp.ok) {
    const errText = await anthropicResp.text();
    const erro = new Error(`Erro na API da Anthropic (${anthropicResp.status}): ${errText}`);
    erro.status = 502;
    throw erro;
  }

  const data = await anthropicResp.json();
  const texto = (data.content ?? [])
    .filter((bloco) => bloco.type === 'text')
    .map((bloco) => bloco.text)
    .join('');

  let extraido;
  try {
    extraido = JSON.parse(texto.replace(/```json|```/g, '').trim());
  } catch {
    const erro = new Error('Não consegui interpretar a resposta do modelo como JSON.');
    erro.status = 502;
    erro.respostaBruta = texto.slice(0, 2000);
    throw erro;
  }

  const TIPOS = ['relatorio', 'cnd_federal', 'cnd_estadual', 'cnd_municipal', 'outro'];
  return {
    tipoDocumento: TIPOS.includes(extraido.tipoDocumento) ? extraido.tipoDocumento : 'relatorio',
    validade: extraido.validade || null,
    dataEmissao: extraido.dataEmissao || null,
    situacaoGeral: extraido.situacaoGeral || null,
    debitos: Array.isArray(extraido.debitos) ? extraido.debitos : [],
    parcelamentos: Array.isArray(extraido.parcelamentos) ? extraido.parcelamentos : [],
    dividasAtivas: Array.isArray(extraido.dividasAtivas) ? extraido.dividasAtivas : [],
    clienteId: temClientes ? (extraido.clienteId || null) : null,
    observacao: extraido.observacao || '',
  };
}

module.exports = { extrairSituacaoFiscal };
