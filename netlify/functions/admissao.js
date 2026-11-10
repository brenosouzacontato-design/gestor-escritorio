// netlify/functions/admissao.js
//
// Ficha de admissão de funcionário. O escritório gera um link (Clientes →
// Admissões) e manda ao candidato pelo WhatsApp; o candidato abre
// ?admissao=<token> (src/pages/admissao/FichaAdmissaoPage.jsx), preenche,
// fotografa os documentos e envia. Na hora ele recebe o resumo no WhatsApp e
// o escritório é avisado. Depois o escritório baixa a planilha para o OneFlow.
//
// Escritório (login do gestor):
//   POST { acao: 'criar', cliente_id, nome, telefone, cargo, salario, data_admissao, jornada, observacao, enviar_whatsapp }
//        → { admissao, link, whatsapp }
//   POST { acao: 'enviar_link', id }               → { whatsapp }   (manda o link de novo)
//   POST { acao: 'reenviar_resumo', id }           → { whatsapp }
//   POST { acao: 'devolver', id, motivo }          → { admissao, whatsapp }  (volta para o candidato corrigir)
//   POST { acao: 'planilha', ids }                 → { arquivo (xlsx base64), nome }
// Candidato (token do link no corpo: { token }):
//   POST { acao: 'abrir' }                          → { admissao, empresa, campos }
//   POST { acao: 'salvar', dados }                  → { admissao }   (rascunho)
//   POST { acao: 'url_upload', tipo, nome, mime }   → { path, token }  (envio direto ao Storage)
//   POST { acao: 'registrar_documento', tipo, path, nome, mime, tamanho } → { documentos }
//   POST { acao: 'remover_documento', path }        → { documentos }
//   POST { acao: 'enviar', dados }                  → { admissao, whatsapp } ou 400 com { pendencias }
//
// Arquivos no bucket documentos, em admissoes/<id>/. Tabela em supabase-schema-admissoes.sql.

const crypto = require('crypto')
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')
const { usuarioEscritorio } = require('./lib/autenticacao')
const { enviarMensagem, numeroWhatsapp } = require('./lib/whatsapp')
const { enviarPushEscritorio } = require('./lib/gestorPush')
const A = require('./lib/admissao')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const BUCKET = 'documentos'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/
const MAX_ARQUIVOS = 40
const MIMES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/
const LINKS_PLANILHA_DIAS = 7

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido, use POST.' })
  let corpo
  try { corpo = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Body inválido.' }) }

  try {
    if (corpo.token) return await doCandidato(corpo)
    if (!(await usuarioEscritorio(event))) return json(401, { error: 'Entre no gestor de novo e tente outra vez.' })
    return await doEscritorio(corpo)
  } catch (e) {
    if (e instanceof A.ErroAdmissao) return json(400, { error: e.message, pendencias: e.pendencias })
    console.error('admissao:', e.message)
    return json(500, { error: e.message })
  }
}

// ---------- escritório ----------

async function doEscritorio(corpo) {
  switch (corpo.acao) {
    case 'criar': return json(200, await criar(corpo))
    case 'enviar_link': {
      const adm = await buscar(corpo.id)
      return json(200, { whatsapp: await mandarConvite(adm) })
    }
    case 'reenviar_resumo': {
      const adm = await buscar(corpo.id)
      if (!adm.enviado_em) throw new A.ErroAdmissao('O funcionário ainda não enviou a ficha.')
      return json(200, { whatsapp: await mandarResumo(adm) })
    }
    case 'devolver': return json(200, await devolver(corpo))
    case 'planilha': return json(200, await planilha(corpo.ids))
    default: return json(400, { error: 'Ação desconhecida.' })
  }
}

async function buscar(id) {
  if (!UUID.test(id || '')) throw new A.ErroAdmissao('Admissão inválida.')
  const { data, error } = await supabase.from('admissoes').select('*, clientes(id, nome, cnpj)').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new A.ErroAdmissao('Admissão não encontrada.')
  return data
}

function linkDe(adm) {
  const site = (process.env.URL || '').replace(/\/$/, '')
  return `${site}/?admissao=${adm.token}`
}

async function criar(c) {
  if (!UUID.test(c.cliente_id || '')) throw new A.ErroAdmissao('Escolha a empresa que vai contratar.')
  const nome = String(c.nome || '').trim().slice(0, 150)
  if (!nome) throw new A.ErroAdmissao('Informe o nome do funcionário.')
  const telefone = String(c.telefone || '').replace(/\D/g, '')
  if (c.enviar_whatsapp && !numeroWhatsapp(telefone)) throw new A.ErroAdmissao('Informe o WhatsApp do funcionário com DDD.')
  const salario = c.salario === '' || c.salario == null ? null : Number(String(c.salario).replace(/\./g, '').replace(',', '.'))
  if (salario != null && !(salario >= 0)) throw new A.ErroAdmissao('Salário inválido.')
  const linha = {
    cliente_id: c.cliente_id,
    token: A.gerarToken(),
    nome_previsto: nome,
    telefone: telefone || null,
    cargo: String(c.cargo || '').trim().slice(0, 120) || null,
    salario,
    data_admissao: A.dataValida(c.data_admissao) ? c.data_admissao : null,
    jornada: String(c.jornada || '').trim().slice(0, 200) || null,
    observacao_interna: String(c.observacao || '').trim().slice(0, 1000) || null,
    dados: { nome, celular: telefone },
  }
  const { data: adm, error } = await supabase.from('admissoes').insert(linha).select('*, clientes(id, nome, cnpj)').single()
  if (error) throw error
  const whatsapp = c.enviar_whatsapp ? await mandarConvite(adm) : null
  return { admissao: adm, link: linkDe(adm), whatsapp }
}

async function mandarConvite(adm) {
  const destino = numeroWhatsapp(adm.dados?.celular || adm.telefone)
  if (!destino) return { ok: false, erro: 'Funcionário sem WhatsApp informado.' }
  const envio = await enviarMensagem(destino, A.mensagemConvite({
    nome: adm.nome_previsto, empresaNome: adm.clientes?.nome, cargo: adm.cargo, link: linkDe(adm),
  }))
  if (envio.sucesso) await supabase.from('admissoes').update({ link_enviado_em: new Date().toISOString() }).eq('id', adm.id)
  return envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro }
}

async function mandarResumo(adm) {
  const destino = numeroWhatsapp(adm.dados?.celular || adm.telefone)
  const agora = new Date().toISOString()
  const envio = destino
    ? await enviarMensagem(destino, A.resumoWhatsapp(adm, adm.clientes?.nome))
    : { sucesso: false, erro: 'Funcionário sem WhatsApp informado.' }
  const marca = envio.sucesso
    ? { whatsapp_enviado_em: agora, whatsapp_erro: null }
    : { whatsapp_erro: `${agora.slice(0, 10)}: ${envio.erro}`.slice(0, 300) }
  const { error } = await supabase.from('admissoes').update(marca).eq('id', adm.id)
  if (error) console.error('admissao: falha ao marcar WhatsApp:', error.message)
  return envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro }
}

async function devolver({ id, motivo }) {
  const texto = String(motivo || '').trim().slice(0, 800)
  if (!texto) throw new A.ErroAdmissao('Escreva o que o funcionário precisa corrigir.')
  const adm = await buscar(id)
  if (['concluida', 'cancelada'].includes(adm.status)) throw new A.ErroAdmissao('Esta admissão já foi encerrada.')
  const { data, error } = await supabase.from('admissoes')
    .update({ status: 'devolvida', motivo_devolucao: texto, atualizado_em: new Date().toISOString() })
    .eq('id', adm.id).select('*, clientes(id, nome, cnpj)').single()
  if (error) throw error
  const destino = numeroWhatsapp(adm.dados?.celular || adm.telefone)
  const envio = destino
    ? await enviarMensagem(destino, A.mensagemDevolucao({ nome: adm.dados?.nome || adm.nome_previsto, motivo: texto, link: linkDe(adm) }))
    : { sucesso: false, erro: 'Funcionário sem WhatsApp informado.' }
  return { admissao: data, whatsapp: envio.sucesso ? { ok: true } : { ok: false, erro: envio.erro } }
}

// Planilha .xlsx: aba Funcionários (uma linha cada), Dependentes e Documentos
// (links que valem LINKS_PLANILHA_DIAS dias).
async function planilha(ids) {
  const lista = (Array.isArray(ids) ? ids : []).filter((i) => UUID.test(i)).slice(0, 200)
  if (!lista.length) throw new A.ErroAdmissao('Escolha ao menos uma admissão.')
  const { data, error } = await supabase.from('admissoes').select('*, clientes(id, nome, cnpj)').in('id', lista).order('criado_em')
  if (error) throw error
  const funcionarios = data.map((adm) => A.linhaPlanilha(adm, adm.clientes || {}))
  const dependentes = data.flatMap((adm) => A.linhasDependentes(adm))
  const documentos = []
  for (const adm of data) {
    const docs = adm.documentos || []
    if (!docs.length) continue
    const { data: urls } = await supabase.storage.from(BUCKET)
      .createSignedUrls(docs.map((d) => d.path), LINKS_PLANILHA_DIAS * 86400)
    docs.forEach((d, i) => documentos.push({
      'CPF Funcionário': adm.dados?.cpf || '',
      'Funcionário': adm.dados?.nome || adm.nome_previsto,
      Documento: A.rotuloAnexo(d.tipo),
      Arquivo: d.nome || '',
      Link: urls?.[i]?.signedUrl || '',
    }))
  }
  const livro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(livro, XLSX.utils.json_to_sheet(funcionarios), 'Funcionários')
  XLSX.utils.book_append_sheet(livro, XLSX.utils.json_to_sheet(dependentes.length ? dependentes : [{ Aviso: 'Nenhum dependente' }]), 'Dependentes')
  XLSX.utils.book_append_sheet(livro, XLSX.utils.json_to_sheet(documentos.length ? documentos : [{ Aviso: 'Nenhum documento' }]), 'Documentos')
  const arquivo = XLSX.write(livro, { type: 'base64', bookType: 'xlsx' })
  const nome = data.length === 1
    ? `admissao-${(data[0].dados?.nome || data[0].nome_previsto).replace(/[^\p{L}\d ]/gu, '').trim().replace(/\s+/g, '-').toLowerCase()}.xlsx`
    : `admissoes-${new Date().toISOString().slice(0, 10)}.xlsx`
  return { arquivo, nome }
}

// ---------- candidato ----------

async function doCandidato(corpo) {
  if (!TOKEN.test(String(corpo.token))) return json(404, { error: 'Link inválido. Peça um novo ao RH.' })
  const { data: adm, error } = await supabase.from('admissoes').select('*, clientes(id, nome)').eq('token', corpo.token).maybeSingle()
  if (error) throw error
  if (!adm || adm.status === 'cancelada') return json(404, { error: 'Este link não vale mais. Peça um novo ao RH.' })
  if (adm.expira_em && new Date(adm.expira_em) < new Date() && A.STATUS_EDITAVEL.includes(adm.status)) {
    return json(410, { error: 'Este link venceu. Peça um novo ao RH.' })
  }

  if (corpo.acao === 'abrir') return json(200, { admissao: publico(adm), empresa: { nome: adm.clientes?.nome } })

  if (!A.STATUS_EDITAVEL.includes(adm.status)) {
    throw new A.ErroAdmissao('A ficha já foi enviada. Para mudar algo, fale com o RH.')
  }
  switch (corpo.acao) {
    case 'salvar': {
      const dados = A.normalizarDados(corpo.dados)
      const status = adm.status === 'aguardando' ? 'preenchendo' : adm.status
      const salvo = await atualizar(adm.id, { dados, status })
      return json(200, { admissao: publico(salvo) })
    }
    case 'url_upload': {
      const anexo = A.CAMPOS.anexos.find((a) => a.id === corpo.tipo)
      if (!anexo) throw new A.ErroAdmissao('Tipo de documento inválido.')
      if (!MIMES.test(corpo.mime || '')) throw new A.ErroAdmissao('Envie foto (JPG/PNG) ou PDF.')
      const docs = adm.documentos || []
      if (docs.length >= MAX_ARQUIVOS) throw new A.ErroAdmissao('Limite de arquivos atingido. Remova algum antes.')
      if (docs.filter((d) => d.tipo === anexo.id).length >= anexo.max) throw new A.ErroAdmissao(`Máximo de ${anexo.max} arquivo(s) em "${anexo.rotulo}".`)
      const ext = corpo.mime === 'application/pdf' ? 'pdf' : corpo.mime.split('/')[1].replace('jpeg', 'jpg')
      const path = `admissoes/${adm.id}/${anexo.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`
      const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (e) throw e
      return json(200, { path, token: data.token })
    }
    case 'registrar_documento': {
      const path = String(corpo.path || '')
      const prefixo = `admissoes/${adm.id}/`
      const anexo = A.CAMPOS.anexos.find((a) => a.id === corpo.tipo)
      if (!anexo || !path.startsWith(prefixo) || !path.slice(prefixo.length).startsWith(`${anexo.id}-`) || path.includes('..')) {
        throw new A.ErroAdmissao('Arquivo inválido.')
      }
      // confere que o arquivo chegou mesmo ao Storage
      const nomeArq = path.slice(prefixo.length)
      const { data: achados } = await supabase.storage.from(BUCKET).list(`admissoes/${adm.id}`, { search: nomeArq })
      if (!(achados || []).some((o) => o.name === nomeArq)) throw new A.ErroAdmissao('O arquivo não chegou. Tente de novo.')
      const docs = (adm.documentos || []).filter((d) => d.path !== path)
      docs.push({
        tipo: anexo.id, path, nome: String(corpo.nome || '').slice(0, 120), mime: String(corpo.mime || '').slice(0, 60),
        tamanho: Number(corpo.tamanho) || null, em: new Date().toISOString(),
      })
      const salvo = await atualizar(adm.id, { documentos: docs, status: adm.status === 'aguardando' ? 'preenchendo' : adm.status })
      return json(200, { documentos: salvo.documentos })
    }
    case 'remover_documento': {
      const doc = (adm.documentos || []).find((d) => d.path === corpo.path)
      if (!doc) throw new A.ErroAdmissao('Arquivo não encontrado.')
      await supabase.storage.from(BUCKET).remove([doc.path])
      const salvo = await atualizar(adm.id, { documentos: adm.documentos.filter((d) => d.path !== doc.path) })
      return json(200, { documentos: salvo.documentos })
    }
    case 'enviar': return json(200, await enviarFicha(adm, corpo.dados))
    default: return json(400, { error: 'Ação desconhecida.' })
  }
}

async function atualizar(id, mudancas) {
  const { data, error } = await supabase.from('admissoes')
    .update({ ...mudancas, atualizado_em: new Date().toISOString() }).eq('id', id).select('*, clientes(id, nome, cnpj)').single()
  if (error) throw error
  return data
}

async function enviarFicha(adm, bruto) {
  const dados = A.normalizarDados(bruto)
  const pendencias = A.pendenciasFicha(dados, adm.documentos || [])
  if (pendencias.length) {
    await atualizar(adm.id, { dados })
    const e = new A.ErroAdmissao(`Faltam ${pendencias.length} item(ns) para enviar.`)
    e.pendencias = pendencias
    throw e
  }
  const reenvio = adm.status === 'devolvida'
  const salvo = await atualizar(adm.id, { dados, status: 'enviada', enviado_em: new Date().toISOString(), motivo_devolucao: null })
  const whatsapp = await mandarResumo(salvo)
  await avisarEscritorio(salvo, reenvio)
  return { admissao: publico(salvo), whatsapp }
}

// Aviso no grupo do escritório (WHATSAPP_GROUP_ID) e nos aparelhos — sem travar o envio se falhar.
async function avisarEscritorio(adm, reenvio) {
  const nome = adm.dados?.nome || adm.nome_previsto
  const texto = `🧾 ${reenvio ? 'Ficha de admissão corrigida' : 'Nova ficha de admissão'}: *${nome}* — ${adm.clientes?.nome || ''}${adm.cargo ? ` (${adm.cargo})` : ''}. Veja em Clientes → Admissões.`
  try {
    const grupo = process.env.WHATSAPP_GROUP_ID
    if (grupo) await enviarMensagem(grupo, texto)
    await enviarPushEscritorio(supabase, { titulo: '🧾 Ficha de admissão', mensagem: texto.replace(/\*/g, ''), url: '/?tela=admissoes', tag: `admissao-${adm.id}` })
  } catch (e) {
    console.error('admissao: aviso ao escritório falhou:', e.message)
  }
}

// O que o candidato pode ver (sem salário nem observação interna).
function publico(adm) {
  return {
    status: adm.status,
    nome_previsto: adm.nome_previsto,
    cargo: adm.cargo,
    data_admissao: adm.data_admissao,
    dados: adm.dados || {},
    documentos: (adm.documentos || []).map(({ tipo, path, nome, mime }) => ({ tipo, path, nome, mime })),
    motivo_devolucao: adm.motivo_devolucao,
    enviado_em: adm.enviado_em,
  }
}

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
