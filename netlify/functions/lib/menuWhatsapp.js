// netlify/functions/lib/menuWhatsapp.js
//
// "opções" (ou "menu", "comandos", "ajuda") em um grupo do WhatsApp: o robô responde com os comandos
// que aquele grupo aceita. Cada grupo tem os seus (whatsapp-webhook.js):
//   escritório  → tarefa / obrigação / reunião / lembrete (lib/comandosWhatsapp.js)
//   Documentos  → arquivos com menu de processamento, NFS-e e emissão agendada (lib/nfseWhatsapp.js)
//   Pagamentos  → comprovantes para a baixa das guias
// Quando um comando novo entrar num grupo, acrescente-o aqui.
// Lógica pura (sem banco nem rede): __tests__/menuWhatsapp.test.cjs.

// A mensagem inteira precisa ser o pedido ("opções", "Opções?", "*menu*"); "opções de pagamento" é conversa.
const RE_OPCOES = /^[\s*_~]*(?:op[cç](?:[oõ]es|[aã]o)|menu|comandos?|ajuda|help)[\s*_~?!.]*$/iu

function pedeOpcoes(texto) {
  return RE_OPCOES.test(String(texto || '').normalize('NFC'))
}

const RODAPE = '\n\n_Digite *opções* a qualquer momento para ver esta lista._'

const MENUS = {
  escritorio: `📋 *Comandos deste grupo*

📝 *tarefa:* cria uma tarefa no gestor
   _tarefa: conferir DAS da Padaria até sexta_

📌 *obrigação:* cria uma obrigação (com as etapas do tipo)
   _obrigação: DCTFWeb da Loja vence dia 15_

🤝 *reunião:* marca na Agenda do gestor
   _reunião: com a Clínica sexta 14h_

⏰ *lembrete:* tarefa com aviso aqui no WhatsApp na data e hora
   _lembrete: ligar para o contador amanhã 9h_

Cliente, prazo, data, hora e responsável são lidos do próprio texto.`,

  documentos: `📂 *Comandos deste grupo (Documentos)*

📎 *Mande um arquivo* (PDF, foto ou print): vai para o Drive e eu respondo com o que dá para fazer
   — carregar Simples ou CND no painel, cadastrar parcelamento, dar baixa em guia, anexar ao painel,
   criar tarefa ou só arquivar. Responda com o *número* ou a palavra (ex.: _tarefa: pedir extrato_).
🏦 *Extrato bancário:* eu pergunto se importa; responda *sim* (ou _sim, nome da empresa_) ou *não*.

🧾 *nfse* — emitir NFS-e para tomador já cadastrado
   _nfse Simple Care Shopee 1.250,00_ (nota recorrente da semana)
   _nfse Simple Care Maria Souza 150,00 10/11_ (com a data do atendimento)
   _nfse_ sozinho lista as empresas que emitem pelo gestor

⏰ *agendar nfse* — a nota recorrente sai sozinha no dia e hora
   _agendar nfse Simple Care Shopee 1.250,00 30/11 14:00_ (sem hora: 9h)

Antes de emitir ou agendar eu mostro a prévia: responda *sim* ou *não*.`,

  pagamentos: `💳 *Este grupo (Pagamentos)*

📎 *Mande o comprovante* (PDF, foto ou print): ele vai para a fila de baixa das guias
   (tela Pagamentos do gestor). Texto sem arquivo é ignorado.`,
}

// grupo: 'escritorio' | 'documentos' | 'pagamentos'
function textoOpcoes(grupo) {
  return `${MENUS[grupo] || MENUS.escritorio}${RODAPE}`
}

module.exports = { pedeOpcoes, textoOpcoes, GRUPOS: Object.keys(MENUS) }
