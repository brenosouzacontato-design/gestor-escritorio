// netlify/functions/lib/decisaoDocumento.js
//
// Grupo "Documentos" do WhatsApp: quando o documento não é identificado, o
// robô pergunta o que fazer — 1 = criar tarefa, 2 = deixar arquivado. Aqui
// ficam as regras sem banco nem rede (testes em __tests__/decisaoDocumento.test.cjs);
// o fluxo está em whatsapp-webhook.js.

const { desembrulhar } = require('./midiaWhatsapp')

// Quanto tempo a pergunta vale para uma resposta que não cita a mensagem.
const VALIDADE_HORAS = 24

const PERGUNTA = '\n\n❓ *O que faço com ele?*\nResponda *1* para criar uma tarefa (pode escrever junto, ex.: "1 pedir extrato ao cliente")\nou *2* para deixar arquivado.'

// "1", "1 - cobrar extrato", "tarefa: cobrar extrato" → { acao: 'tarefa', descricao }
// "2", "arquivar", "arquiva" → { acao: 'arquivar' }; qualquer outra coisa → null
function lerDecisao(texto) {
  const t = String(texto || '').trim()
  if (!t) return null
  const tarefa = /^(?:1|tarefa)(?![\p{L}\d])[\s:.\-–—)]*([\s\S]*)$/iu.exec(t)
  if (tarefa) return { acao: 'tarefa', descricao: tarefa[1].replace(/\s+/g, ' ').trim().slice(0, 200) || null }
  if (/^(?:2|arquiv(?:a|ar|e|ado|o))(?![\p{L}\d])[\s.!]*$/iu.test(t)) return { acao: 'arquivar' }
  return null
}

// Id da mensagem que a resposta cita (responder segurando a mensagem do robô).
function idCitado(message) {
  const m = desembrulhar(message)
  const ctx = m.extendedTextMessage?.contextInfo || m.conversation?.contextInfo || null
  return ctx?.stanzaId || null
}

// Id da mensagem enviada, a partir do corpo que a Evolution devolve no sendText.
function idMensagemEnviada(corpo) {
  try {
    const j = typeof corpo === 'string' ? JSON.parse(corpo) : corpo
    return j?.key?.id || null
  } catch {
    return null
  }
}

function tituloTarefa(doc, descricao) {
  if (descricao) return descricao
  const tipo = doc.tipo_documento_sugerido && doc.tipo_documento_sugerido !== 'Documento não identificado'
    ? doc.tipo_documento_sugerido : 'Documento recebido'
  return `${tipo}: ${doc.nome_arquivo}`.slice(0, 200)
}

function observacaoTarefa(doc, remetente) {
  return [
    `Criada pelo grupo Documentos do WhatsApp${remetente ? ` (${remetente})` : ''}.`,
    `Arquivo: ${doc.nome_arquivo} — está em Documentos → Concluídos, anexado a esta tarefa.`,
    doc.observacao_ia ? `Leitura automática: ${doc.observacao_ia}` : null,
  ].filter(Boolean).join('\n')
}

function respostaTarefa(tarefa, doc, nomeCliente) {
  return `✅ *Tarefa criada*\n📝 ${tarefa.titulo}${nomeCliente ? `\n👤 ${nomeCliente}` : ''}\n📄 ${doc.nome_arquivo} anexado à tarefa.`
}

function respostaArquivado(doc) {
  return `🗄️ *Arquivado.*\n📄 ${doc.nome_arquivo} saiu da fila e está em Documentos → Concluídos.`
}

module.exports = {
  VALIDADE_HORAS, PERGUNTA, lerDecisao, idCitado, idMensagemEnviada,
  tituloTarefa, observacaoTarefa, respostaTarefa, respostaArquivado,
}
