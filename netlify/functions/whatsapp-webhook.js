const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { uploadArquivo } = require('./lib/googleDrive')
const { enviarMensagem } = require('./lib/whatsapp')
const { identificarDocumento } = require('./lib/identificarDocumento')
const { listarCandidatosDocumento } = require('./lib/candidatosDocumento')
const { analisarComprovante, registrarComprovante } = require('./lib/comprovantePagamento')
const {
  ROTULO, detectarComando, hojeSP, horaSP, somarDias, calcularVencimento, promptExtracao,
  parseJSONResposta, normalizarExtracao, lembreteReuniao, pendencias, confirmacao,
} = require('./lib/comandosWhatsapp')
const {
  EXTENSAO_POR_MIME, extrairMidia, extrairTexto, limparBase64, tipoReal, leituraPossivel, nomeDoArquivo,
} = require('./lib/midiaWhatsapp')
const decisao = require('./lib/decisaoDocumento')
const extratoWpp = require('./lib/extratoWhatsapp')
const processamento = require('./lib/processamentoDocumento')
const nfseWpp = require('./lib/nfseWhatsapp')
const recorrentes = require('./lib/nfse/recorrentes')
const nfseMei = require('./lib/nfse/mei')
const agendamentosNfse = require('./lib/nfse/agendamentos')
const menuWpp = require('./lib/menuWhatsapp')
const assistente = require('./lib/assistenteWhatsapp')
const { cabecalhoInterno } = require('./lib/autenticacao')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GRUPO_ID = process.env.WHATSAPP_GROUP_ID
const DOCS_GRUPO_ID = process.env.WHATSAPP_DOCS_GROUP_ID // grupo "Documentos" — todo arquivo enviado aqui vai pro Drive
const PAGAMENTOS_GRUPO_ID = process.env.WHATSAPP_PAGAMENTOS_GROUP_ID // grupo "Pagamentos" — comprovantes pra baixa das guias
const ANALISTA_GRUPO_ID = process.env.WHATSAPP_ANALISTA_GROUP_ID // grupo "ANALISTA JR" — assistente guiado (lib/assistenteWhatsapp.js)
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID
const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
// Segredo na URL do webhook configurada na Evolution API
// (.../whatsapp-webhook?segredo=...; ver iniciar-gestor.bat). Sem a variável,
// aceita qualquer chamada, como antes.
const WEBHOOK_SEGREDO = process.env.WHATSAPP_WEBHOOK_SEGREDO


// O Netlify roda essa function síncrona atrás de um API Gateway que mata a
// conexão com "Inactivity Timeout" (504) depois de ~29s sem resposta — um
// teto fixo, não dá pra configurar/aumentar. Descoberto na prática: quando
// a chamada à Anthropic (extrairComIA) ou o envio da confirmação de volta
// pro WhatsApp (enviarMensagem, em lib/whatsapp.js) demoravam mais que
// isso, a function inteira era matada ANTES de gravar a tarefa no banco —
// a tarefa se perdia de vez, sem erro nem confirmação no grupo, sem
// nenhum rastro de que a mensagem chegou a ser processada. Por isso todo
// fetch pra serviço externo aqui tem um timeout curto e, quando estoura,
// cai num fallback que garante que a tarefa é criada mesmo assim (só sem
// os campos que a IA preencheria) — perder a formatação bonita é bem
// melhor que perder a tarefa inteira.
async function fetchComTimeout(url, opcoes, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Pede à IA os campos da categoria (ver promptExtracao em
// lib/comandosWhatsapp.js). Falhou ou estourou o tempo → null, e
// normalizarExtracao completa com o que dá para ler do texto: o item é
// criado de qualquer forma, só sem a arrumação que a IA faria.
async function extrairComIA(prompt) {
  const response = await fetchComTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    })
  }, 12000)

  if (!response.ok) throw new Error(`Anthropic respondeu ${response.status}: ${await response.text()}`)
  const data = await response.json()
  return parseJSONResposta(data.content[0].text)
}

// Conteúdo do arquivo da mensagem: já vem em base64 no payload se a opção
// "Webhook Base64" estiver ligada no Evolution API; senão busca via
// getBase64FromMediaMessage. `anexo` vem de extrairMidia (lib/midiaWhatsapp.js):
// foto, print ou documento, já sem os envelopes do WhatsApp. O tipo é o real
// (pelo conteúdo), não o que o WhatsApp informa, e o nome sai com a
// extensão certa.
async function obterArquivoDaMensagem(body, anexo) {
  const { midia, tipo } = anexo
  let base64 = midia.base64 || null
  if (!base64) {
    const messageId = body?.data?.key?.id
    if (!messageId) throw new Error('Não achei o id da mensagem pra buscar o arquivo.')
    const resp = await fetch(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ message: { key: { id: messageId } } }),
    })
    if (!resp.ok) throw new Error(`Falha ao buscar o arquivo no WhatsApp (${resp.status}): ${await resp.text()}`)
    const dados = await resp.json()
    base64 = dados.base64
    if (!base64) throw new Error('A API do WhatsApp não devolveu o conteúdo do arquivo.')
  }
  base64 = limparBase64(base64)
  const mimeType = tipoReal(base64, midia.mimetype || dadosMime(tipo))
  return { base64, mimeType, nomeArquivo: nomeDoArquivo(midia, tipo, mimeType) }
}

// Quem mandou no grupo. Na Evolution 2.x, grupo com endereçamento LID manda
// participant "…@lid" (id interno) e o número em participantAlt.
const participante = (body) => {
  const k = body?.data?.key || {}
  return (String(k.participant || '').endsWith('@lid') && k.participantAlt) || k.participant || null
}

const dadosMime = (tipo) => (tipo === 'imagem' ? 'image/jpeg' : 'application/octet-stream')

const fmtBRL = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDataBR = (iso) => iso.split('-').reverse().join('/')

// Resposta no grupo depois de registrar um comprovante
// (lib/comprovantePagamento.js → registrarComprovante).
function mensagemComprovante(res) {
  const a = res.analise
  const valor = a.valorPago != null ? `\n💰 ${fmtBRL(a.valorPago)}` : ''
  const data = a.dataPagamento ? ` em ${fmtDataBR(a.dataPagamento)}` : ''
  if (res.baixaAutomatica && res.honorario) {
    return `✅ *Comprovante identificado — honorário marcado como pago!*\n👤 ${res.honorario.clienteNome}\n📄 Honorário${res.honorario.competencia ? ` ${res.honorario.competencia}` : ''}${valor}\n📅 Pago${data}\nO comprovante fica guardado em Gestor → Honorários.`
  }
  if (res.baixaAutomatica) {
    return `✅ *Comprovante identificado — guia marcada como paga!*\n👤 ${res.guia.clienteNome}\n📄 ${res.guia.titulo}${res.guia.competencia ? ` ${res.guia.competencia}` : ''}${valor}\n📅 Pago${data}\nO comprovante já está disponível no painel do cliente.`
  }
  const empresa = res.cliente ? `\n👤 ${res.cliente.nome}` : `\n👤 Empresa não identificada${a.pagadorNome ? ` (pagador: ${a.pagadorNome})` : ''}`
  const aviso = a.ehComprovante ? '' : '\n⚠️ Não parece um comprovante de pagamento — confira.'
  return `📥 *Comprovante recebido — falta conferir a baixa.*${empresa}${a.descricao ? `\n📄 ${a.descricao}` : ''}${valor}${data ? `\n📅 Pago${data}` : ''}${aviso}\nConfira e dê a baixa em Gestor → Pagamentos.`
}

// Arquivo enviado no grupo "Pagamentos" — é sempre tratado como comprovante:
// entra na fila de baixa (ou já baixa a guia, quando a IA tem certeza). Não
// vai pro Drive nem pra fila de documentos.
async function processarComprovante(body, anexo, remoteJid) {
  try {
    const { base64, mimeType, nomeArquivo } = await obterArquivoDaMensagem(body, anexo)
    const legenda = anexo.legenda
    const remetente = body?.data?.pushName || participante(body) || null
    let res
    try {
      res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente })
    } catch (eIA) {
      // IA fora do ar/timeout: o comprovante ainda entra na fila, sem a leitura
      console.error('Erro ao analisar comprovante (registrando sem leitura):', eIA.message)
      const analise = { ehComprovante: true, pagadorNome: null, pagadorDocumento: null, valorPago: null, dataPagamento: null, descricao: null, banco: null, guia: null, confianca: 'baixa', observacao: `Leitura automática falhou: ${eIA.message.slice(0, 200)}` }
      res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente, analise })
    }
    await enviarMensagem(remoteJid, mensagemComprovante(res))
    return { statusCode: 200, body: JSON.stringify({ success: true, comprovanteId: res.comprovanteId, baixaAutomatica: res.baixaAutomatica }) }
  } catch (e) {
    console.error('Erro ao processar comprovante:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao registrar o comprovante: ${e.message}`)
    // 200 de propósito: ver nota em processarDocumento
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Documento/imagem enviado no grupo "Documentos" — sobe pro Drive e entra
// na fila de documentos (ou, se for comprovante de pagamento, na fila de
// baixa de pagamentos).
async function processarDocumento(body, anexo, remoteJid) {
  try {
    const { base64, mimeType, nomeArquivo } = await obterArquivoDaMensagem(body, anexo)
    const legenda = anexo.legenda
    // foto/print/PDF que a IA consegue ler; senão (HEIC, grande demais...)
    // pula a leitura e o arquivo vai direto para a fila de revisão
    const leitura = leituraPossivel(base64, mimeType)

    // O backup no Drive é um extra: se falhar (ex: refresh token do Google
    // vencido), o documento ainda precisa entrar no sistema — identificação,
    // fila de revisão e baixa de guia por comprovante não dependem dele.
    // `erroDrive` vai junto na observação do documento e na resposta do grupo.
    let arquivo = null
    let erroDrive = null
    try {
      arquivo = await uploadArquivo({ nomeArquivo, mimeType, base64, folderId: DRIVE_FOLDER_ID })
      console.log('Arquivo salvo no Drive:', arquivo.id, arquivo.name)

      const remetente = participante(body) || body?.data?.pushName || remoteJid
      const { error: errLog } = await supabase.from('documentos_whatsapp').insert({
        nome_arquivo: arquivo.name,
        mime_type: mimeType,
        remetente,
        drive_file_id: arquivo.id,
        drive_link: arquivo.webViewLink || null,
      })
      if (errLog) console.error('Erro ao gravar log do upload:', errLog.message)
    } catch (eDrive) {
      erroDrive = eDrive.message
      console.error('Erro ao salvar no Drive (seguindo sem o backup):', erroDrive)
    }
    const avisoDrive = erroDrive ? `\n\n⚠️ Não consegui salvar a cópia no Drive: ${erroDrive.slice(0, 160)}` : ''

    // Comprovante de pagamento: vai pra fila de baixa de pagamentos (tela
    // Pagamentos), e a guia já é baixada quando a IA bate cliente, tributo e
    // valor com segurança (lib/comprovantePagamento.js). Se gravar na fila
    // falhar (ex: tabela comprovantes_pagamento ainda não criada), cai na
    // fila de documentos abaixo, como antes.
    let pareceComprovante = false
    try {
      if (!leitura.ok) throw new Error(leitura.motivo)
      const analise = await analisarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY })
      if (analise.ehComprovante) {
        pareceComprovante = true
        const remetente = body?.data?.pushName || participante(body) || null
        const res = await registrarComprovante(supabase, { arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, apiKey: ANTHROPIC_KEY, remetente, analise })
        await enviarMensagem(remoteJid, `${mensagemComprovante(res)}${avisoDrive}`)
        return { statusCode: 200, body: JSON.stringify({ success: true, driveFileId: arquivo?.id || null, comprovanteId: res.comprovanteId, baixaAutomatica: res.baixaAutomatica }) }
      }
    } catch (eComp) {
      console.error('Erro ao verificar comprovante de pagamento:', eComp.message)
    }

    // Identificação automática (IA) + fila de revisão — mesmo pipeline do
    // upload manual (DocumentosPage.jsx), só que persistido direto (aba "A
    // revisar"), já que aqui não tem ninguém na tela pra confirmar na hora.
    // Só SUGERE: a baixa de fato só acontece quando alguém confirma no
    // sistema — nunca automático.
    let mensagemIdentificacao = '\n\n⚠️ Não consegui rodar a identificação automática — revise manualmente no sistema.'
    let perguntarId = null // documento sem identificação ("tarefa ou arquivar?") ou extrato ("importar?")
    try {
      const candidatos = await listarCandidatosDocumento(supabase)
      // comprovante sem guia identificada com segurança já foi analisado
      // acima — não gasta uma segunda chamada de IA (o teto de ~29s da
      // function não comporta as duas), só entra na fila de revisão
      const sugestao = pareceComprovante
        ? { tipoDocumento: 'Comprovante de pagamento', clienteId: null, candidatoId: null, confianca: 'baixa', observacao: 'Comprovante de pagamento sem guia identificada com segurança.' }
        : !leitura.ok
          ? { tipoDocumento: 'Documento não identificado', clienteId: null, candidatoId: null, confianca: 'baixa', observacao: `Sem leitura automática: ${leitura.motivo}.` }
          : await identificarDocumento({ arquivoBase64: base64, filename: nomeArquivo, mimeType, legenda, candidatos, apiKey: ANTHROPIC_KEY })
      const candidato = sugestao.candidatoId ? candidatos.find((c) => c.id === sugestao.candidatoId) : null

      // Extrato bancário (PDF): acha a empresa pelo titular e, depois de
      // gravar, pergunta se é pra importar na contabilidade (lib/extratoWhatsapp.js)
      const ehExtrato = !!sugestao.extrato && mimeType === 'application/pdf' && !pareceComprovante
      let empresaExtrato = null
      if (ehExtrato) {
        const { data: clientes } = await supabase.from('clientes').select('id, nome, cnpj').eq('ativo', true)
        empresaExtrato = extratoWpp.acharEmpresaDoExtrato(sugestao.extrato, clientes, sugestao.clienteId)
      }

      const storagePath = `${crypto.randomUUID()}.${EXTENSAO_POR_MIME[mimeType] || 'bin'}`
      const { error: errStorage } = await supabase.storage
        .from('documentos')
        .upload(storagePath, Buffer.from(base64, 'base64'), { contentType: mimeType })
      if (errStorage) throw errStorage

      const { data: docNovo, error: errDoc } = await supabase.from('documentos').insert({
        cliente_id: empresaExtrato?.id || sugestao.clienteId || null,
        nome_arquivo: nomeArquivo,
        storage_path: storagePath,
        tipo_mime: mimeType,
        tamanho_bytes: Buffer.byteLength(base64, 'base64'),
        tipo_documento_sugerido: sugestao.tipoDocumento,
        confianca: sugestao.confianca,
        observacao_ia: [
          sugestao.observacao,
          legenda ? `Mensagem no WhatsApp: "${legenda.slice(0, 300)}"` : null,
          erroDrive ? `[Sem cópia no Drive: ${erroDrive.slice(0, 200)}]` : null,
        ].filter(Boolean).join(' ') || null,
        candidato_sugerido_id: candidato?.id || null,
        candidato_sugerido_tipo: candidato?.tipo || null,
        status: sugestao.candidatoId ? 'identificado' : 'sem_match',
      }).select('id').single()
      if (errDoc) throw errDoc

      // Extrato: pergunta "importar?". Só se as colunas existem
      // (supabase-schema-documentos-extrato-whatsapp.sql); senão segue como
      // documento comum, com a pergunta "tarefa ou arquivar?".
      let perguntaExtrato = null
      if (ehExtrato && docNovo?.id) {
        const { error: errExtrato } = await supabase.from('documentos')
          .update({ whatsapp_decisao: extratoWpp.AGUARDANDO, whatsapp_extrato: sugestao.extrato }).eq('id', docNovo.id)
        if (errExtrato) console.error('Pergunta de importar extrato desligada:', errExtrato.message)
        else {
          perguntarId = docNovo.id
          perguntaExtrato = extratoWpp.perguntaExtrato(sugestao.extrato, empresaExtrato)
        }
      }

      // Menu de processamento (lib/processamentoDocumento.js): o grupo escolhe
      // o que fazer — carregar no painel, anexar a CND, cadastrar o
      // parcelamento, dar baixa, criar tarefa ou só arquivar. Comprovante e
      // extrato já têm fluxo próprio. Sem a coluna whatsapp_opcoes
      // (supabase-schema-documentos-processamento-whatsapp.sql), cai na
      // pergunta antiga "1 = tarefa / 2 = arquivar", só para não identificado.
      let menu = ''
      if (!perguntaExtrato && !pareceComprovante && docNovo?.id) {
        const categoria = processamento.categoriaDoDocumento({ categoria: sugestao.categoria, tipoDocumento: sugestao.tipoDocumento, nomeArquivo })
        const clienteDoc = empresaExtrato?.id || sugestao.clienteId || null
        const opcoes = processamento.montarOpcoes({
          categoria,
          pdf: mimeType === 'application/pdf',
          candidato,
          candidatosDoCliente: clienteDoc ? candidatos.filter((c) => c.clienteId === clienteDoc) : [],
        })
        const { error: errMenu } = await supabase.from('documentos')
          .update({ whatsapp_decisao: processamento.AGUARDANDO, whatsapp_opcoes: opcoes }).eq('id', docNovo.id)
        // Declaração do Simples, CND e Situação Fiscal em PDF: processa já, sem esperar o menu
        const automatica = !errMenu ? processamento.opcaoAutomatica(opcoes, categoria) : null
        if (automatica) {
          // citando esta mensagem dá para responder depois (ex.: o nome da empresa, se ela não for achada)
          perguntarId = docNovo.id
          menu = await processarSozinho(docNovo.id, automatica, opcoes, body, remoteJid)
        } else if (!errMenu) {
          perguntarId = docNovo.id
          menu = processamento.textoMenu(opcoes)
        } else {
          console.error('Menu de processamento desligado:', errMenu.message)
          if (!sugestao.candidatoId) {
            const { error: errDecisao } = await supabase.from('documentos').update({ whatsapp_decisao: 'aguardando' }).eq('id', docNovo.id)
            if (errDecisao) console.error('Pergunta tarefa/arquivo desligada:', errDecisao.message)
            else {
              perguntarId = docNovo.id
              menu = decisao.PERGUNTA
            }
          }
        }
      }

      const avisoLeitura = leitura.ok ? '' : `\n⚠️ Não li o arquivo automaticamente: ${leitura.motivo}.`
      const revisar = menu ? '' : '\nRevise e confirme em Documentos → A revisar.'
      const nomeCliente = (id) => candidatos.find((c) => c.clienteId === id)?.clienteNome
      mensagemIdentificacao = perguntaExtrato || `\n\n🔎 ${sugestao.tipoDocumento}${avisoLeitura}` + (
        pareceComprovante
          ? '\n⚠️ Não consegui registrar na fila de pagamentos — dê a baixa em Gestor → Pagamentos → Baixa manual.'
          : candidato
          ? `\n👤 ${candidato.clienteNome} — sugestão: ${candidato.rotulo}${revisar}`
          : sugestao.clienteId
            ? `\n👤 ${nomeCliente(sugestao.clienteId) || 'Cliente identificado'}${menu ? '' : ', mas sem correspondência clara. Revise em Documentos → A revisar.'}`
            : `\n⚠️ Não identifiquei o cliente.${menu ? '' : ' Revise em Documentos → A revisar.'}`
      ) + (perguntaExtrato ? '' : menu)
    } catch (eIdent) {
      console.error('Erro ao identificar documento:', eIdent.message)
    }

    const envio = await enviarMensagem(remoteJid, `${arquivo ? '✅ *Documento salvo no Drive!*' : '✅ *Documento recebido!*'}\n📄 ${arquivo?.name || nomeArquivo}${mensagemIdentificacao}${avisoDrive}`)
    const idPergunta = perguntarId && envio?.sucesso ? decisao.idMensagemEnviada(envio.corpo) : null
    if (idPergunta) await supabase.from('documentos').update({ whatsapp_pergunta_id: idPergunta }).eq('id', perguntarId)
    return { statusCode: 200, body: JSON.stringify({ success: true, driveFileId: arquivo?.id || null, nome: arquivo?.name || nomeArquivo }) }
  } catch (e) {
    console.error('Erro ao processar documento:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao salvar o documento: ${e.message}`)
    // 200 de propósito: a Evolution API reenvia o mesmo webhook até 10 vezes
    // quando recebe erro, e reprocessar não conserta uma falha dessas — só
    // repete a mesma mensagem de erro no grupo dez vezes
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Processamento automático (Declaração do Simples, CND, Situação Fiscal): trava o
// documento em "processando" e dispara a background, que responde no grupo quando
// terminar (e, se não achar a empresa, volta a esperar a resposta com o nome).
// Devolve o trecho da mensagem "Documento recebido"; se não começar, o menu.
async function processarSozinho(documentoId, opcao, opcoes, body, remoteJid) {
  const agora = new Date().toISOString()
  const { data: travado } = await supabase.from('documentos')
    .update({ whatsapp_decisao: processamento.PROCESSANDO, whatsapp_decidido_em: agora })
    .eq('id', documentoId).eq('whatsapp_decisao', processamento.AGUARDANDO).select('id')
  if (!travado?.length) return processamento.textoMenu(opcoes)
  try {
    const remetente = body?.data?.pushName || participante(body) || null
    await dispararBackground('documento-processar-background', { documentoId, remoteJid, opcao, complemento: null, remetente })
    return processamento.textoProcessandoSozinho(opcao)
  } catch (e) {
    console.error('Processamento automático não começou:', e.message)
    await supabase.from('documentos').update({ whatsapp_decisao: processamento.AGUARDANDO, whatsapp_decidido_em: null }).eq('id', documentoId)
    return processamento.textoMenu(opcoes)
  }
}

// Dispara uma background function (documento-processar-background,
// importar-extrato-background, nfse-whatsapp-background): o Netlify responde
// 202 na hora e ela roda até 15 min. Lança erro se não começou.
async function dispararBackground(nome, corpo) {
  const base = (process.env.URL || '').replace(/\/+$/, '')
  if (!base) throw new Error('endereço do site desconhecido (variável URL do Netlify).')
  const resp = await fetchComTimeout(`${base}/.netlify/functions/${nome}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhoInterno() },
    body: JSON.stringify(corpo),
  }, 8000)
  if (!resp.ok) throw new Error(`o processamento não começou (${resp.status}).`)
}

// Resposta de texto no grupo "Documentos" a uma pergunta do robô:
//  - número/palavra do menu de processamento do documento (processarEscolhaDocumento);
//  - "sim / não" à pergunta de importar um extrato bancário (processarRespostaExtrato);
//  - "sim / não" à prévia de uma NFS-e pedida pelo grupo (processarConfirmacaoNfse).
// Vale para a mensagem citada ou, sem citação, para a pergunta mais recente
// que aceita aquela resposta (dentro da validade). Outro texto → null.
async function processarRespostaDocs(body, mensagem, remoteJid) {
  const citado = decisao.idCitado(body?.data?.message)
  const confirmacao = nfseWpp.lerConfirmacao(mensagem)
  const pedido = confirmacao ? await pedidoNfsePendente(citado) : null
  const pendente = await documentoPendente(citado, mensagem)

  if (pedido && (!pendente || citado || new Date(pedido.criado_em) >= new Date(pendente.doc.created_at))) {
    return await processarConfirmacaoNfse(pedido, confirmacao, remoteJid)
  }
  if (!pendente) return null // não é resposta a nenhuma pergunta
  const { doc, escolha } = pendente
  if (doc.whatsapp_decisao === extratoWpp.AGUARDANDO) return await processarRespostaExtrato(doc, escolha, remoteJid)
  return await processarEscolhaDocumento(doc, escolha, body, remoteJid)
}

// Documento esperando resposta que aceita esta mensagem → { doc, escolha } ou null.
async function documentoPendente(citado, mensagem) {
  const estados = [processamento.AGUARDANDO, extratoWpp.AGUARDANDO]
  const buscar = (campos) => {
    let q = supabase.from('documentos').select(campos).in('whatsapp_decisao', estados)
    q = citado
      ? q.eq('whatsapp_pergunta_id', citado)
      : q.gte('created_at', new Date(Date.now() - decisao.VALIDADE_HORAS * 3600e3).toISOString())
    return q.order('created_at', { ascending: false }).limit(10)
  }
  const CAMPOS = 'id, cliente_id, nome_arquivo, tipo_documento_sugerido, observacao_ia, whatsapp_decisao, created_at, clientes(nome)'
  let { data: docs, error } = await buscar(`${CAMPOS}, whatsapp_opcoes`)
  // banco ainda sem whatsapp_opcoes: segue com a pergunta antiga
  if (error && /whatsapp_opcoes/.test(error.message || '')) ({ data: docs, error } = await buscar(CAMPOS))
  if (error) {
    console.error('Resposta no grupo Documentos: falha ao buscar pendente:', error.message)
    return null
  }
  for (const doc of docs || []) {
    let escolha = null
    if (doc.whatsapp_decisao === extratoWpp.AGUARDANDO) {
      escolha = extratoWpp.lerRespostaExtrato(mensagem)
    } else if (Array.isArray(doc.whatsapp_opcoes) && doc.whatsapp_opcoes.length) {
      escolha = processamento.lerEscolha(mensagem, doc.whatsapp_opcoes)
    } else {
      const antiga = decisao.lerDecisao(mensagem) // "1 = tarefa / 2 = arquivar"
      if (antiga) escolha = { opcao: { acao: antiga.acao }, complemento: antiga.descricao || null }
    }
    if (escolha) return { doc, escolha }
  }
  return null
}

// Opção do menu escolhida. Tarefa e arquivar são resolvidos aqui; o resto
// (Simples, CND, parcelamento, baixa, painel) lê o arquivo e pode demorar:
// vai para documento-processar-background.mjs, que responde no grupo.
async function processarEscolhaDocumento(doc, { opcao, complemento }, body, remoteJid) {
  const remetente = body?.data?.pushName || participante(body) || null
  const agora = new Date().toISOString()

  if (processamento.ACOES_BACKGROUND.includes(opcao.acao)) {
    // trava: só um processamento por documento (a Evolution pode reenviar o webhook)
    const { data: travado } = await supabase.from('documentos')
      .update({ whatsapp_decisao: processamento.PROCESSANDO, whatsapp_decidido_em: agora })
      .eq('id', doc.id).eq('whatsapp_decisao', processamento.AGUARDANDO).select('id')
    if (!travado?.length) return { statusCode: 200, body: 'Decision already taken' }
    try {
      await dispararBackground('documento-processar-background', { documentoId: doc.id, remoteJid, opcao, complemento, remetente })
      await enviarMensagem(remoteJid, `⏳ *Processando…*\n${opcao.rotulo}\n📄 ${doc.nome_arquivo}\nAviso aqui quando terminar.`)
      return { statusCode: 200, body: JSON.stringify({ success: true, processando: doc.id, acao: opcao.acao }) }
    } catch (e) {
      console.error('Processar documento:', e.message)
      await supabase.from('documentos').update({ whatsapp_decisao: processamento.AGUARDANDO, whatsapp_decidido_em: null }).eq('id', doc.id)
      await enviarMensagem(remoteJid, `❌ Não consegui começar: ${e.message} Responda de novo em instantes.`)
      return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
    }
  }

  // trava: só um processamento por documento (a Evolution pode reenviar o webhook)
  const { data: travado } = await supabase.from('documentos')
    .update({ whatsapp_decisao: opcao.acao === 'tarefa' ? 'tarefa' : 'arquivado', whatsapp_decidido_em: agora })
    .eq('id', doc.id).eq('whatsapp_decisao', 'aguardando').select('id')
  if (!travado?.length) return { statusCode: 200, body: 'Decision already taken' }

  try {
    if (opcao.acao === 'arquivar') {
      const { error: e } = await supabase.from('documentos').update({ status: 'confirmado', confirmado_em: agora }).eq('id', doc.id)
      if (e) throw new Error(e.message)
      await enviarMensagem(remoteJid, decisao.respostaArquivado(doc))
      return { statusCode: 200, body: JSON.stringify({ success: true, arquivado: doc.id }) }
    }
    const tarefa = await criarTarefa(
      { titulo: decisao.tituloTarefa(doc, complemento), cliente_id: doc.cliente_id || null },
      decisao.observacaoTarefa(doc, remetente),
    )
    const { error: e } = await supabase.from('documentos')
      .update({ tarefa_id: tarefa.id, status: 'confirmado', confirmado_em: agora }).eq('id', doc.id)
    if (e) throw new Error(`a tarefa foi criada, mas não consegui anexar o documento: ${e.message}`)
    await enviarMensagem(remoteJid, decisao.respostaTarefa(tarefa, doc, doc.clientes?.nome))
    return { statusCode: 200, body: JSON.stringify({ success: true, tarefa: tarefa.id }) }
  } catch (e) {
    console.error('Decisão do documento:', e.message)
    // libera para tentar de novo (se o documento ainda não saiu da fila)
    await supabase.from('documentos').update({ whatsapp_decisao: 'aguardando', whatsapp_decidido_em: null })
      .eq('id', doc.id).neq('status', 'confirmado')
    await enviarMensagem(remoteJid, `❌ Não consegui ${opcao.acao === 'tarefa' ? 'criar a tarefa' : 'arquivar'}: ${e.message}`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// ---------- NFS-e pelo grupo Documentos (lib/nfseWhatsapp.js) ----------

// Prévia de NFS-e esperando "sim/não" (nfse_whatsapp_pedidos) ou null.
// doGrupo: sem citação, só os pedidos feitos naquele grupo (ANALISTA JR)
async function pedidoNfsePendente(citado, doGrupo = null) {
  let q = supabase.from('nfse_whatsapp_pedidos').select('*').eq('estado', nfseWpp.ESTADOS.AGUARDANDO)
  q = citado
    ? q.eq('pergunta_id', citado)
    : q.gte('criado_em', new Date(Date.now() - nfseWpp.VALIDADE_HORAS * 3600e3).toISOString())
  if (doGrupo && !citado) q = q.eq('remote_jid', doGrupo)
  const { data, error } = await q.order('criado_em', { ascending: false }).limit(1)
  if (error) {
    // tabela ainda não criada: o comando de NFS-e só fica desligado
    if (!/nfse_whatsapp_pedidos/.test(error.message || '')) console.error('Pedido de NFS-e pendente:', error.message)
    return null
  }
  return data?.[0] || null
}

// Empresas que emitem NFS-e pelo gestor (com certificado: nfse_empresas; MEI: senha + modelo
// em NFS-e MEI) e o que cada uma tem cadastrado (recorrentes, tomadores, modelos MEI).
async function carregarCadastrosNfse() {
  const { data: linhas, error } = await supabase.from('nfse_empresas').select('cliente_id, ambiente, descricao_padrao, ativo, clientes(nome)')
  if (error) console.error('NFS-e: empresas com certificado não lidas:', error.message)
  const empresas = (linhas || []).map((e) => ({ ...e, nome: e.clientes?.nome || 'Empresa' }))
  // MEI pelo Emissor Nacional (docs/nfse-mei.md): com senha cadastrada e modelo ativo
  const [acessosMei, modelosMei] = await Promise.all([
    supabase.from('nfse_mei_acessos').select('cliente_id'),
    supabase.from('nfse_mei_modelos').select('*').eq('ativo', true),
  ])
  const comSenha = new Set((acessosMei.data || []).map((a) => a.cliente_id))
  const idsMei = [...new Set((modelosMei.data || []).map((m) => m.cliente_id))]
    .filter((id) => comSenha.has(id) && !empresas.some((e) => e.cliente_id === id))
  if (idsMei.length) {
    const { data: cliMei } = await supabase.from('clientes').select('id, nome').in('id', idsMei).eq('ativo', true)
    for (const c of cliMei || []) empresas.push({ cliente_id: c.id, nome: c.nome, ambiente: 'producao', ativo: true, mei: true })
  }
  const ids = empresas.filter((e) => !e.mei).map((e) => e.cliente_id)
  const [modelos, tomadores] = await Promise.all([
    ids.length ? supabase.from('nfse_recorrentes').select('*').in('cliente_id', ids) : { data: [] },
    ids.length ? supabase.from('nfse_tomadores').select('id, cliente_id, nome, cpf, apelidos, endereco, cep, descricao_padrao, valor_padrao, ativo').in('cliente_id', ids) : { data: [] },
  ])
  const cadastros = {}
  const cad = (id) => (cadastros[id] ||= { modelos: [], tomadores: [], mei: [] })
  for (const m of modelos.data || []) cad(m.cliente_id).modelos.push(m)
  for (const t of tomadores.data || []) cad(t.cliente_id).tomadores.push(t)
  for (const m of modelosMei.data || []) if (empresas.some((e) => e.mei && e.cliente_id === m.cliente_id)) cad(m.cliente_id).mei.push(m)

  return { empresas, cadastros }
}

// "nfse <empresa> <tomador> <valor> [data]": confere com o cadastro e manda a
// prévia. A nota só sai depois do "sim" (processarConfirmacaoNfse).
async function processarComandoNfse(resto, mensagem, body, remoteJid) {
  try {
    const hoje = hojeSP()
    const { empresas, cadastros } = await carregarCadastrosNfse()
    if (!resto) {
      const ativas = empresas.filter((e) => e.ativo !== false)
      await enviarMensagem(remoteJid, `🧾 *Emitir NFS-e pelo grupo*\n${nfseWpp.ajuda()}${nfseWpp.textoLista({ titulo: 'Empresas que emitem pelo gestor', itens: ativas.map((e) => `${e.nome}${e.mei ? ' (MEI)' : ''}`) })}`)
      return { statusCode: 200, body: 'NFS-e help' }
    }

    const r = nfseWpp.interpretarPedido(resto, { empresas, cadastros, hoje })
    if (r.erro) {
      // falta algo: responde com o modelo da mensagem já preenchido com o que deu pra entender
      await enviarModeloNfse(remoteJid, nfseWpp.respostaModelo(r))
      return { statusCode: 200, body: 'NFS-e request incomplete' }
    }

    return await prepararPedidoNfse(r, mensagem, body, remoteJid)
  } catch (e) {
    console.error('Comando NFS-e:', e.message)
    await enviarMensagem(remoteJid, `❌ Não consegui preparar a NFS-e: ${e.message}`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Prévia da NFS-e já interpretada (empresa, tomador/modelo, valor, data): confere a semana do modelo
// recorrente ou a nota MEI repetida, grava o pedido e manda a prévia; a nota só sai depois do "sim".
// r: como o de nfseWpp.interpretarPedido. Usado pelo comando "nfse" e pelo assistente do ANALISTA JR.
async function prepararPedidoNfse(r, mensagem, body, remoteJid) {
  const hoje = hojeSP()
  const { empresa, item } = r
  const base = { cliente_id: empresa.cliente_id, ref_id: item.id, ambiente: empresa.ambiente, empresa_nome: empresa.nome, valor: r.valor, texto_original: mensagem.slice(0, 2000) }
  let dados
  if (r.tipo === 'mei') {
    // mesmas conferências da tela NFS-e MEI (lib/nfse/mei.js): valor, tomador, competência, nota repetida
    const competencia = r.data || hoje
    let nota
    try {
      nota = nfseMei.normalizarNota({ ...item, tomador_nome: item.tomador_nome, tomador_doc: item.tomador_doc, valor: r.valor, competencia,
        descricao: r.descricao || item.descricao })
    } catch (e) {
      await enviarMensagem(remoteJid, `⚠️ ${e.message}`)
      return { statusCode: 200, body: 'NFS-e MEI invalid' }
    }
    const { data: existentes } = await supabase.from('nfse_mei_notas').select('id, status, tomador_doc, valor, competencia, numero').eq('cliente_id', empresa.cliente_id)
    const repetida = nfseMei.notaRepetida(nota, existentes || [])
    dados = { ...base, tipo: 'mei', nome: item.nome, cpf: item.tomador_doc || '', data: competencia, descricao: nota.descricao,
      repetida: repetida ? { id: repetida.id, status: repetida.status, numero: repetida.numero || null } : null }
  } else if (r.tipo === 'recorrente') {
    const { data: notas, error: errNotas } = await supabase.from('nfse_notas').select('id, estado, data, valor, numero_nfse, lote_id')
      .eq('recorrente_id', item.id).eq('ambiente', empresa.ambiente)
    if (errNotas) throw new Error(errNotas.message)
    const semanas = recorrentes.semanasDoModelo(item, notas || [], hoje)
    const semana = nfseWpp.escolherSemana(semanas, r.data)
    const periodo = item.periodicidade === 'mensal' ? { um: 'o mês', varios: 'os meses', todos: 'Todos os meses' } : { um: 'a semana', varios: 'as semanas', todos: 'Todas as semanas' }
    if (!semana) {
      await enviarMensagem(remoteJid, `⚠️ ${r.data ? `A data ${r.data.split('-').reverse().join('/')} está fora d${periodo.varios} de ${item.nome}.` : `${periodo.todos} de ${item.nome} já têm nota.`}`)
      return { statusCode: 200, body: 'NFS-e no week' }
    }
    if (semana.situacao !== 'a_emitir') {
      await enviarMensagem(remoteJid, `⚠️ ${periodo.um[0].toUpperCase()}${periodo.um.slice(1)} de ${semana.inicio.split('-').reverse().join('/')} a ${semana.fim.split('-').reverse().join('/')} de ${item.nome} ${semana.situacao === 'pulada' ? 'foi marcada como sem serviço' : 'já tem nota'}. Veja em Emitir NFS-e → Notas recorrentes.`)
      return { statusCode: 200, body: 'NFS-e week taken' }
    }
    const data = r.data && r.data <= hoje ? r.data : semana.data
    dados = { ...base, tipo: 'recorrente', nome: item.nome, cpf: item.cpf, endereco: item.endereco || '', cep: item.cep || '', data, descricao: r.descricao ? recorrentes.descricaoDa({ ...item, descricao: r.descricao }, semana) : recorrentes.descricaoDa(item, semana), semana: semana.inicio, semana_fim: semana.fim }
  } else {
    dados = { ...base, tipo: 'tomador', nome: item.nome, cpf: item.cpf || '', endereco: item.endereco || '', cep: item.cep || '', data: r.data || hoje, descricao: r.descricao || item.descricao_padrao || empresa.descricao_padrao || '' }
  }

  const remetente = body?.data?.pushName || participante(body) || null
  const { data: pedido, error: errPedido } = await supabase.from('nfse_whatsapp_pedidos')
    .insert({ cliente_id: empresa.cliente_id, dados, texto_original: dados.texto_original, remetente, remote_jid: remoteJid })
    .select('id').single()
  if (errPedido) {
    throw new Error(/nfse_whatsapp_pedidos/.test(errPedido.message || '')
      ? 'falta rodar supabase-schema-documentos-processamento-whatsapp.sql no SQL Editor do Supabase.'
      : errPedido.message)
  }
  const envio = await enviarMensagem(remoteJid, nfseWpp.previa(dados))
  const idPergunta = envio?.sucesso ? decisao.idMensagemEnviada(envio.corpo) : null
  if (idPergunta) await supabase.from('nfse_whatsapp_pedidos').update({ pergunta_id: idPergunta }).eq('id', pedido.id)
  return { statusCode: 200, body: JSON.stringify({ success: true, pedido: pedido.id }) }
}

// ---------- emissão agendada pelo grupo (lib/nfse/agendamentos.js) ----------

// "agendar nfse <empresa> <modelo recorrente> <valor> <dd/mm> <hh:mm>": confere com o cadastro e as
// regras do agendamento e manda a prévia. Só agenda depois do "sim" (gravarAgendamentoNfse); quem emite
// na hora marcada é o robô nfse-agendamentos-cron, que avisa o resultado neste grupo.
async function processarAgendarNfse(resto, mensagem, body, remoteJid) {
  const exemplo = '\nExemplo: *agendar nfse Simple Care Shopee 1.250,00 30/11 14:00*'
  try {
    if (!resto) {
      await enviarMensagem(remoteJid, `⏰ *Agendar NFS-e pelo grupo*\nFunciona para as notas recorrentes (Emitir NFS-e → Notas recorrentes) e os modelos MEI (NFS-e MEI): diga a empresa, o modelo, o valor, o dia e a hora.${exemplo}\n_Sem hora, agendo para 9h. A data do serviço é o dia da emissão (ou mande uma segunda data)._`)
      return { statusCode: 200, body: 'NFS-e schedule help' }
    }
    const q = nfseWpp.extrairQuando(resto, { dia: hojeSP(), hora: horaSP() })
    if (q.erro) {
      await enviarMensagem(remoteJid, `⚠️ ${q.erro}${exemplo}`)
      return { statusCode: 200, body: 'NFS-e schedule invalid time' }
    }
    const { empresas, cadastros } = await carregarCadastrosNfse()
    // "hoje" = o dia da emissão: a data do serviço pode ir até ele
    const r = nfseWpp.interpretarPedido(q.resto, { empresas, cadastros, hoje: q.dia })
    if (r.erro) {
      await enviarMensagem(remoteJid, `⚠️ ${r.erro}${nfseWpp.textoLista(r.lista)}${exemplo}`)
      return { statusCode: 200, body: 'NFS-e schedule incomplete' }
    }
    return await prepararAgendamentoNfse(r, q, mensagem, body, remoteJid)
  } catch (e) {
    console.error('Agendar NFS-e:', e.message)
    await enviarMensagem(remoteJid, `❌ Não consegui agendar a NFS-e: ${e.message}`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Prévia do agendamento já interpretado (r: empresa, modelo, valor e data do serviço; q: dia e hora):
// confere as regras (lib/nfse/agendamentos.js), grava o pedido e manda a prévia; só agenda depois do "sim".
// Usado pelo comando "agendar nfse" e pelo assistente do ANALISTA JR.
async function prepararAgendamentoNfse(r, q, mensagem, body, remoteJid) {
  if (r.tipo !== 'recorrente' && r.tipo !== 'mei') {
    await enviarMensagem(remoteJid, `⚠️ O agendamento funciona para as notas recorrentes e os modelos MEI; ${r.item.nome} não é um modelo de ${r.empresa.nome}. Cadastre em Emitir NFS-e → Notas recorrentes (ou NFS-e MEI), ou peça a nota agora com *nfse*.`)
    return { statusCode: 200, body: 'NFS-e schedule not recurring' }
  }
  const { empresa, item } = r
  const mei = r.tipo === 'mei'
  const p = { executar_em: `${q.dia}T${q.hora}`, valor: r.valor, data_servico: r.data || q.dia, tipo: 'periodo', descricao: r.descricao || null }
  let campos
  try {
    campos = mei
      ? await agendamentosNfse.criarAgendamentoMei(supabase, { modelo: item, p, gravar: false })
      : await agendamentosNfse.criarAgendamento(supabase, { empresa, modelo: item, p, gravar: false })
  } catch (e) {
    if (!(e instanceof agendamentosNfse.ErroAgendamento)) throw e
    await enviarMensagem(remoteJid, `⚠️ ${e.message}`)
    return { statusCode: 200, body: 'NFS-e schedule rejected' }
  }
  const base = {
    cliente_id: empresa.cliente_id, ref_id: item.id, empresa_nome: empresa.nome, valor: r.valor,
    texto_original: mensagem.slice(0, 2000), nome: item.nome, data: campos.data_servico,
    agendar: { dia: q.dia, hora: q.hora, horaPadrao: q.horaPadrao, executar_em: p.executar_em, descricao: p.descricao },
  }
  let dados
  if (mei) {
    dados = { ...base, tipo: 'mei', ambiente: 'producao', cpf: item.tomador_doc || '',
      descricao: nfseMei.descricaoDoMes(campos.descricao || item.descricao || '', campos.data_servico) }
  } else {
    const periodo = recorrentes.periodoDaData(item, campos.data_servico)
    dados = { ...base, tipo: 'recorrente', ambiente: empresa.ambiente, cpf: item.cpf,
      descricao: recorrentes.descricaoDa(p.descricao ? { ...item, descricao: p.descricao } : item, periodo), semana: periodo.inicio, semana_fim: periodo.fim, mensal: recorrentes.ehMensal(item) }
  }
  const remetente = body?.data?.pushName || participante(body) || null
  const { data: pedido, error: errPedido } = await supabase.from('nfse_whatsapp_pedidos')
    .insert({ cliente_id: empresa.cliente_id, dados, texto_original: dados.texto_original, remetente, remote_jid: remoteJid })
    .select('id').single()
  if (errPedido) {
    throw new Error(/nfse_whatsapp_pedidos/.test(errPedido.message || '')
      ? 'falta rodar supabase-schema-documentos-processamento-whatsapp.sql no SQL Editor do Supabase.'
      : errPedido.message)
  }
  const envio = await enviarMensagem(remoteJid, nfseWpp.previaAgendamento(dados))
  const idPergunta = envio?.sucesso ? decisao.idMensagemEnviada(envio.corpo) : null
  if (idPergunta) await supabase.from('nfse_whatsapp_pedidos').update({ pergunta_id: idPergunta }).eq('id', pedido.id)
  return { statusCode: 200, body: JSON.stringify({ success: true, pedido: pedido.id }) }
}

// "sim" à prévia do agendamento: confere de novo (algo pode ter mudado) e grava em nfse_agendamentos.
async function gravarAgendamentoNfse(pedido, remoteJid) {
  const d = pedido.dados || {}
  try {
    const criadoPor = `WhatsApp${pedido.remetente ? ` (${String(pedido.remetente).slice(0, 60)})` : ''}`
    let ag
    if (d.tipo === 'mei') {
      const { data: modelo, error } = await supabase.from('nfse_mei_modelos').select('*').eq('id', d.ref_id).maybeSingle()
      if (error) throw new Error(error.message)
      ag = await agendamentosNfse.criarAgendamentoMei(supabase, {
        modelo, p: { executar_em: d.agendar.executar_em, valor: d.valor, data_servico: d.data, descricao: d.agendar.descricao || null }, criadoPor, avisarJid: remoteJid,
      })
    } else {
      const [{ data: empresa, error: e1 }, { data: modelo, error: e2 }] = await Promise.all([
        supabase.from('nfse_empresas').select('cliente_id, ambiente').eq('cliente_id', d.cliente_id).maybeSingle(),
        supabase.from('nfse_recorrentes').select('*').eq('id', d.ref_id).maybeSingle(),
      ])
      if (e1 || e2) throw new Error((e1 || e2).message)
      if (!empresa) throw new agendamentosNfse.ErroAgendamento('a empresa não está mais configurada para emitir NFS-e.')
      if (empresa.ambiente !== d.ambiente) throw new agendamentosNfse.ErroAgendamento(`o ambiente da empresa mudou para ${empresa.ambiente} depois da prévia. Peça de novo.`)
      ag = await agendamentosNfse.criarAgendamento(supabase, {
        empresa, modelo,
        p: { executar_em: d.agendar.executar_em, valor: d.valor, data_servico: d.data, tipo: 'periodo', descricao: d.agendar.descricao || null },
        criadoPor, avisarJid: remoteJid,
      })
    }
    await supabase.from('nfse_whatsapp_pedidos').update({ estado: nfseWpp.ESTADOS.EMITIDA, mensagem: `Agendada: nfse_agendamentos ${ag.id}` }).eq('id', pedido.id)
    await enviarMensagem(remoteJid, `✅ *NFS-e agendada para ${agendamentosNfse.quandoBR(ag.executar_em)}*\n🏢 ${d.empresa_nome}\n👤 ${d.nome} — ${fmtBRL(d.valor)}\nAviso aqui quando sair. Para cancelar: Gestor → ${d.tipo === 'mei' ? 'NFS-e MEI' : 'Emitir NFS-e → Notas recorrentes'}.`)
    return { statusCode: 200, body: JSON.stringify({ success: true, agendamento: ag.id }) }
  } catch (e) {
    console.error('Agendar NFS-e (sim):', e.message)
    await supabase.from('nfse_whatsapp_pedidos').update({ estado: nfseWpp.ESTADOS.ERRO, mensagem: String(e.message).slice(0, 1000) }).eq('id', pedido.id)
    await enviarMensagem(remoteJid, `❌ Não agendei a NFS-e de ${d.nome}: ${e.message}`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// ---------- assistente guiado do grupo ANALISTA JR (lib/assistenteWhatsapp.js) ----------

const SEM_TABELA_CONVERSAS = 'falta rodar supabase-schema-whatsapp-assistente.sql no SQL Editor do Supabase.'

// Conversa em andamento de quem escreveu (null se não há, ou se está parada há mais de VALIDADE_MIN)
async function conversaDe(remoteJid, quem) {
  const { data, error } = await supabase.from('whatsapp_conversas').select('estado, atualizado_em')
    .eq('remote_jid', remoteJid).eq('participante', quem).maybeSingle()
  if (error) throw new Error(/whatsapp_conversas/.test(error.message || '') ? SEM_TABELA_CONVERSAS : error.message)
  if (!data || !data.estado) return null
  const parada = Date.now() - new Date(data.atualizado_em).getTime() > assistente.VALIDADE_MIN * 60000
  return parada ? null : data.estado
}

async function guardarConversa(remoteJid, quem, estado) {
  const q = estado
    ? supabase.from('whatsapp_conversas').upsert({ remote_jid: remoteJid, participante: quem, estado, atualizado_em: new Date().toISOString() }, { onConflict: 'remote_jid,participante' })
    : supabase.from('whatsapp_conversas').delete().eq('remote_jid', remoteJid).eq('participante', quem)
  const { error } = await q
  if (error) throw new Error(/whatsapp_conversas/.test(error.message || '') ? SEM_TABELA_CONVERSAS : error.message)
}

// Um passo da conversa: responde e, no fim do fluxo, faz o mesmo que os comandos do grupo
// (prévia de NFS-e ou de agendamento, que esperam o "sim"; tarefa, lembrete, reunião, obrigação).
async function processarAssistente(body, mensagem, remoteJid) {
  const quem = participante(body) || remoteJid
  try {
    let estado = await conversaDe(remoteJid, quem)
    // fora de uma conversa, "sim"/"não" responde à prévia de NFS-e feita aqui
    if (!estado) {
      const confirmacao = nfseWpp.lerConfirmacao(mensagem)
      const pedido = confirmacao ? await pedidoNfsePendente(decisao.idCitado(body?.data?.message), remoteJid) : null
      if (pedido) return await processarConfirmacaoNfse(pedido, confirmacao, remoteJid)
    }
    // sem conversa, qualquer mensagem abre o menu; as empresas só são lidas a partir da escolha no menu
    const precisaCadastros = !!estado && estado.etapa !== 'texto'
    const { empresas, cadastros } = precisaCadastros ? await carregarCadastrosNfse() : { empresas: [], cadastros: {} }
    const r = assistente.passo(estado, mensagem, { empresas, cadastros, hoje: hojeSP(), hora: horaSP() })
    await guardarConversa(remoteJid, quem, r.estado)
    for (const texto of r.mensagens) await enviarMensagem(remoteJid, texto)
    const a = r.acao
    if (!a) return { statusCode: 200, body: `Assistant step: ${r.estado ? r.estado.etapa : 'fim'}` }
    if (a.tipo === 'nfse') return await prepararPedidoNfse(a.r, mensagem, body, remoteJid)
    if (a.tipo === 'agendar') return await prepararAgendamentoNfse(a.r, a.q, mensagem, body, remoteJid)
    return await processarComando({ categoria: a.categoria, texto: a.texto }, `${ROTULO[a.categoria]}: ${a.texto}`, remoteJid)
  } catch (e) {
    console.error('Assistente ANALISTA JR:', e.message)
    await guardarConversa(remoteJid, quem, null).catch(() => {})
    await enviarMensagem(remoteJid, `❌ Não consegui seguir: ${e.message}\nMande *oi* para recomeçar.`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

async function enviarModeloNfse(remoteJid, [texto, modelo]) {
  await enviarMensagem(remoteJid, texto)
  await enviarMensagem(remoteJid, modelo)
}

// Pedido de nota escrito em texto livre ("preciso emitir uma nota pra Maria de 150"), sem o
// comando: responde com o modelo da mensagem, preenchido com empresa, tomador, valor e data
// que deu pra reconhecer no cadastro. Não emite nada.
async function processarIntencaoNfse(mensagem, remoteJid) {
  try {
    const { empresas, cadastros } = await carregarCadastrosNfse()
    const r = nfseWpp.interpretarPedido(mensagem, { empresas, cadastros, hoje: hojeSP() })
    await enviarModeloNfse(remoteJid, nfseWpp.respostaModelo(r, { textoLivre: true }))
    return { statusCode: 200, body: 'NFS-e template sent' }
  } catch (e) {
    console.error('Pedido de NFS-e em texto livre:', e.message)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// MEI: a nota entra na fila do robô (nfse_mei_notas, como o botão Emitir da tela NFS-e MEI).
// O robô emite no Emissor Nacional e manda o PDF no WhatsApp do cliente (docs/nfse-mei.md).
async function enfileirarNotaMei(pedido, remoteJid) {
  const d = pedido.dados || {}
  try {
    const { data: modelo, error: errModelo } = await supabase.from('nfse_mei_modelos').select('*').eq('id', d.ref_id).maybeSingle()
    if (errModelo) throw new Error(errModelo.message)
    if (!modelo || modelo.ativo === false) throw new Error('o modelo da nota foi excluído.')
    const nota = nfseMei.normalizarNota({ ...modelo, valor: d.valor, competencia: d.data, descricao: d.descricao || modelo.descricao })
    const { data: nova, error } = await supabase.from('nfse_mei_notas').insert({
      ...nota, cliente_id: d.cliente_id, modelo_id: modelo.id, status: 'na_fila',
      criado_por: `WhatsApp${pedido.remetente ? ` (${String(pedido.remetente).slice(0, 60)})` : ''}`,
    }).select('id').single()
    if (error) throw new Error(error.message)
    await supabase.from('nfse_whatsapp_pedidos').update({ estado: nfseWpp.ESTADOS.EMITIDA, mensagem: `Na fila do robô MEI: nfse_mei_notas ${nova.id}` }).eq('id', pedido.id)
    await enviarMensagem(remoteJid, `✅ *Nota MEI na fila do robô*\n🏢 ${d.empresa_nome}\n👤 ${d.nome} — ${fmtBRL(d.valor)}\nEle emite no Emissor Nacional e manda o PDF no WhatsApp do cliente. Acompanhe em Documentos → NFS-e MEI.`)
    return { statusCode: 200, body: JSON.stringify({ success: true, notaMei: nova.id }) }
  } catch (e) {
    console.error('NFS-e MEI:', e.message)
    await supabase.from('nfse_whatsapp_pedidos').update({ estado: nfseWpp.ESTADOS.ERRO, mensagem: String(e.message).slice(0, 1000) }).eq('id', pedido.id)
    await enviarMensagem(remoteJid, `❌ Não mandei a nota MEI para o robô: ${e.message}\nPeça de novo ou use Documentos → NFS-e MEI.`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// "sim" → trava o pedido e dispara nfse-whatsapp-background.js (que emite e
// responde no grupo); "não" → cancela.
async function processarConfirmacaoNfse(pedido, confirmacao, remoteJid) {
  const d = pedido.dados || {}
  const agora = new Date().toISOString()
  const novoEstado = confirmacao === 'sim' ? nfseWpp.ESTADOS.EMITINDO : nfseWpp.ESTADOS.CANCELADO
  const { data: travado } = await supabase.from('nfse_whatsapp_pedidos')
    .update({ estado: novoEstado, decidido_em: agora })
    .eq('id', pedido.id).eq('estado', nfseWpp.ESTADOS.AGUARDANDO).select('id')
  if (!travado?.length) return { statusCode: 200, body: 'Decision already taken' }

  if (confirmacao === 'nao') {
    await enviarMensagem(remoteJid, `🚫 Ok, não emiti a NFS-e de ${d.nome} (${d.empresa_nome}).`)
    return { statusCode: 200, body: JSON.stringify({ success: true, cancelado: pedido.id }) }
  }
  if (d.tipo === 'mei') return await enfileirarNotaMei(pedido, remoteJid)
  if (d.agendar) return await gravarAgendamentoNfse(pedido, remoteJid)
  try {
    await dispararBackground('nfse-whatsapp-background', { pedidoId: pedido.id, remoteJid })
    await enviarMensagem(remoteJid, `⏳ *Emitindo a NFS-e…*\n👤 ${d.nome} — ${fmtBRL(d.valor)}\nAviso aqui quando a Sefin responder.`)
    return { statusCode: 200, body: JSON.stringify({ success: true, emitindo: pedido.id }) }
  } catch (e) {
    console.error('Emitir NFS-e:', e.message)
    await supabase.from('nfse_whatsapp_pedidos').update({ estado: nfseWpp.ESTADOS.AGUARDANDO, decidido_em: null }).eq('id', pedido.id)
    await enviarMensagem(remoteJid, `❌ Não consegui começar a emissão: ${e.message} Responda *sim* de novo.`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// Resposta "sim" / "não" à pergunta "importar o extrato?". Com "sim", trava
// o documento em "importando" e dispara importar-extrato-background.mjs, que
// importa, gera os lançamentos e responde com o resumo no grupo quando terminar.
async function processarRespostaExtrato(doc, escolha, remoteJid) {
  const agora = new Date().toISOString()
  if (escolha.acao === 'recusar') {
    const { data: travado } = await supabase.from('documentos')
      .update({ whatsapp_decisao: 'arquivado', whatsapp_decidido_em: agora, status: 'confirmado', confirmado_em: agora })
      .eq('id', doc.id).eq('whatsapp_decisao', extratoWpp.AGUARDANDO).select('id')
    if (travado?.length) await enviarMensagem(remoteJid, extratoWpp.respostaRecusado(doc))
    return { statusCode: 200, body: JSON.stringify({ success: true, arquivado: doc.id }) }
  }

  // empresa: a digitada junto do "sim" vence a identificada no extrato
  let empresa = null
  if (escolha.empresa) {
    const { data: clientes } = await supabase.from('clientes').select('id, nome, cnpj').eq('ativo', true)
    empresa = extratoWpp.acharEmpresaPorTexto(escolha.empresa, clientes)
  } else if (doc.cliente_id) {
    empresa = { id: doc.cliente_id, nome: doc.clientes?.nome || 'a empresa' }
  }
  if (!empresa) {
    await enviarMensagem(remoteJid, extratoWpp.respostaSemEmpresa(escolha.empresa))
    return { statusCode: 200, body: 'Extrato sem empresa' }
  }

  // trava: só uma importação por documento (a Evolution pode reenviar o webhook)
  const { data: travado } = await supabase.from('documentos')
    .update({ whatsapp_decisao: extratoWpp.IMPORTANDO, whatsapp_decidido_em: agora, cliente_id: empresa.id })
    .eq('id', doc.id).eq('whatsapp_decisao', extratoWpp.AGUARDANDO).select('id')
  if (!travado?.length) return { statusCode: 200, body: 'Decision already taken' }

  try {
    await dispararBackground('importar-extrato-background', { documentoId: doc.id, remoteJid })
    await enviarMensagem(remoteJid, extratoWpp.respostaImportando(empresa))
    return { statusCode: 200, body: JSON.stringify({ success: true, importando: doc.id }) }
  } catch (e) {
    console.error('Importar extrato:', e.message)
    await supabase.from('documentos').update({ whatsapp_decisao: extratoWpp.AGUARDANDO, whatsapp_decidido_em: null }).eq('id', doc.id)
    await enviarMensagem(remoteJid, `❌ Não consegui começar a importação: ${e.message} Tente responder *sim* de novo.`)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

// ---------- categorias: tarefa / obrigação / reunião / lembrete ----------

async function criarTarefa(item, mensagem, { prefixo = '' } = {}) {
  const { data, error } = await supabase
    .from('tarefas')
    .insert({
      titulo: `${prefixo}${item.titulo}`.slice(0, 200),
      observacao: mensagem, // conteúdo completo da mensagem
      cliente_id: item.cliente_id,
      vencimento: item.prazo ?? item.vencimento ?? item.data ?? null,
      departamento: item.departamento || 'contabil',
      prioridade: item.prioridade || 'normal',
      concluida: false,
      origem: 'whatsapp',
    })
    .select()
    .single()
  if (error) {
    console.error('Erro insert tarefa:', JSON.stringify(error))
    throw new Error(error.message)
  }
  return data
}

// Lembrete = tarefa + linha em "lembretes" (a tabela exige o vínculo com
// uma tarefa ou obrigação). O lembretes-cron manda o aviso no grupo.
async function criarLembrete(item, mensagem) {
  const tarefa = await criarTarefa({ ...item, prazo: item.data }, mensagem)
  const { error } = await supabase.from('lembretes').insert({
    tarefa_id: tarefa.id,
    data_hora: item.dataHora,
    mensagem: null,
  })
  if (error) throw new Error(`a tarefa foi criada, mas o lembrete falhou: ${error.message}`)
  return tarefa
}

async function criarReuniao(item, mensagem) {
  const { data, error } = await supabase
    .from('agenda_eventos')
    .insert({
      titulo: item.titulo,
      cliente_id: item.cliente_id,
      data: item.data,
      hora: item.hora,
      duracao_min: item.duracao_min,
      local: item.local,
      descricao: mensagem,
      origem: 'whatsapp',
      lembrete_em: lembreteReuniao(item.data, item.hora),
    })
    .select()
    .single()
  if (error) {
    // tabela ainda não criada (supabase-schema-agenda.sql) → quem chama cai na tarefa
    if (error.code === '42P01' || error.code === 'PGRST205') return null
    throw new Error(error.message)
  }
  return data
}

// Mesma lógica de criarObrigacaoComEtapas (src/pages/andamento/andamentoApi.js):
// obrigação + cópia das etapas do tipo + histórico.
async function criarObrigacao(item, tipo, etapasTemplate) {
  const hoje = hojeSP()
  const vencimento = item.vencimento ||
    (tipo.dia_vencimento ? calcularVencimento(item.competencia, tipo.mes_vencimento || 'mesmo', tipo.dia_vencimento) : null)
  const { data: obrigacao, error } = await supabase
    .from('obrigacoes')
    .insert({
      cliente_id: item.cliente_id,
      tipo: tipo.nome,
      competencia: item.competencia,
      tipo_obrigacao_id: tipo.id,
      departamento_id: tipo.departamento_id || null,
      titulo: tipo.nome,
      responsavel: item.responsavel || null,
      status: 'pendente',
      data_inicio: hoje,
      vencimento,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)

  const etapas = etapasTemplate.map((et, i) => ({
    obrigacao_id: obrigacao.id,
    etapas_template_id: et.id,
    nome: et.nome,
    ordem: et.ordem,
    status: i === 0 ? 'em_andamento' : 'pendente',
    data_prevista: (vencimento && etapasTemplate.length === 1) ? vencimento : somarDias(hoje, et.prazo_dias_relativo ?? 0),
  }))
  const { error: errEtapas } = await supabase.from('etapas_obrigacao').insert(etapas)
  if (errEtapas) throw new Error(`a obrigação foi criada, mas as etapas falharam: ${errEtapas.message}`)

  await supabase.from('historico_obrigacao').insert({
    obrigacao_id: obrigacao.id,
    descricao: `Obrigação "${tipo.nome}" criada pelo WhatsApp: ${item.titulo}`,
    autor: item.responsavel || null,
  })
  return { ...obrigacao, vencimento }
}

async function processarComando({ categoria, texto }, mensagem, remoteJid) {
  const hoje = hojeSP()
  try {
    const { data: clientesBrutos } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('ativo', true)
    const clientes = clientesBrutos || []

    let tipos = []
    if (categoria === 'obrigacao') {
      const { data } = await supabase
        .from('tipos_obrigacao')
        .select('id, nome, departamento_id, mes_vencimento, dia_vencimento')
        .eq('ativo', true)
      tipos = data || []
    }

    let bruto = null
    try {
      bruto = await extrairComIA(promptExtracao(categoria, texto, { clientes, tipos, hoje }))
      console.log(`${categoria} extraída:`, JSON.stringify(bruto))
    } catch (eIA) {
      // Anthropic fora do ar, lenta (timeout de 12s) ou resposta que não
      // parseou: segue com o que dá para ler do texto
      console.error('Falha ao extrair com IA, usando só o texto:', eIA.message)
    }
    const item = normalizarExtracao(categoria, bruto, { texto, clientes, tipos, hoje })
    const falta = pendencias(item)
    const nomeCliente = item.cliente_id ? clientes.find((c) => c.id === item.cliente_id)?.nome : null

    // Obrigação: não duplica a mesma competência e o tipo precisa ter etapas
    let tipo = null, etapasTemplate = []
    if (categoria === 'obrigacao' && !falta.length) {
      tipo = tipos.find((t) => t.id === item.tipo_obrigacao_id)
      const { data: existente } = await supabase
        .from('obrigacoes')
        .select('id')
        .eq('cliente_id', item.cliente_id)
        .eq('tipo_obrigacao_id', tipo.id)
        .eq('competencia', item.competencia)
        .limit(1)
      if (existente?.length) {
        await enviarMensagem(remoteJid, `ℹ️ ${tipo.nome} — ${item.competencia} de ${nomeCliente} já existe no gestor. Não criei outra.`)
        return { statusCode: 200, body: JSON.stringify({ success: true, existente: existente[0].id }) }
      }
      const { data: tpl } = await supabase
        .from('etapas_template')
        .select('id, nome, ordem, prazo_dias_relativo')
        .eq('tipo_obrigacao_id', tipo.id)
        .order('ordem')
      etapasTemplate = tpl || []
      if (!etapasTemplate.length) falta.push(`etapas cadastradas no tipo "${tipo.nome}"`)
    }

    let criado
    if (categoria === 'reuniao' && !falta.length) {
      criado = await criarReuniao(item, mensagem)
      if (!criado) falta.push('a Agenda ativada no banco de dados')
    }
    if (criado) {
      // reunião já gravada na Agenda
    } else if (falta.length) {
      // Faltou algo: vira tarefa (com a categoria no título) e o grupo é avisado
      criado = await criarTarefa(item, mensagem, { prefixo: `${ROTULO[categoria]}: ` })
    } else if (categoria === 'lembrete') {
      criado = await criarLembrete(item, mensagem)
    } else if (categoria === 'obrigacao') {
      criado = await criarObrigacao(item, tipo, etapasTemplate)
      item.vencimento = criado.vencimento
    } else {
      criado = await criarTarefa(item, mensagem)
    }

    await enviarMensagem(remoteJid, confirmacao(item, { nomeCliente, nomeTipo: tipo?.nome, falta }))
    console.log(`${categoria} criada:`, criado.id)
    return { statusCode: 200, body: JSON.stringify({ success: true, categoria, id: criado.id }) }
  } catch (e) {
    console.error('Erro:', e.message)
    await enviarMensagem(remoteJid, `❌ Erro ao criar ${ROTULO[categoria].toLowerCase()}: ${e.message}`)
    // 200 de propósito: com erro a Evolution reenvia o webhook e repetiria
    // a mensagem de erro (ou criaria o item em dobro)
    return { statusCode: 200, body: JSON.stringify({ success: false, error: e.message }) }
  }
}

function segredoConfere(event) {
  if (!WEBHOOK_SEGREDO) return true
  const recebido = Buffer.from(String(event.queryStringParameters?.segredo || ''))
  const esperado = Buffer.from(WEBHOOK_SEGREDO)
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado)
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' }
  }
  if (!segredoConfere(event)) {
    console.warn('whatsapp-webhook: chamada sem o segredo certo — ignorada')
    return { statusCode: 401, body: 'Unauthorized' }
  }

  let body
  try {
    body = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' }
  }

  const remoteJid = body?.data?.key?.remoteJid || body?.data?.remoteJid || ''
  // texto e anexo (foto, print ou documento), também dentro de mensagem
  // temporária, de visualização única ou documento com legenda
  const mensagem = extrairTexto(body?.data?.message)
  const anexo = extrairMidia(body?.data?.message)
  const midia = anexo?.midia || null

  console.log('remoteJid:', remoteJid)
  console.log('mensagem:', mensagem)
  console.log('anexo:', anexo ? `${anexo.tipo} ${midia.mimetype || ''}` : 'nenhum')

  // Grupo "Documentos" — qualquer arquivo enviado aqui vai pro Drive, sem
  // depender de prefixo, e recebe o menu de processamento (Simples → painel,
  // CND → painel, guia → baixa, parcelamento → cadastro, tarefa, arquivar).
  // Texto nesse grupo só conta como resposta ao menu, "sim / não" à pergunta
  // de importar um extrato bancário ou à prévia de NFS-e, ou como comando
  // "nfse ..." (NFS-e para tomador cadastrado); o resto é ignorado e não cai
  // no fluxo de tarefa abaixo.
  // Grupo "Pagamentos" — todo arquivo é comprovante de pagamento: vai pra
  // fila de baixa (tela Pagamentos do gestor). Texto sem arquivo é ignorado.
  // Grupo "ANALISTA JR" — assistente guiado: "oi" abre o menu e o robô conduz
  // passo a passo (NFS-e, agendar NFS-e, tarefa, lembrete, reunião, obrigação).
  if (ANALISTA_GRUPO_ID && remoteJid === ANALISTA_GRUPO_ID) {
    if (midia) {
      await enviarMensagem(remoteJid, '📎 Arquivos vão no grupo *Documentos* (lá eu leio e mostro o que dá para fazer). Aqui é só conversa: mande *oi*.')
      return { statusCode: 200, body: 'File in assistant group' }
    }
    return await processarAssistente(body, mensagem, remoteJid)
  }

  // Em qualquer um dos grupos, "opções" (ou "menu", "comandos", "ajuda")
  // responde com os comandos daquele grupo (lib/menuWhatsapp.js).
  if (!midia && menuWpp.pedeOpcoes(mensagem)) {
    const grupo = PAGAMENTOS_GRUPO_ID && remoteJid === PAGAMENTOS_GRUPO_ID ? 'pagamentos'
      : DOCS_GRUPO_ID && remoteJid === DOCS_GRUPO_ID ? 'documentos'
        : (GRUPO_ID ? remoteJid === GRUPO_ID : remoteJid.endsWith('@g.us')) ? 'escritorio' : null
    if (grupo) {
      await enviarMensagem(remoteJid, menuWpp.textoOpcoes(grupo))
      return { statusCode: 200, body: `Options sent (${grupo})` }
    }
  }

  if (PAGAMENTOS_GRUPO_ID && remoteJid === PAGAMENTOS_GRUPO_ID) {
    if (!midia) {
      return { statusCode: 200, body: 'No file in payments group message' }
    }
    return await processarComprovante(body, anexo, remoteJid)
  }

  if (DOCS_GRUPO_ID && remoteJid === DOCS_GRUPO_ID) {
    if (!midia) {
      // "nfse <empresa> <tomador> <valor>": NFS-e para tomador já cadastrado
      // "agendar nfse <empresa> <modelo> <valor> <dd/mm> <hh:mm>": emissão agendada (nota recorrente)
      const comandoAgendar = nfseWpp.lerComandoAgendar(mensagem)
      if (comandoAgendar) return await processarAgendarNfse(comandoAgendar.resto, mensagem, body, remoteJid)
      const comandoNfse = nfseWpp.lerComandoNfse(mensagem)
      if (comandoNfse) return await processarComandoNfse(comandoNfse.resto, mensagem, body, remoteJid)
      const resposta = await processarRespostaDocs(body, mensagem, remoteJid)
      if (resposta) return resposta
      // pedido de nota em texto livre: responde com o modelo da mensagem
      if (nfseWpp.pareceNfse(mensagem)) return await processarIntencaoNfse(mensagem, remoteJid)
      return { statusCode: 200, body: 'No document waiting for decision' }
    }
    return await processarDocumento(body, anexo, remoteJid)
  }

  // Mensagens com categoria: "tarefa:", "obrigação:", "reunião:" ou
  // "lembrete:" (ver lib/comandosWhatsapp.js). O resto é conversa.
  const comando = detectarComando(mensagem)
  if (!comando) {
    return { statusCode: 200, body: 'Not a command message' }
  }
  return await processarComando(comando, mensagem, remoteJid)
}
