// netlify/functions/lib/nfse/lotes.js
//
// Lotes e notas antes da emissão: criação a partir dos registros importados, edição na tela,
// competência, exclusão, cópia de rejeitada, e revalidação com checagem de duplicidade.
// Porte de app/repositorio.py (parte de lotes) do emissor local.

const { validar, chaveDuplicidade, hojeBrasilia, PRONTO } = require('./validador')
const { parseData, parseValor, soDigitos } = require('./importador')
const { EDITAVEIS, EM_EMISSAO_OU_EMITIDA } = require('./repositorio')
const { conferirDuplicidade, mensagemParecida, PREFIXO_PARECIDA } = require('./duplicidade')

class NotaNaoEditavel extends Error {}

const AVISO_OUTRO_LOTE = 'Também está no lote'

async function criarLote(repo, { empresa, origem, descricao = '', registros, hoje = hojeBrasilia(), recorrenteId = null }) {
  const loteId = await repo.inserirLote({ cliente_id: empresa.cliente_id, ambiente: empresa.ambiente, origem, descricao })
  await repo.inserirNotas(registros.map((r) => ({
    lote_id: loteId, cliente_id: empresa.cliente_id, ambiente: empresa.ambiente, avisos: r.avisos || [],
    nome: r.nome || '', cpf: r.cpf || '', endereco: r.endereco || '', cep: r.cep || '', data: r.data || null,
    valor: r.valor ?? null, descricao: r.descricao || '', autor: r.autor || '', data_mensagem: r.dataMensagem || '',
    origem: r.origem || origem, texto_original: r.textoOriginal || '', competencia: r.competencia || null,
    recorrente_id: r.recorrenteId || recorrenteId,
  })))
  await revalidarLote(repo, loteId, empresa, hoje)
  return loteId
}

// Valida todas as notas editáveis do lote e marca duplicidades (CPF + data + valor).
async function revalidarLote(repo, loteId, empresa, hoje = hojeBrasilia(), usuario = null) {
  const notas = await repo.listarNotasLote(loteId)
  const outras = await repo.listarOutrasNotas(empresa.cliente_id, empresa.ambiente, loteId)
  const emitidas = new Map()
  const emOutrosLotes = new Map()
  for (const o of outras) {
    const chave = chaveDuplicidade(o.cpf, o.data, o.valor)
    if (!chave) continue
    if (EM_EMISSAO_OU_EMITIDA.includes(o.estado)) { if (!emitidas.has(chave)) emitidas.set(chave, o) } else if (o.estado !== 'rejeitada' && !emOutrosLotes.has(chave)) emOutrosLotes.set(chave, o.lote_id)
  }
  for (const n of notas) {
    const chave = chaveDuplicidade(n.cpf, n.data, n.valor)
    if (chave && EM_EMISSAO_OU_EMITIDA.includes(n.estado) && !emitidas.has(chave)) emitidas.set(chave, n)
  }

  const vistas = new Map()
  for (const n of notas) {
    if (!EDITAVEIS.includes(n.estado)) continue
    const v = validar({ ...n, camposObrigatorios: empresa.campos_obrigatorios, hoje })
    const avisos = (n.avisos || []).filter((a) => !a.startsWith(AVISO_OUTRO_LOTE) && !a.startsWith(PREFIXO_PARECIDA))
    const chave = chaveDuplicidade(n.cpf, n.data, n.valor)
    if (chave) {
      if (emitidas.has(chave)) {
        v.erros.push(`Duplicada: já emitida/em emissão (nota de ${emitidas.get(chave).data || ''} em outro lote ou neste)`)
      } else if (vistas.has(chave)) {
        v.erros.push(`Duplicada: mesmo CPF, data e valor de outra nota deste lote (${vistas.get(chave)})`)
      } else {
        vistas.set(chave, n.nome || n.cpf)
        if (emOutrosLotes.has(chave)) avisos.push(`${AVISO_OUTRO_LOTE} outro lote ainda não emitido`)
      }
      if (v.erros.length) v.status = 'invalido'
      else {
        const { parecidas } = conferirDuplicidade(n, [...outras, ...notas], { regraCompetencia: empresa.regra_competencia, hoje })
        if (parecidas.length) avisos.push(`${mensagemParecida(n, parecidas)} Confira antes de emitir.`)
      }
    }
    const estado = v.status === PRONTO ? 'validada' : 'importada'
    const mudou = JSON.stringify([n.status_validacao, n.pendencias, n.erros, n.avisos, n.estado])
      !== JSON.stringify([v.status, v.pendencias, v.erros, avisos, estado])
    if (!mudou) continue
    if (estado !== n.estado) {
      await repo.mudarEstado(n.id, n.estado, estado, 'validação',
        { status_validacao: v.status, pendencias: v.pendencias, erros: v.erros, avisos }, usuario)
    } else {
      await repo.atualizarNota(n.id, { status_validacao: v.status, pendencias: v.pendencias, erros: v.erros, avisos })
    }
  }
}

// Competência escolhida pelo usuário: dd/mm/aaaa, mm/aaaa (vira dia 1) ou ISO. Vazio = regra da empresa.
function parseCompetencia(bruto) {
  const texto = String(bruto ?? '').trim()
  if (!texto) return null
  const m = texto.match(/^(\d{1,2})\s*\/\s*(\d{4})$/)
  if (m) {
    const mes = Number(m[1])
    if (mes >= 1 && mes <= 12) return `${m[2]}-${String(mes).padStart(2, '0')}-01`
  } else {
    const d = parseData(texto)
    if (d) return d
  }
  throw new Error(`Competência inválida: '${texto}'. Use dd/mm/aaaa ou mm/aaaa`)
}

async function notaEditavel(repo, id) {
  const nota = await repo.obterNota(id)
  if (!nota) throw new Error('Nota não encontrada')
  if (!EDITAVEIS.includes(nota.estado)) throw new NotaNaoEditavel(`Nota em estado '${nota.estado}' não pode ser alterada`)
  return nota
}

// Edição feita na tela. Aceita data dd/mm/aaaa ou ISO e valor '1.590,00'.
async function atualizarNota(repo, empresa, id, campos, hoje = hojeBrasilia()) {
  const nota = await notaEditavel(repo, id)
  const sets = {}
  for (const k of ['nome', 'endereco', 'descricao']) if (k in campos) sets[k] = String(campos[k] ?? '').split(/\s+/).filter(Boolean).join(' ')
  if ('cpf' in campos) sets.cpf = soDigitos(campos.cpf ?? '')
  if ('cep' in campos) sets.cep = soDigitos(campos.cep ?? '')
  if ('data' in campos) {
    const bruto = String(campos.data ?? '').trim()
    const d = bruto ? parseData(bruto) : null
    if (bruto && !d) throw new Error(`Data inválida: '${bruto}'. Use dd/mm/aaaa`)
    sets.data = d
  }
  if ('valor' in campos) {
    const bruto = String(campos.valor ?? '').trim()
    const v = bruto ? parseValor(bruto) : null
    if (bruto && v === null) throw new Error(`Valor inválido: '${bruto}'. Use 1.590,00`)
    sets.valor = v
  }
  if ('competencia' in campos) sets.competencia = parseCompetencia(campos.competencia)
  if (Object.keys(sets).length) await repo.atualizarNota(id, sets)
  await revalidarLote(repo, nota.lote_id, empresa, hoje)
  return repo.obterNota(id)
}

async function definirCompetencia(repo, empresa, ids, competencia, hoje = hojeBrasilia()) {
  const valor = parseCompetencia(competencia)
  const lotes = new Set()
  for (const id of ids) {
    const nota = await notaEditavel(repo, id)
    await repo.atualizarNota(id, { competencia: valor })
    lotes.add(nota.lote_id)
  }
  for (const l of lotes) await revalidarLote(repo, l, empresa, hoje)
}

async function excluirNota(repo, empresa, id, hoje = hojeBrasilia()) {
  const nota = await notaEditavel(repo, id)
  await repo.excluirNota(id)
  await revalidarLote(repo, nota.lote_id, empresa, hoje)
}

// Nota rejeitada não pode ser corrigida (o nDPS já foi usado). Cria uma cópia editável no mesmo lote.
async function copiarNota(repo, empresa, id, hoje = hojeBrasilia()) {
  const nota = await repo.obterNota(id)
  if (!nota) throw new Error('Nota não encontrada')
  if (nota.estado !== 'rejeitada') throw new NotaNaoEditavel('Só notas rejeitadas podem ser copiadas para correção')
  if (nota.copiada_para) throw new NotaNaoEditavel('Esta nota já foi copiada')
  const [nova] = await repo.inserirNotas([{
    lote_id: nota.lote_id, cliente_id: nota.cliente_id, ambiente: nota.ambiente,
    avisos: [`Cópia de nota rejeitada (${nota.mensagem_sefin || 'sem detalhe'})`],
    nome: nota.nome, cpf: nota.cpf, endereco: nota.endereco, cep: nota.cep, data: nota.data, valor: nota.valor,
    descricao: nota.descricao, autor: nota.autor, data_mensagem: nota.data_mensagem, origem: nota.origem,
    texto_original: nota.texto_original, competencia: nota.competencia, recorrente_id: nota.recorrente_id,
  }])
  await repo.atualizarNota(id, { copiada_para: nova.id })
  await revalidarLote(repo, nota.lote_id, empresa, hoje)
  return nova.id
}

// Totais do lote: notas rejeitadas e refeitas em cópia não contam duas vezes.
function totais(notas) {
  let servico = 0n
  let emitido = 0n
  const cent = (v) => BigInt(Math.round(Number(v) * 100))
  for (const n of notas) {
    if (n.copiada_para || n.estado === 'cancelada' || n.valor === null || n.valor === undefined) continue
    servico += cent(n.valor)
    if (n.estado === 'autorizada') emitido += cent(n.valor)
  }
  const fmt = (c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`
  return { servico: fmt(servico), emitido: fmt(emitido), faltando: fmt(servico - emitido) }
}

module.exports = {
  NotaNaoEditavel, criarLote, revalidarLote, atualizarNota, definirCompetencia, excluirNota, copiarNota,
  parseCompetencia, totais,
}
