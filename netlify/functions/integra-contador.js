// netlify/functions/integra-contador.js
//
// Integra Contador (SERPRO): recálculo de DARF (Sicalc), DAS do Simples (PGDAS-D) e DAS das parcelas
// de parcelamentos do Simples/MEI. Só o escritório logado (lib/autenticacao.js).
// Biblioteca: lib/serpro/. Tabelas: supabase-schema-integra-contador.sql. Ver docs/integra-contador.md.
//
// Variáveis no Netlify: SERPRO_CONSUMER_KEY, SERPRO_CONSUMER_SECRET (Área do Cliente SERPRO),
// NFSE_CERT_KEY (cofre do certificado, a mesma da NFS-e) e, opcional, SERPRO_AMBIENTE=trial
// (demonstração pública, dados simulados).
//
//   POST { acao: 'status' }                                   → { ambiente, chaves, certificado }
//   POST { acao: 'salvar_certificado', pfx_base64, senha }    → { certificado }  (e-CNPJ do escritório)
//   POST { acao: 'darf', cliente_id, form }                   → { guia, url }  form: ver lib/serpro/servicos.dadosDarf
//   POST { acao: 'das', cliente_id, periodo, data_consolidacao? } → { guia, url }
//   POST { acao: 'parcelamentos' }                            → { parcelamentos: [{ sistema, nome }] }
//   POST { acao: 'parcelas', cliente_id, sistema }            → { parcelas: [{ parcela: 'MM/AAAA', valor }] }
//   POST { acao: 'parcela', cliente_id, sistema, parcela }    → { guia, url }
//   POST { acao: 'historico', cliente_id? }                   → { guias, consumo_mes }
//   POST { acao: 'arquivo', id }                              → { url }   (link assinado, 10 min)
//   POST { acao: 'enviar_documentos', id }                    → { documento_id }  (vai para Documentos do cliente)

const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { exigirEscritorio, usuarioEscritorio } = require('./lib/autenticacao')
const { lerPfx, diasRestantes } = require('./lib/nfse/certificado')
const { cifrar, decifrar } = require('./lib/nfse/cofre')
const { criarCliente, ErroIntegra, PARTES_TRIAL } = require('./lib/serpro/integraContador')
const s = require('./lib/serpro/servicos')

const BUCKET = 'documentos'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOME_TIPO = { darf: 'DARF', das: 'DAS', parcela: 'DAS PARCELAMENTO' }

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem)
    this.status = status
  }
}

const json = (statusCode, corpo) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
const ambiente = () => (process.env.SERPRO_AMBIENTE === 'trial' ? 'trial' : 'producao')
const digitos = (v) => String(v || '').replace(/\D/g, '')

function uuid(v, nome = 'id') {
  if (!UUID.test(String(v || ''))) throw new ErroHttp(400, `${nome} inválido`)
  return v
}

async function ok(q) {
  const { data, error } = await q
  if (error) {
    if (/serpro_config|integra_guias|integra_chamadas/.test(error.message || '')) throw new ErroHttp(500, 'Rode supabase-schema-integra-contador.sql no Supabase.')
    throw new ErroHttp(500, error.message)
  }
  return data
}

async function empresa(sb, id) {
  const c = await ok(sb.from('clientes').select('id,nome,cnpj').eq('id', uuid(id, 'cliente_id')).maybeSingle())
  if (!c) throw new ErroHttp(404, 'Empresa não encontrada')
  if (digitos(c.cnpj).length !== 14) throw new ErroHttp(400, `${c.nome} está sem CNPJ no cadastro`)
  return c
}

// ---------------------------------------------------------------- certificado do escritório
async function certificado(sb) {
  const cfg = await ok(sb.from('serpro_config').select('*').eq('id', 1).maybeSingle())
  if (!cfg) return null
  return cfg
}

function resumoCert(cfg) {
  if (!cfg) return null
  const ate = cfg.cert_valido_ate ? new Date(cfg.cert_valido_ate) : null
  return {
    cnpj: cfg.cert_cnpj, titular: cfg.cert_titular, valido_ate: cfg.cert_valido_ate,
    dias_restantes: ate ? Math.floor((ate.getTime() - Date.now()) / 86400000) : null,
    atualizado_em: cfg.atualizado_em,
  }
}

let _cliente = null // reaproveita o token do SERPRO enquanto a function estiver "quente"
async function clienteSerpro(sb) {
  if (ambiente() === 'trial') {
    // a demonstração só responde aos documentos fictícios dos cenários; o contratante é o do cenário
    return { cli: criarCliente({ ambiente: 'trial', contratante: '00000000000000' }), contratante: '00000000000000' }
  }
  const cfg = await certificado(sb)
  if (!cfg) throw new ErroHttp(400, 'Cadastre o certificado A1 do escritório (aba Configuração).')
  const chaveCache = `${cfg.atualizado_em}|${process.env.SERPRO_CONSUMER_KEY || ''}`
  if (!_cliente || _cliente.chave !== chaveCache) {
    const cert = lerPfx(decifrar(cfg.pfx_cifrado), decifrar(cfg.senha_cifrada).toString('utf8'))
    _cliente = {
      chave: chaveCache,
      contratante: cert.cnpj,
      cli: criarCliente({
        consumerKey: process.env.SERPRO_CONSUMER_KEY, consumerSecret: process.env.SERPRO_CONSUMER_SECRET,
        tls: cert.tls, contratante: cert.cnpj,
      }),
    }
  }
  return _cliente
}

// Chama o SERPRO registrando a chamada (o contrato é cobrado por requisição).
async function chamar(sb, clienteId, servico, contribuinte, dados) {
  const { cli } = await clienteSerpro(sb)
  const inicio = Date.now()
  // na demonstração cada cenário só aceita os documentos fictícios dele
  const partes = ambiente() === 'trial' ? (PARTES_TRIAL[servico.idSistema] || PARTES_TRIAL.padrao) : null
  const registrar = (ok_, status, mensagem) => sb.from('integra_chamadas').insert({
    cliente_id: clienteId, id_sistema: servico.idSistema, id_servico: servico.idServico, status, ok: ok_,
    mensagem: mensagem ? String(mensagem).slice(0, 500) : null, duracao_ms: Date.now() - inicio, ambiente: ambiente(),
  }).then(() => null, () => null)
  try {
    const r = await cli.chamar(servico.operacao, { contribuinte, ...servico, dados, partes })
    await registrar(true, r.status, null)
    return r.dados
  } catch (e) {
    await registrar(false, e.status || null, e.message)
    throw e
  }
}

async function guardarGuia(sb, event, { cliente, tipo, sistema, referencia, parametros, resultado }) {
  const id = crypto.randomUUID()
  const caminho = `integra/${id}.pdf`
  const { error } = await sb.storage.from(BUCKET).upload(caminho, resultado.pdf, { contentType: 'application/pdf', upsert: false })
  if (error) throw new ErroHttp(500, `Falha ao guardar o PDF: ${error.message}`)
  const usuario = await usuarioEscritorio(event)
  const [guia] = await ok(sb.from('integra_guias').insert({
    id, cliente_id: cliente.id, tipo, sistema, referencia, parametros,
    numero_documento: resultado.numero_documento || null,
    principal: resultado.principal ?? null, multa: resultado.multa ?? null, juros: resultado.juros ?? null,
    total: resultado.total ?? (resultado.valor ?? null),
    vencimento: resultado.vencimento || null, validade: resultado.validade || null,
    arquivo_path: caminho, ambiente: ambiente(), criado_por: (usuario && usuario.email) || null,
  }).select('*'))
  return { guia, url: await link(sb, caminho) }
}

async function link(sb, caminho) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(caminho, 600)
  if (error) throw new ErroHttp(500, error.message)
  return data.signedUrl
}

const nomeArquivo = (g, cliente) =>
  `${NOME_TIPO[g.tipo]} ${(g.sistema && g.tipo === 'parcela') ? g.sistema + ' ' : ''}${cliente.nome.slice(0, 40)} ${String(g.referencia || '').replace(/\//g, '-')}.pdf`
    .replace(/[\\:*?"<>|]+/g, '-')

// ---------------------------------------------------------------- ações
async function executar(p, event, sb) {
  switch (p.acao) {
    case 'status': {
      let cert = null
      try { cert = resumoCert(await certificado(sb)) } catch (e) { if (e.status !== 500) throw e; return { ambiente: ambiente(), erro: e.message } }
      return {
        ambiente: ambiente(),
        chaves: !!(process.env.SERPRO_CONSUMER_KEY && process.env.SERPRO_CONSUMER_SECRET),
        cofre: !!process.env.NFSE_CERT_KEY,
        certificado: cert,
      }
    }

    case 'salvar_certificado': {
      const pfx = Buffer.from(String(p.pfx_base64 || ''), 'base64')
      if (pfx.length < 100) throw new ErroHttp(400, 'Envie o arquivo .pfx/.p12 do certificado')
      let cert
      try { cert = lerPfx(pfx, String(p.senha || '')) } catch (e) { throw new ErroHttp(400, e.message) }
      if (cert.cnpj.length !== 14) throw new ErroHttp(400, 'Esse certificado não é um e-CNPJ (o Integra Contador exige o e-CNPJ do contratante).')
      if (diasRestantes(cert) < 0) throw new ErroHttp(400, 'Esse certificado está vencido.')
      const usuario = await usuarioEscritorio(event)
      await ok(sb.from('serpro_config').upsert({
        id: 1, pfx_cifrado: cifrar(pfx), senha_cifrada: cifrar(String(p.senha || '')),
        cert_cnpj: cert.cnpj, cert_titular: cert.titular, cert_valido_ate: cert.validoAte.toISOString(),
        atualizado_por: (usuario && usuario.email) || null, atualizado_em: new Date().toISOString(),
      }))
      _cliente = null
      return { certificado: resumoCert(await certificado(sb)) }
    }

    case 'darf': {
      const cliente = await empresa(sb, p.cliente_id)
      const dados = s.dadosDarf(p.form)
      const r = s.resultadoDarf(await chamar(sb, cliente.id, s.SERVICOS.darf, cliente.cnpj, dados))
      return guardarGuia(sb, event, {
        cliente, tipo: 'darf', sistema: 'SICALC', referencia: `${dados.codigoReceita}-${dados.codigoReceitaExtensao} ${dados.dataPA}`,
        parametros: dados, resultado: r,
      })
    }

    case 'das': {
      const cliente = await empresa(sb, p.cliente_id)
      const dados = s.dadosDas({ periodo: p.periodo, data_consolidacao: p.data_consolidacao })
      const r = s.resultadoDas(await chamar(sb, cliente.id, s.SERVICOS.das, cliente.cnpj, dados))
      const c = s.competencia(p.periodo)
      return guardarGuia(sb, event, { cliente, tipo: 'das', sistema: 'PGDASD', referencia: `${c.mes}/${c.ano}`, parametros: dados, resultado: r })
    }

    case 'parcelamentos':
      return { parcelamentos: Object.entries(s.PARCELAMENTOS).map(([sistema, x]) => ({ sistema, nome: x.nome })) }

    case 'parcelas': {
      const cliente = await empresa(sb, p.cliente_id)
      const servico = s.servicoParcelamento(p.sistema, 'parcelas')
      const lista = s.resultadoParcelas(await chamar(sb, cliente.id, servico, cliente.cnpj, ''))
      return { parcelas: lista.map((x) => ({ parcela: s.parcelaBr(x.parcela), valor: x.valor })) }
    }

    case 'parcela': {
      const cliente = await empresa(sb, p.cliente_id)
      const servico = s.servicoParcelamento(p.sistema, 'emitir')
      const dados = s.dadosParcela(p.parcela)
      const r = s.resultadoDasParcela(await chamar(sb, cliente.id, servico, cliente.cnpj, dados))
      const valor = Number(p.valor) > 0 ? Number(p.valor) : null  // a emissão não devolve valor: vem da lista de parcelas
      return guardarGuia(sb, event, {
        cliente, tipo: 'parcela', sistema: p.sistema, referencia: s.parcelaBr(dados.parcelaParaEmitir), parametros: dados,
        resultado: { ...r, valor },
      })
    }

    case 'historico': {
      let q = sb.from('integra_guias').select('*, clientes(nome)').order('criado_em', { ascending: false }).limit(100)
      if (p.cliente_id) q = q.eq('cliente_id', uuid(p.cliente_id, 'cliente_id'))
      const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0)
      const [guias, chamadas] = await Promise.all([
        ok(q),
        ok(sb.from('integra_chamadas').select('id', { count: 'exact', head: true }).gte('criado_em', inicioMes.toISOString()).eq('ambiente', 'producao')),
      ])
      return { guias, consumo_mes: chamadas }
    }

    case 'arquivo': {
      const g = await ok(sb.from('integra_guias').select('arquivo_path').eq('id', uuid(p.id)).maybeSingle())
      if (!g) throw new ErroHttp(404, 'Guia não encontrada')
      return { url: await link(sb, g.arquivo_path) }
    }

    case 'enviar_documentos': {
      const g = await ok(sb.from('integra_guias').select('*, clientes(id,nome)').eq('id', uuid(p.id)).maybeSingle())
      if (!g) throw new ErroHttp(404, 'Guia não encontrada')
      if (g.documento_id) return { documento_id: g.documento_id }
      if (g.ambiente !== 'producao') throw new ErroHttp(400, 'Guia da demonstração (dados simulados) não vai para Documentos.')
      const baixado = await sb.storage.from(BUCKET).download(g.arquivo_path)
      if (baixado.error) throw new ErroHttp(500, baixado.error.message)
      const agora = new Date().toISOString()
      const [doc] = await ok(sb.from('documentos').insert({
        cliente_id: g.cliente_id, nome_arquivo: nomeArquivo(g, g.clientes), storage_path: g.arquivo_path,
        tipo_mime: 'application/pdf', tamanho_bytes: (await baixado.data.arrayBuffer()).byteLength,
        tipo_documento_sugerido: g.tipo === 'parcela' ? `PARCELAMENTO ${g.sistema}` : NOME_TIPO[g.tipo],
        status: 'confirmado', confirmado_em: agora,
        valor_guia: g.total, vencimento_guia: g.validade || g.vencimento, valor_guia_extraido_em: agora,
      }).select('id'))
      await ok(sb.from('integra_guias').update({ documento_id: doc.id }).eq('id', g.id))
      return { documento_id: doc.id }
    }

    default:
      throw new ErroHttp(400, 'Ação desconhecida')
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'Use POST' })
  const negado = await exigirEscritorio(event, 'integra-contador')
  if (negado) return negado
  let p
  try { p = JSON.parse(event.body || '{}') } catch { return json(400, { erro: 'Corpo inválido' }) }
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return json(200, await executar(p, event, sb))
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : (e instanceof ErroIntegra ? (e.status >= 400 && e.status < 500 ? 422 : 502) : 500)
    if (status === 500) console.error('[integra-contador]', e)
    return json(status, { erro: e.message, mensagens: e.mensagens || undefined })
  }
}

// para os testes
exports._executar = executar
