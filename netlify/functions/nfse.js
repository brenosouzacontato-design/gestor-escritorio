// netlify/functions/nfse.js
//
// API do módulo de emissão de NFS-e (Sefin Nacional). Ver docs/nfse-emissao.md.
//
// POST /.netlify/functions/nfse   Authorization: Bearer <token da sessão do gestor>
//   { acao: 'status', cliente_id }
//   { acao: 'salvar_empresa', cliente_id, gabarito_xml, ambiente?, serie_dps?, regra_competencia?, campos_obrigatorios?, whatsapp_origem? }
//   { acao: 'salvar_certificado', cliente_id, pfx_base64, senha }
//   { acao: 'importar', cliente_id, texto }  |  { acao: 'importar', cliente_id, planilha_base64, nome_arquivo }
//        Em produção, lê antes as notas novas do Ambiente Nacional: a validação marca "Já emitida" e
//        "Complementar?" também contra as notas emitidas fora do gestor.
//   { acao: 'editar', nota_id, campos }
//   { acao: 'competencia', nota_ids, competencia }
//   { acao: 'excluir', nota_id }  |  { acao: 'copiar', nota_id }
//   { acao: 'previa', nota_id }
//   { acao: 'emitir', nota_id, ambiente, confirmar_repetida? } ← ambiente confirmado na tela; se divergir, nada é enviado.
//        Nota igual a outra já emitida (CPF+data+valor) é bloqueada; parecida (CPF+valor no mesmo mês)
//        só vai com confirmar_repetida: true.
//   { acao: 'complementar', nota_id }  ← "Complementar?": emite só a diferença (valor e descrição ajustados)
//   { acao: 'liberar_duplicidade', nota_id, liberar? }  ← "Complementar?"/"Já emitida" conferida: é outro
//        serviço, emite pelo valor cheio (liberar: false desfaz)
//   { acao: 'marcar_cancelada', nota_id, motivo }  ← registra o cancelamento feito no portal nacional
//   { acao: 'tomador_salvar', cliente_id, tomador }  |  { acao: 'tomador_excluir', cliente_id, id }
//   { acao: 'tomadores_importar', cliente_id, planilha_base64, gravar? }  ← sem gravar: só a prévia
//   { acao: 'extrato_analisar', cliente_id, texto }  ← extrato bancário (linhas do PDF ou OFX): cada PIX
//        recebido com quem pagou (cadastro + notas anteriores) e se já tem nota. Não grava nada.
//   { acao: 'extrato_criar_lote', cliente_id, arquivo, itens: [{ nome, cpf, data, valor, descricao_extrato,
//        nome_extrato, salvar_cadastro? }] }  ← os PIX conferidos viram um lote (conferir e emitir como sempre)
//
// Leitura de lotes/notas é feita direto pelo navegador (RLS: usuário logado só lê). Toda escrita passa
// por aqui, onde valem a máquina de estados, a reserva de número e a duplicidade.
//
// Variáveis no Netlify: SUPABASE_URL, SUPABASE_SERVICE_KEY, NFSE_CERT_KEY, NFSE_EMAILS_PERMITIDOS (opcional)

const { ErroHttp, exigirUsuario, responder, supabaseServico } = require('./lib/nfse/auth')
const { cifrar, decifrar } = require('./lib/nfse/cofre')
const { lerPfx, checar, testarPar, diasRestantes } = require('./lib/nfse/certificado')
const { carregarGabarito, CODIGOS_ATIVIDADE_SN, FORMATOS_IBSCBS } = require('./lib/nfse/dps')
const { filho } = require('./lib/nfse/xml')
const { criarCliente } = require('./lib/nfse/sefin')
const { RepositorioSupabase, TransicaoInvalida } = require('./lib/nfse/repositorio')
const lotes = require('./lib/nfse/lotes')
const { criarEmissor, EmissaoBloqueada } = require('./lib/nfse/emissor')
const { importarTexto, importarLinhas, parseValor, soDigitos } = require('./lib/nfse/importador')
const { completarComCadastro, lerPlanilhaTomadores, planejarImportacao } = require('./lib/nfse/tomadores')
const { cpfValido } = require('./lib/nfse/validador')
const { criarClienteAdn, sincronizar } = require('./lib/nfse/adn')
const { lerExtrato, montarPessoas, sugerirNotas, norm } = require('./lib/nfse/extrato')
const { novoRegistro } = require('./lib/nfse/importador')

// Timeout da Sefin abaixo do limite da function: se estourar, a nota fica "indeterminada" e a
// próxima tentativa reconsulta antes de reenviar (nunca há envio em dobro).
const TIMEOUT_SEFIN_MS = 8000

// Dependências externas (substituídas nos testes)
const deps = {
  supabase: () => supabaseServico(),
  criarCliente,
  // Antes de importar, busca as notas novas no Ambiente Nacional (as emitidas fora do gestor entram
  // na conferência de "já emitida"/"complementar"). Falha aqui não impede a importação.
  atualizarAdn: async (db, empresa) => {
    if (empresa.ambiente !== 'producao') return
    try {
      const cert = await carregarCertificado(db, empresa)
      await sincronizar({ db, clienteId: empresa.cliente_id, cnpj: empresa.cnpj, cliente: criarClienteAdn({ tls: cert.tls }), prazoMs: 4000 })
    } catch (e) {
      console.warn('nfse: leitura do Ambiente Nacional antes de importar:', e.message)
    }
  },
}

const exigir = (cond, msg, status = 400) => { if (!cond) throw new ErroHttp(status, msg) }
const uuid = (v, nome) => { exigir(/^[0-9a-f-]{36}$/i.test(String(v || '')), `${nome} inválido`); return v }

async function empresaDaNota(repo, notaId) {
  const nota = await repo.obterNota(uuid(notaId, 'nota_id'))
  exigir(nota, 'Nota não encontrada', 404)
  const empresa = await repo.obterEmpresa(nota.cliente_id)
  exigir(empresa, 'Empresa sem configuração de NFS-e', 409)
  return { nota, empresa }
}

async function carregarCertificado(db, empresa) {
  const { data, error } = await db.from('nfse_certificados').select('pfx_cifrado, senha_cifrada').eq('cliente_id', empresa.cliente_id).maybeSingle()
  if (error) throw new Error(error.message)
  exigir(data, 'Empresa sem certificado A1 cadastrado', 409)
  const cert = lerPfx(decifrar(data.pfx_cifrado), decifrar(data.senha_cifrada).toString('utf8'))
  const { bloqueios } = checar(cert, empresa.cnpj)
  exigir(!bloqueios.length, `Emissão bloqueada: ${bloqueios.join('; ')}`, 409)
  return cert
}

async function emissorDa(db, repo, empresa, usuario) {
  const certificado = await carregarCertificado(db, empresa)
  const cliente = deps.criarCliente({ tls: certificado.tls, ambiente: empresa.ambiente, timeoutMs: TIMEOUT_SEFIN_MS })
  return criarEmissor({ repo, empresa, certificado, cliente, usuario: usuario.email })
}

// Extrai da NFS-e de exemplo o que dá para pré-preencher: CNPJ, município e tributação do serviço.
function analisarGabarito(xml) {
  const dps = carregarGabarito(xml)
  const inf = filho(dps, 'infDPS')
  const txt = (c) => (filho(inf, c) || {}).text || ''
  exigir(filho(inf, 'toma/CPF') || filho(inf, 'toma/CNPJ'), 'O gabarito precisa ter tomador (toma)')
  return {
    cnpj: txt('prest/CNPJ'),
    codigo_municipio: txt('cLocEmi'),
    servico_padrao: {
      cTribNac: txt('serv/cServ/cTribNac'),
      tribISSQN: txt('valores/trib/tribMun/tribISSQN'),
      tpRetISSQN: txt('valores/trib/tribMun/tpRetISSQN'),
    },
    descricao_exemplo: txt('serv/cServ/xDescServ'),
    op_simp_nac: txt('prest/regTrib/opSimpNac'),
    serie_emissor_web: txt('serie'),
  }
}

// Campos da configuração que não vêm do gabarito (NT 009: Simples Nacional e IBS/CBS), validados;
// vazio apaga.
const VALIDOS_CONFIG = {
  regApIBSCBSSN: (v) => ['1', '2', '3'].includes(v),
  cAtvSN: (v) => CODIGOS_ATIVIDADE_SN.includes(v),
  cIndOp: (v) => FORMATOS_IBSCBS.cIndOp.test(v),
  CST: (v) => FORMATOS_IBSCBS.CST.test(v),
  cClassTrib: (v) => FORMATOS_IBSCBS.cClassTrib.test(v),
  cNBS: (v) => FORMATOS_IBSCBS.cNBS.test(v),
}
function camposSimples(sp) {
  const saida = {}
  for (const [campo, valido] of Object.entries(VALIDOS_CONFIG)) {
    if (!(campo in sp)) continue
    let v = sp[campo] == null ? '' : String(sp[campo]).trim()
    if (['cIndOp', 'CST', 'cClassTrib', 'cNBS'].includes(campo)) v = v.replace(/\D/g, '')
    exigir(v === '' || valido(v), `${campo} inválido: ${v}`)
    saida[campo] = v || undefined
  }
  return saida
}

const acoes = {
  async status({ db, repo }, { cliente_id }) {
    const empresa = await repo.obterEmpresa(uuid(cliente_id, 'cliente_id'))
    if (!empresa) return { configurada: false }
    const { gabarito_xml, ...semGabarito } = empresa
    let certificado = null
    if (empresa.cert_valido_ate) {
      const fake = { cnpj: empresa.cert_cnpj, validoDe: new Date(0), validoAte: new Date(empresa.cert_valido_ate) }
      certificado = { titular: empresa.cert_titular, cnpj: empresa.cert_cnpj, valido_ate: empresa.cert_valido_ate,
        dias_restantes: diasRestantes(fake), ...checar(fake, empresa.cnpj) }
    }
    return { configurada: true, empresa: { ...semGabarito, gabarito: analisarGabarito(gabarito_xml) }, certificado }
  },

  async salvar_empresa({ db, repo }, p) {
    const clienteId = uuid(p.cliente_id, 'cliente_id')
    const { data: cli } = await db.from('clientes').select('id, cnpj, nome').eq('id', clienteId).maybeSingle()
    exigir(cli, 'Cliente não encontrado', 404)
    const atual = await repo.obterEmpresa(clienteId)
    const gabaritoXml = p.gabarito_xml || (atual && atual.gabarito_xml)
    exigir(gabaritoXml, 'Envie o XML de uma NFS-e já emitida por esta empresa (gabarito)')
    const g = analisarGabarito(gabaritoXml)
    const cnpjCliente = String(cli.cnpj || '').replace(/\D/g, '')
    exigir(!cnpjCliente || cnpjCliente === g.cnpj, `O gabarito é do CNPJ ${g.cnpj}, mas o cliente ${cli.nome} tem CNPJ ${cnpjCliente}`)
    const ambiente = p.ambiente || (atual && atual.ambiente) || 'homologacao'
    exigir(['homologacao', 'producao'].includes(ambiente), 'Ambiente inválido')
    const serie = String(p.serie_dps || (atual && atual.serie_dps) || '900')
    exigir(/^\d{1,5}$/.test(serie), 'Série inválida')
    exigir(serie !== g.serie_emissor_web, `A série ${serie} é a mesma do Emissor Web (gabarito); use outra para não colidir a numeração`)
    const registro = {
      cliente_id: clienteId, ambiente, serie_dps: serie, codigo_municipio: g.codigo_municipio, cnpj: g.cnpj,
      regra_competencia: p.regra_competencia || (atual && atual.regra_competencia) || 'mes_do_atendimento',
      // regApIBSCBSSN e cAtvSN (Simples Nacional, NT 009) não vêm do gabarito: ficam os já salvos
      servico_padrao: {
        ...g.servico_padrao,
        ...camposSimples((atual && atual.servico_padrao) || {}),
        ...camposSimples(p.servico_padrao || {}),
      },
      campos_obrigatorios: p.campos_obrigatorios || (atual && atual.campos_obrigatorios) || ['nome', 'cpf', 'data', 'valor', 'descricao', 'endereco'],
      gabarito_xml: gabaritoXml,
      whatsapp_origem: p.whatsapp_origem !== undefined ? p.whatsapp_origem || null : (atual && atual.whatsapp_origem) || null,
      descricao_padrao: p.descricao_padrao !== undefined ? String(p.descricao_padrao || '').trim().slice(0, 2000) : (atual && atual.descricao_padrao) || '',
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('nfse_empresas').upsert(registro, { onConflict: 'cliente_id' })
    if (error) throw new Error(error.message)
    // Regras novas (campos obrigatórios, descrição padrão, competência) valem já para os lotes em aberto
    const empresaSalva = await repo.obterEmpresa(clienteId)
    for (const loteId of await repo.listarLotesEmAberto(clienteId, empresaSalva.ambiente)) {
      await lotes.revalidarLote(repo, loteId, empresaSalva)
    }
    return acoes.status({ db, repo }, { cliente_id: clienteId })
  },

  async salvar_certificado({ db, repo }, p) {
    const clienteId = uuid(p.cliente_id, 'cliente_id')
    const empresa = await repo.obterEmpresa(clienteId)
    exigir(empresa, 'Configure a empresa (gabarito) antes do certificado', 409)
    exigir(p.pfx_base64 && p.senha, 'Envie o arquivo .pfx e a senha')
    const pfx = Buffer.from(p.pfx_base64, 'base64')
    let cert
    try { cert = lerPfx(pfx, p.senha) } catch (e) { throw new ErroHttp(400, e.message) }
    exigir(testarPar(cert), 'A chave privada não corresponde ao certificado')
    const { bloqueios } = checar(cert, empresa.cnpj)
    exigir(!bloqueios.length, bloqueios.join('; '))
    const { error } = await db.from('nfse_certificados').upsert({
      cliente_id: clienteId, pfx_cifrado: cifrar(pfx), senha_cifrada: cifrar(p.senha), enviado_em: new Date().toISOString(),
    }, { onConflict: 'cliente_id' })
    if (error) throw new Error(error.message)
    const { error: e2 } = await db.from('nfse_empresas').update({
      cert_titular: cert.titular, cert_cnpj: cert.cnpj, cert_valido_ate: cert.validoAte.toISOString(),
    }).eq('cliente_id', clienteId)
    if (e2) throw new Error(e2.message)
    return acoes.status({ db, repo }, { cliente_id: clienteId })
  },

  async importar({ db, repo }, p) {
    const empresa = await repo.obterEmpresa(uuid(p.cliente_id, 'cliente_id'))
    exigir(empresa, 'Empresa sem configuração de NFS-e', 409)
    await deps.atualizarAdn(db, empresa)
    let registros
    let origem
    let descricao = ''
    if (p.planilha_base64) {
      const XLSX = require('xlsx')
      const wb = XLSX.read(Buffer.from(p.planilha_base64, 'base64'), { type: 'buffer', cellDates: true, UTC: true })
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
      try { registros = importarLinhas(linhas) } catch (e) { throw new ErroHttp(400, e.message) }
      origem = 'planilha'
      descricao = String(p.nome_arquivo || '').slice(0, 200)
    } else {
      exigir(String(p.texto || '').trim(), 'Cole o texto das mensagens')
      registros = importarTexto(p.texto)
      origem = 'colado'
    }
    exigir(registros.length, 'Nenhum atendimento encontrado')
    // CPF, endereço e descrição que faltarem vêm do cadastro de clientes (só quando o nome bate sem dúvida)
    registros = completarComCadastro(registros, await repo.listarTomadores(empresa.cliente_id), { descricaoPadrao: empresa.descricao_padrao || '' })
    const loteId = await lotes.criarLote(repo, { empresa, origem, descricao, registros })
    return { lote_id: loteId }
  },

  async editar({ repo }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    await lotes.atualizarNota(repo, empresa, nota.id, p.campos || {})
    return { lote_id: nota.lote_id }
  },

  async competencia({ repo }, p) {
    const ids = (p.nota_ids || []).map((i) => uuid(i, 'nota_id'))
    exigir(ids.length, 'Selecione ao menos uma nota')
    const { nota, empresa } = await empresaDaNota(repo, ids[0])
    await lotes.definirCompetencia(repo, empresa, ids, p.competencia)
    return { lote_id: nota.lote_id }
  },

  async excluir({ repo }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    await lotes.excluirNota(repo, empresa, nota.id)
    return { lote_id: nota.lote_id }
  },

  async complementar({ repo }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    await lotes.confirmarComplementar(repo, empresa, nota.id)
    return { lote_id: nota.lote_id }
  },

  async liberar_duplicidade({ repo }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    await lotes.liberarDuplicidade(repo, empresa, nota.id, p.liberar !== false)
    return { lote_id: nota.lote_id }
  },

  async copiar({ repo }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    const nova = await lotes.copiarNota(repo, empresa, nota.id)
    return { lote_id: nota.lote_id, nota_id: nova }
  },

  async previa({ db, repo, usuario }, p) {
    const { empresa } = await empresaDaNota(repo, p.nota_id)
    return (await emissorDa(db, repo, empresa, usuario)).previa(p.nota_id)
  },

  async emitir({ db, repo, usuario }, p) {
    const { nota, empresa } = await empresaDaNota(repo, p.nota_id)
    exigir(p.ambiente === empresa.ambiente && p.ambiente === nota.ambiente,
      `Ambiente confirmado (${p.ambiente}) difere do configurado (${empresa.ambiente}). Nada foi enviado.`, 409)
    const resultado = await (await emissorDa(db, repo, empresa, usuario)).emitir(nota.id, { confirmarRepetida: p.confirmar_repetida === true })
    return { resultado, nota: await repo.obterNota(nota.id) }
  },

  // A NFS-e foi cancelada no portal nacional: tira do painel do cliente, dos totais e da trava de
  // duplicidade (assim a nota certa pode ser emitida de novo, se for o caso).
  async marcar_cancelada({ repo, usuario }, p) {
    const { nota } = await empresaDaNota(repo, p.nota_id)
    exigir(nota.estado === 'autorizada', 'Só nota autorizada pode ser marcada como cancelada', 409)
    const motivo = String(p.motivo || '').split(/\s+/).filter(Boolean).join(' ').slice(0, 300)
    exigir(motivo, 'Informe o motivo do cancelamento')
    try {
      await repo.mudarEstado(nota.id, 'autorizada', 'cancelada', `Cancelada no portal nacional: ${motivo}`,
        { mensagem_sefin: `Cancelada no portal nacional: ${motivo}` }, usuario.email)
    } catch (e) {
      if (/check constraint|estado_check/i.test(e.message)) {
        throw new ErroHttp(409, 'O banco ainda não aceita notas canceladas: aplique supabase-schema-nfse-cancelamento.sql no Supabase.')
      }
      throw e
    }
    return { nota: await repo.obterNota(nota.id) }
  },

  // ---------------------------------------------------------------- emissão por extrato bancário

  async extrato_analisar({ db, repo }, p) {
    const empresa = await repo.obterEmpresa(uuid(p.cliente_id, 'cliente_id'))
    exigir(empresa, 'Empresa sem configuração de NFS-e', 409)
    exigir(String(p.texto || '').trim(), 'Envie o extrato')
    const lancamentos = lerExtrato(String(p.texto).slice(0, 2000000))
    exigir(lancamentos.length, 'Não encontrei créditos no extrato. Envie o PDF do extrato de conta corrente (com data, lançamento e valor) ou o arquivo OFX.', 422)
    await deps.atualizarAdn(db, empresa)
    const [tomadores, notasGestor, notasNacionais] = await Promise.all([
      repo.listarTomadores(empresa.cliente_id),
      repo.listarNotasEmpresa(empresa.cliente_id, empresa.ambiente),
      empresa.ambiente === 'producao' ? repo.listarNotasNacionais(empresa.cliente_id) : [],
    ])
    const pessoas = montarPessoas({ tomadores, notasGestor, notasNacionais })
    return {
      lancamentos: sugerirNotas(lancamentos, pessoas),
      pessoas: pessoas.map((x) => ({ cpf: x.cpf, nome: x.nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    }
  },

  async extrato_criar_lote({ repo }, p) {
    const empresa = await repo.obterEmpresa(uuid(p.cliente_id, 'cliente_id'))
    exigir(empresa, 'Empresa sem configuração de NFS-e', 409)
    const itens = Array.isArray(p.itens) ? p.itens.slice(0, 500) : []
    exigir(itens.length, 'Marque ao menos um PIX para emitir')
    const tomadores = await repo.listarTomadores(empresa.cliente_id)
    const cpfsCadastro = new Set(tomadores.map((t) => t.cpf).filter(Boolean))
    let registros = itens.map((it) => {
      const valor = parseValor(String(it.valor ?? ''))
      exigir(valor && Number(valor) > 0, 'Valor inválido em um dos PIX')
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(String(it.data || '')), 'Data inválida em um dos PIX')
      const cpf = soDigitos(it.cpf || '')
      const reg = novoRegistro({
        origem: 'extrato', nome: String(it.nome || '').replace(/\s+/g, ' ').trim().slice(0, 150), cpf, data: it.data, valor,
        dataMensagem: `extrato ${it.data.split('-').reverse().join('/')}`,
        textoOriginal: `Extrato: ${String(it.descricao_extrato || '').slice(0, 300)} — R$ ${valor.replace('.', ',')}`,
      })
      if (!cpf) reg.avisos.push(`PIX de "${it.nome_extrato || '?'}" sem CPF: complete antes de emitir`)
      return { reg, nomeExtrato: String(it.nome_extrato || '').trim().slice(0, 60),
        salvar: it.salvar_cadastro && cpf.length === 11 && cpfValido(cpf) && reg.nome && !cpfsCadastro.has(cpf) }
    })
    // Quem não estava no cadastro e foi identificado na conferência entra nele (na próxima vez já sai sugerido)
    let salvos = 0
    // O nome como o banco mostra ("ZEZINHO") fica de apelido quando o nome completo não começa por ele
    for (const { reg, salvar, nomeExtrato } of registros) {
      if (!salvar || cpfsCadastro.has(reg.cpf)) continue
      const apelidos = nomeExtrato && !norm(reg.nome).startsWith(norm(nomeExtrato)) ? [nomeExtrato] : []
      try {
        await repo.salvarTomador(normalizarTomador({ nome: reg.nome, cpf: reg.cpf, apelidos }, empresa.cliente_id))
        cpfsCadastro.add(reg.cpf)
        salvos += 1
      } catch (e) { reg.avisos.push(`Não entrou no cadastro de clientes: ${e.message}`) }
    }
    registros = completarComCadastro(registros.map((x) => x.reg), await repo.listarTomadores(empresa.cliente_id), { descricaoPadrao: empresa.descricao_padrao || '' })
    const arquivo = String(p.arquivo || '').slice(0, 120)
    // nfse_lotes.origem ainda não tem 'extrato': o lote entra como planilha, com a descrição dizendo de onde veio
    const loteId = await lotes.criarLote(repo, { empresa, origem: 'planilha', descricao: `Extrato bancário${arquivo ? ` · ${arquivo}` : ''}`, registros })
    return { lote_id: loteId, salvos }
  },

  // ---------------------------------------------------------------- cadastro de clientes (tomadores)

  async tomador_salvar({ db, repo }, p) {
    const clienteId = await clienteExistente(db, p.cliente_id)
    return { tomador: await repo.salvarTomador(normalizarTomador(p.tomador || {}, clienteId)) }
  },

  async tomador_excluir({ db, repo }, p) {
    const clienteId = await clienteExistente(db, p.cliente_id)
    await repo.excluirTomador(uuidOuId(p.id), clienteId)
    return { ok: true }
  },

  async tomadores_importar({ db, repo }, p) {
    const clienteId = await clienteExistente(db, p.cliente_id)
    exigir(p.planilha_base64, 'Envie a planilha de clientes')
    const XLSX = require('xlsx')
    const wb = XLSX.read(Buffer.from(p.planilha_base64, 'base64'), { type: 'buffer', cellDates: true, UTC: true })
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' })
    let lidos
    try { lidos = lerPlanilhaTomadores(linhas) } catch (e) { throw new ErroHttp(400, e.message) }
    const plano = planejarImportacao(lidos, await repo.listarTomadores(clienteId))
    if (!p.gravar) return { plano }
    // Uma linha com problema não derruba as outras: o erro volta na própria linha do plano
    let gravados = 0
    for (const item of plano) {
      if (item.acao === 'conflito') continue
      const { acao, avisos, ...t } = item
      try {
        await repo.salvarTomador(normalizarTomador(t, clienteId, { aceitarCpfInvalido: true }))
        gravados += 1
      } catch (e) {
        item.acao = 'erro'
        item.avisos = [...avisos, e.message]
      }
    }
    return { plano, gravados }
  },
}

async function clienteExistente(db, id) {
  const clienteId = uuid(id, 'cliente_id')
  const { data } = await db.from('clientes').select('id').eq('id', clienteId).maybeSingle()
  exigir(data, 'Cliente não encontrado', 404)
  return clienteId
}

const uuidOuId = (v) => { exigir(/^[\w-]{1,64}$/.test(String(v || '')), 'id inválido'); return v }

// Valida e limpa um tomador vindo da tela ou da planilha.
function normalizarTomador(t, clienteId, { aceitarCpfInvalido = false } = {}) {
  const nome = String(t.nome || '').replace(/\s+/g, ' ').trim()
  exigir(nome, 'Informe o nome do cliente')
  const cpf = soDigitos(t.cpf || '')
  exigir(!cpf || cpf.length === 11, `CPF de ${nome} precisa ter 11 dígitos`)
  // Da planilha, CPF com dígito errado entra para conferência (aparece com aviso); pela tela, não
  exigir(!cpf || aceitarCpfInvalido || cpfValido(cpf), `CPF de ${nome} com dígito verificador errado`)
  const apelidos = (Array.isArray(t.apelidos) ? t.apelidos : String(t.apelidos || '').split(/[;,]/))
    .map((a) => String(a).replace(/\s+/g, ' ').trim()).filter(Boolean)
  const valor = t.valor_padrao === null || t.valor_padrao === undefined || t.valor_padrao === '' ? null : parseValor(String(t.valor_padrao))
  exigir(valor === null || Number(valor) > 0, 'Valor padrão inválido')
  const saida = {
    cliente_id: clienteId, nome, cpf: cpf || null, apelidos: [...new Set(apelidos)],
    endereco: String(t.endereco || '').trim(), cep: soDigitos(t.cep || ''), email: String(t.email || '').trim(),
    telefone: String(t.telefone || '').trim(), descricao_padrao: String(t.descricao_padrao || '').trim().slice(0, 2000),
    valor_padrao: valor, observacao: String(t.observacao || '').trim(), ativo: t.ativo !== false,
  }
  if (t.id) saida.id = uuidOuId(t.id)
  return saida
}

exports.handler = responder(async (event) => {
  if (event.httpMethod !== 'POST') throw new ErroHttp(405, 'Use POST')
  const db = deps.supabase()
  const usuario = await exigirUsuario(event, { supabase: db })
  let corpo
  try { corpo = JSON.parse(event.body || '{}') } catch { throw new ErroHttp(400, 'JSON inválido') }
  const acao = acoes[corpo.acao]
  exigir(acao, `Ação desconhecida: ${corpo.acao}`)
  const repo = new RepositorioSupabase(db)
  try {
    return await acao({ db, repo, usuario }, corpo)
  } catch (e) {
    if (e instanceof EmissaoBloqueada || e instanceof lotes.NotaNaoEditavel || e instanceof TransicaoInvalida) throw new ErroHttp(409, e.message)
    if (/^(Data|Valor|Competência) inválid/.test(e.message)) throw new ErroHttp(400, e.message)
    throw e
  }
})

exports._deps = deps // testes
exports._analisarGabarito = analisarGabarito
