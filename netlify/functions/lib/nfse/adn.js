// netlify/functions/lib/nfse/adn.js
//
// Todas as NFS-e emitidas por uma empresa, inclusive as que não saíram do gestor (Emissor Nacional,
// outro sistema, notas antigas), pela distribuição do Ambiente de Dados Nacional:
//   GET https://adn.nfse.gov.br/contribuintes/DFe/{NSU}?lote=true  (TLS mútuo com o A1 da empresa)
// Com lote=true, cada chamada devolve até 50 documentos a partir do NSU informado (NFS-e e eventos em
// que o dono do certificado é emitente, tomador ou intermediário), cada um em gzip + base64. Sem
// lote=true o ADN devolve um documento só, e a leitura andava de um em um (as notas novas não
// apareciam no link). O NSU pedido pode voltar repetido: documento com NSU já lido é ignorado.
//   200 { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU, ChaveAcesso,
//         TipoDocumento: 'NFSE' | 'EVENTO' | ..., ArquivoXml, DataHoraGeracao }] }
//   404 quando não há documento novo (NENHUM_DOCUMENTO_LOCALIZADO)
// Conferido em produção em 27/10/2026 com o A1 da Simple Care: 135 documentos desde 2023
// (28 emitidas por ela, 107 em que ela é tomadora).
//
// Guardamos só as notas em que a empresa é a EMITENTE (nfse_adn_notas) e o último NSU lido
// (nfse_adn_controle), para a próxima leitura continuar de onde parou. Eventos de cancelamento e
// substituição marcam a nota.

const https = require('https')
const zlib = require('zlib')
const { lerElemento, filho } = require('./xml')

const URL_ADN = 'https://adn.nfse.gov.br/contribuintes'
const TAMANHO_LOTE = 50

// Eventos que tiram a validade da nota (Anexo II, leiaute de eventos)
const EVENTOS_SITUACAO = {
  101101: 'cancelada', // cancelamento pelo emitente
  105102: 'substituida', // cancelamento por substituição
  105104: 'cancelada', // cancelamento deferido por análise fiscal
  305101: 'cancelada', // cancelamento de ofício
}

class ErroAdn extends Error {}

// tls: { key, cert } em PEM (de certificado.lerPfx). `transporte` só nos testes: (nsu) → { status, dados }
function criarClienteAdn({ tls, timeoutMs = 15000, transporte = null }) {
  const agent = transporte ? null : new https.Agent({ key: tls.key, cert: tls.cert, keepAlive: true })
  function lote(nsu) {
    if (transporte) return transporte(nsu)
    return new Promise((resolve, reject) => {
      const req = https.request(`${URL_ADN}/DFe/${nsu}?lote=true`, { method: 'GET', agent, headers: { Accept: 'application/json' } }, (res) => {
        const partes = []
        res.on('data', (p) => partes.push(p))
        res.on('end', () => {
          let dados = {}
          try { dados = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') } catch { dados = {} }
          resolve({ status: res.statusCode, dados })
        })
        res.on('error', (e) => reject(new ErroAdn(`${e.code || e.name}: ${e.message}`)))
      })
      req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })))
      req.on('error', (e) => reject(new ErroAdn(`Falha ao falar com o Ambiente Nacional (${e.code || e.message})`)))
      req.end()
    })
  }
  return { lote }
}

const texto = (no, caminho) => {
  const n = no && filho(no, caminho)
  return n && n.text.trim() ? n.text.trim() : ''
}
const docDe = (no) => texto(no, 'CNPJ') || texto(no, 'CPF') || texto(no, 'NIF')
const numero = (v) => (v === '' ? null : Number(v))

// Resumo de uma NFS-e para a lista (o XML inteiro fica guardado para o PDF e o download)
function resumirNfse(xml) {
  const raiz = lerElemento(xml, 'NFSe')
  const inf = filho(raiz, 'infNFSe')
  const infDPS = inf && filho(inf, 'DPS/infDPS')
  if (!inf || !infDPS) throw new Error('XML sem infNFSe/DPS')
  const id = (inf.attrs.find(([n]) => n === 'Id') || [])[1] || ''
  const toma = filho(infDPS, 'toma')
  const vLiq = texto(inf, 'valores/vLiq')
  return {
    chave_acesso: id.replace(/^NFS/, ''),
    emitente_doc: docDe(filho(inf, 'emit')) || docDe(filho(infDPS, 'prest')),
    numero_nfse: texto(inf, 'nNFSe') || null,
    competencia: texto(infDPS, 'dCompet') || null,
    emitida_em: texto(inf, 'dhProc') || null,
    tomador_nome: texto(toma, 'xNome') || null,
    tomador_doc: docDe(toma) || null,
    valor: numero(texto(infDPS, 'valores/vServPrest/vServ') || vLiq),
    valor_liquido: numero(vLiq),
    descricao: texto(infDPS, 'serv/cServ/xDescServ') || null,
    ambiente: texto(infDPS, 'tpAmb') === '2' ? 'homologacao' : 'producao',
  }
}

// Evento: chave da nota e código do evento (eNNNNNN dentro do pedido)
function lerEvento(xml) {
  const chave = (/<chNFSe>(\d{50})<\/chNFSe>/.exec(xml) || [])[1]
  const codigo = (/<e(\d{6})[\s>]/.exec(xml) || [])[1]
  return chave && codigo ? { chave, codigo: Number(codigo) } : null
}

const descompactar = (b64) => zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')

// Lê os documentos novos de uma empresa e grava. Para antes de `prazoMs` (a function do Netlify
// tem 10 s) e continua na próxima chamada a partir do último NSU gravado. `sincronizado_em` só
// muda quando a leitura chega ao fim: leitura parcial ou com erro é retomada na próxima abertura.
// Devolve { novas, eventos, nsu, completo }.
async function sincronizar({ db, clienteId, cnpj, cliente, prazoMs = 6000, agora = Date.now }) {
  const inicio = agora()
  const { data: controle, error: errControle } = await db.from('nfse_adn_controle').select('ultimo_nsu').eq('cliente_id', clienteId).maybeSingle()
  if (errControle) throw new Error(errControle.message)
  let nsu = Number(controle?.ultimo_nsu || 0)
  let novas = 0
  let eventos = 0
  let completo = false

  const gravarControle = async (extra = {}) => {
    const { error } = await db.from('nfse_adn_controle').upsert(
      { cliente_id: clienteId, ultimo_nsu: nsu, ultimo_erro: null, ...(completo ? { sincronizado_em: new Date(agora()).toISOString() } : {}), ...extra },
      { onConflict: 'cliente_id' })
    if (error) throw new Error(error.message)
  }

  try {
    while (agora() - inicio < prazoMs) {
      const r = await cliente.lote(nsu)
      if (r.status === 404 || (r.status === 200 && !(r.dados.LoteDFe || []).length)) { completo = true; break }
      if (r.status !== 200) {
        const erro = (r.dados.Erros || [])[0]
        throw new ErroAdn(`Ambiente Nacional respondeu ${r.status}${erro ? `: ${erro.Descricao || erro.descricao || JSON.stringify(erro)}` : ''}`)
      }
      const lote = r.dados.LoteDFe
      const novosDocs = lote.filter((d) => Number(d.NSU) > nsu).sort((a, b) => Number(a.NSU) - Number(b.NSU))
      if (!novosDocs.length) { completo = true; break } // só voltou o NSU já lido
      for (const doc of novosDocs) {
        const xml = descompactar(doc.ArquivoXml)
        if (String(doc.TipoDocumento).toUpperCase() === 'NFSE') {
          const nota = resumirNfse(xml)
          if (nota.emitente_doc === cnpj) {
            const { error } = await db.from('nfse_adn_notas').upsert(
              { cliente_id: clienteId, nsu: Number(doc.NSU), ...nota, xml }, { onConflict: 'chave_acesso' })
            if (error) throw new Error(error.message)
            novas++
          }
        } else {
          const ev = lerEvento(xml)
          const situacao = ev && EVENTOS_SITUACAO[ev.codigo]
          if (situacao) {
            const { error } = await db.from('nfse_adn_notas').update({ situacao }).eq('chave_acesso', ev.chave).eq('cliente_id', clienteId)
            if (error) throw new Error(error.message)
            eventos++
          }
        }
        nsu = Math.max(nsu, Number(doc.NSU))
      }
      if (lote.length < TAMANHO_LOTE) { completo = true; break }
      await gravarControle() // a cada lote: se a próxima chamada falhar, não relê o que já gravou
    }
    await gravarControle()
  } catch (e) {
    await gravarControle({ ultimo_erro: e.message.slice(0, 500) }).catch(() => {})
    throw e
  }
  return { novas, eventos, nsu, completo }
}

module.exports = { criarClienteAdn, sincronizar, resumirNfse, lerEvento, EVENTOS_SITUACAO, ErroAdn, URL_ADN }
