// netlify/functions/lib/nfse/emissor.js
//
// Emissão de uma nota, com a máquina de estados e a regra de idempotência. Porte de app/emissor.py.
//
// validada ─reserva nDPS─▶ numero_reservado ─grava XML─▶ enviada ─POST /nfse─▶ autorizada | rejeitada | indeterminada
//
// - O nDPS é reservado e gravado ANTES de qualquer chamada HTTP; o XML assinado fica na nota e é
//   reaproveitado em qualquer reenvio (mesmo Id, mesmo dhEmi).
// - Timeout/erro de rede/5xx → indeterminada. Antes de reenviar, SEMPRE consulta GET /dps/{id}:
//   se a NFS-e existe, vira autorizada; só reenvia se a Sefin responder que não existe (E2404).

const { carregarGabarito, montarDps } = require('./dps')
const { assinar } = require('./assinatura')
const { serializar } = require('./xml')
const { ErroRede, descomprimir, ok } = require('./sefin')

const CODIGO_DPS_INEXISTENTE = 'E2404'

// Explicações mais diretas para os códigos mais comuns. O texto original da Sefin sempre aparece junto.
const EXPLICACOES = {
  E0015: 'A competência (dCompet) não pode ser posterior à data de emissão.',
  E0160: 'A opção pelo Simples Nacional na DPS não confere com o cadastro do prestador na competência.',
  E0207: 'O CPF do tomador não existe na Receita Federal.',
  E0714: 'A Sefin não validou a assinatura digital (XML alterado depois de assinado, certificado ou forma canônica divergente).',
  E2404: 'A Sefin não tem NFS-e gerada para esta DPS.',
  RNG9999: 'Erro não catalogado na Sefin (geralmente problema de formato do envio).',
}

class EmissaoBloqueada extends Error {}

// Normaliza os formatos de erro da Sefin: 'erro' (objeto) ou 'erros' (lista), chaves em qualquer caixa.
function errosDaResposta(r) {
  const item = (d) => {
    const low = Object.fromEntries(Object.entries(d).map(([k, v]) => [k.toLowerCase(), v]))
    let desc = String(low.descricao || low.mensagem || '')
    if (low.complemento) desc = `${desc} (${low.complemento})`
    return [String(low.codigo || ''), desc]
  }
  let brutos = r.dados.erros || r.dados.Erros || []
  if (!Array.isArray(brutos)) brutos = [brutos]
  const unico = r.dados.erro || r.dados.Erro
  if (unico && typeof unico === 'object') brutos = [...brutos, unico]
  let erros = brutos.filter((e) => e && typeof e === 'object').map(item)
  if (!erros.length && !ok(r)) erros = [[`HTTP ${r.status}`, String(r.texto || '').slice(0, 500)]]
  return erros
}

function mensagemErros(erros) {
  return erros.map(([codigo, desc]) => {
    const extra = EXPLICACOES[codigo]
    return `${codigo} — ${desc}${extra && !desc.includes(extra) ? ` → ${extra}` : ''}`
  }).join(' | ')
}

const numeroDaNfse = (xml) => ((xml.match(/<infNFSe\b[^>]*>[\s\S]*?<nNFSe>(\d+)<\/nNFSe>/) || [])[1]) || null

// contexto: { repo, empresa (linha de nfse_empresas), certificado (lerPfx), cliente (criarCliente), usuario }
function criarEmissor({ repo, empresa, certificado, cliente, usuario = null }) {
  const gabarito = carregarGabarito(empresa.gabarito_xml)
  const dadosEmpresa = {
    cnpj: empresa.cnpj, codigoMunicipio: empresa.codigo_municipio,
    regraCompetencia: empresa.regra_competencia, servicoPadrao: empresa.servico_padrao || {},
  }
  if (cliente.ambiente !== empresa.ambiente) throw new EmissaoBloqueada('Cliente Sefin e empresa em ambientes diferentes')

  const montar = (nota, nDps, serie) => montarDps({
    gabarito, empresa: dadosEmpresa, ambiente: empresa.ambiente, serie, nDps,
    cpfTomador: nota.cpf, nomeTomador: nota.nome, descricao: nota.descricao, valor: String(nota.valor),
    dataAtendimento: nota.data, competencia: nota.competencia || null,
  })

  // validada → numero_reservado → XML assinado gravado na nota
  async function preparar(nota) {
    if (nota.estado === 'validada') {
      // Monta antes de gastar um número da série: erro de dados aparece sem queimar numeração
      montar(nota, await repo.proximoNumero(empresa.cliente_id, empresa.ambiente, empresa.serie_dps), empresa.serie_dps)
      await repo.reservarNumero(nota.id, usuario)
      nota = await repo.obterNota(nota.id)
    }
    if (!nota.xml_enviado) {
      const dps = assinar(montar(nota, nota.n_dps, nota.serie), certificado)
      const id = dps.children[0].attrs.find(([k]) => k === 'Id')[1]
      await repo.atualizarNota(nota.id, { id_dps: id, xml_enviado: serializar(dps) })
      nota = await repo.obterNota(nota.id)
    }
    return nota
  }

  async function autorizar(nota, chave, nfseB64, detalhe) {
    if (!nfseB64) {
      try {
        const r = await cliente.consultarNfse(chave)
        nfseB64 = ok(r) ? r.dados.nfseXmlGZipB64 : null
      } catch { nfseB64 = null } // a nota existe; o XML pode ser baixado depois
    }
    const xml = nfseB64 ? descomprimir(nfseB64).toString('utf8') : null
    const numero = xml ? numeroDaNfse(xml) : null
    await repo.mudarEstado(nota.id, nota.estado, 'autorizada', detalhe,
      { chave_acesso: chave, numero_nfse: numero, xml_retorno: xml, mensagem_sefin: detalhe || null }, usuario)
    return { estado: 'autorizada', mensagem: detalhe, chave_acesso: chave, numero_nfse: numero }
  }

  // Para notas enviada/indeterminada. Devolve resultado se a situação ficou definida; null se pode reenviar.
  async function consultarAntesDeReenviar(nota) {
    let r
    try {
      r = await cliente.consultarDps(nota.id_dps)
    } catch (e) {
      if (!(e instanceof ErroRede)) throw e
      const msg = `Sem resposta da Sefin na reconsulta (${e.message}). Tente de novo.`
      if (nota.estado === 'enviada') await repo.mudarEstado(nota.id, 'enviada', 'indeterminada', msg, { mensagem_sefin: msg }, usuario)
      return { estado: 'indeterminada', mensagem: msg }
    }
    if (ok(r) && r.dados.chaveAcesso) return autorizar(nota, r.dados.chaveAcesso, null, 'NFS-e já existia (encontrada na reconsulta)')
    if (r.status === 404 && errosDaResposta(r).some(([c]) => c === CODIGO_DPS_INEXISTENTE)) return null
    const msg = `Reconsulta inconclusiva: ${mensagemErros(errosDaResposta(r))}`
    if (nota.estado === 'enviada') await repo.mudarEstado(nota.id, 'enviada', 'indeterminada', msg, { mensagem_sefin: msg }, usuario)
    else await repo.atualizarNota(nota.id, { mensagem_sefin: msg })
    return { estado: 'indeterminada', mensagem: msg }
  }

  async function emitir(notaId) {
    let nota = await repo.obterNota(notaId)
    if (!nota) throw new Error('Nota não encontrada')
    if (nota.cliente_id !== empresa.cliente_id || nota.ambiente !== empresa.ambiente) {
      throw new EmissaoBloqueada('A nota é de outra empresa ou de outro ambiente')
    }
    if (nota.estado === 'autorizada') return { estado: 'autorizada', mensagem: 'Já autorizada', chave_acesso: nota.chave_acesso, numero_nfse: nota.numero_nfse }
    if (nota.estado === 'rejeitada') throw new EmissaoBloqueada("Nota rejeitada: o número não pode ser reutilizado. Use 'copiar para corrigir'.")
    if (nota.estado === 'importada') throw new EmissaoBloqueada('Nota não está pronta para emissão')

    if (nota.estado === 'validada' || nota.estado === 'numero_reservado') {
      nota = await preparar(nota)
      await repo.mudarEstado(notaId, 'numero_reservado', 'enviada', 'primeiro envio', {}, usuario)
    } else { // enviada (function caiu no meio) ou indeterminada: consulta antes de qualquer reenvio
      const definido = await consultarAntesDeReenviar(nota)
      if (definido) return definido
      nota = await repo.obterNota(notaId)
      if (nota.estado === 'indeterminada') await repo.mudarEstado(notaId, 'indeterminada', 'enviada', 'reenvio após reconsulta (E2404)', {}, usuario)
    }
    nota = await repo.obterNota(notaId)

    let r
    try {
      r = await cliente.emitir(nota.xml_enviado)
    } catch (e) {
      if (!(e instanceof ErroRede)) throw e
      const msg = `Sem resposta da Sefin (${e.message}). A nota ficou indeterminada: consulte antes de reenviar.`
      await repo.mudarEstado(notaId, 'enviada', 'indeterminada', msg, { mensagem_sefin: msg }, usuario)
      return { estado: 'indeterminada', mensagem: msg }
    }

    if (ok(r) && r.dados.chaveAcesso) {
      const alertas = r.dados.alertas || []
      const detalhe = alertas.length ? mensagemErros(errosDaResposta({ status: 200, dados: { erros: alertas } })) : ''
      return autorizar(nota, r.dados.chaveAcesso, r.dados.nfseXmlGZipB64, detalhe)
    }
    if (r.status >= 500 || ok(r)) {
      const msg = `Resposta inesperada da Sefin: ${mensagemErros(errosDaResposta(r))}`
      await repo.mudarEstado(notaId, 'enviada', 'indeterminada', msg, { mensagem_sefin: msg }, usuario)
      return { estado: 'indeterminada', mensagem: msg }
    }
    // 4xx: confirma pela consulta que nada foi gerado antes de declarar rejeitada
    const msg = mensagemErros(errosDaResposta(r))
    try {
      const c = await cliente.consultarDps(nota.id_dps)
      if (ok(c) && c.dados.chaveAcesso) return autorizar(nota, c.dados.chaveAcesso, null, 'NFS-e já existia para esta DPS')
    } catch (e) { if (!(e instanceof ErroRede)) throw e }
    await repo.mudarEstado(notaId, 'enviada', 'rejeitada', msg, { mensagem_sefin: msg }, usuario)
    return { estado: 'rejeitada', mensagem: msg }
  }

  // DPS como seria enviada (próximo número da série), sem reservar nem gravar nada.
  async function previa(notaId) {
    const nota = await repo.obterNota(notaId)
    if (!nota) throw new Error('Nota não encontrada')
    if (nota.status_validacao !== 'pronto') throw new EmissaoBloqueada('Só dá para gerar a DPS de notas prontas')
    const numero = nota.n_dps || await repo.proximoNumero(empresa.cliente_id, empresa.ambiente, empresa.serie_dps)
    const dps = assinar(montar(nota, numero, nota.serie || empresa.serie_dps), certificado)
    return { numero_previa: numero, xml: serializar(dps) }
  }

  return { emitir, previa }
}

module.exports = { criarEmissor, EmissaoBloqueada, errosDaResposta, mensagemErros, numeroDaNfse, EXPLICACOES }
