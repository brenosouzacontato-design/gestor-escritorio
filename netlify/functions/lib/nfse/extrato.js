// netlify/functions/lib/nfse/extrato.js
//
// Emissão a partir do extrato bancário: cada PIX recebido vira uma sugestão de NFS-e.
//
// 1. lerExtrato(texto)  → lançamentos de crédito do extrato (texto do PDF já em linhas, ou OFX)
//      Itaú (PDF):  "05/10/2026 PIX TRANSF FELIPE 03/10 770,00"  (nome cortado em 7 letras + data do PIX)
//      Genérico:    "dd/mm/aaaa <descrição> <valor>" com valor negativo = saída (ignorada)
//      OFX:         <STMTTRN> com TRNAMT > 0
// 2. sugerirNotas(lancamentos, pessoas) → para cada PIX, quem pagou (pelo começo do nome, no cadastro
//      de clientes e nas notas já emitidas), CPF, e se já existe nota para aquele PIX.
//
// Regra de ouro (a mesma do importador): sem certeza, não escolhe. Nome cortado que serve para
// mais de uma pessoa vira lista para escolher; nada é emitido sem conferência na tela.

const { semAcento, parseValor, montarData } = require('./importador')

// Créditos que não são pagamento de cliente (aparecem na lista, desmarcados)
const NAO_RECEITA = /\b(REND|RENDIMENTO|DIVIDENDO|JCP|JUROS|APLIC|RESGATE|ESTORNO|DEVOL|SALDO|CASHBACK)\b/
const PIX = /\bPIX\b/
// Palavras do banco antes do nome de quem pagou
const PREFIXOS_PIX = /^(?:(?:PIX|TRANSF|TRANSFERENCIA|TED|DOC|RECEBIDO|RECEBIDA|RECEB|REC|QRS|QR|CRED|CREDITO|DE|PELO|ENTRADA)[\s.:\-]+)+/

const norm = (t) => semAcento(String(t || '')).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const centavos = (v) => Math.round(Number(v) * 100)

// ------------------------------------------------------------------------------- leitura

// "PIX TRANSF MARIA A01/10" → { nome: 'MARIA A', diaMes: '01/10' }
// "Transferência recebida pelo Pix - FULANO DE TAL - •••.123.456-•• - BANCO" → nome 'FULANO DE TAL'
function nomeDoPagador(descricao) {
  let d = String(descricao || '').trim()
  let diaMes = null
  const fim = d.match(/(\d{2})\/(\d{2})\s*$/)
  if (fim) { diaMes = `${fim[1]}/${fim[2]}`; d = d.slice(0, fim.index) }
  if (d.includes(' - ')) {
    const partes = d.split(' - ').map((s) => s.trim())
    const nome = partes.slice(1).find((p) => /[A-Za-zÀ-ÿ]{2,}/.test(p) && !/\d{3}/.test(p))
    if (nome) return { nome: norm(nome), diaMes, cortado: false }
  }
  const nome = norm(d).replace(PREFIXOS_PIX, '').trim()
  return { nome, diaMes, cortado: true }
}

const LINHA = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?\s?\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+-?\d{1,3}(?:\.\d{3})*,\d{2})?\s*(-)?$/

// Data do PIX ("03/10") no ano do lançamento; PIX de dezembro lançado em janeiro fica no ano anterior.
function dataDoPix(diaMes, dataLancamento) {
  if (!diaMes) return dataLancamento
  const [dia, mes] = diaMes.split('/')
  let ano = Number(dataLancamento.slice(0, 4))
  if (Number(mes) > Number(dataLancamento.slice(5, 7)) + 1) ano -= 1
  return montarData(dia, mes, String(ano)) || dataLancamento
}

function lancamento({ data, descricao, valor, origem }) {
  const desc = descricao.replace(/\s+/g, ' ').trim()
  const n = norm(desc)
  const tipo = PIX.test(n) && !NAO_RECEITA.test(n) ? 'pix' : 'outro'
  const pagador = nomeDoPagador(desc)
  return {
    data, descricao: desc, valor, tipo, origem,
    nomeExtrato: tipo === 'pix' || pagador.nome ? pagador.nome : '',
    cortado: pagador.cortado,
    dataPix: dataDoPix(pagador.diaMes, data),
    receita: tipo === 'pix' || (!NAO_RECEITA.test(n) && /\b(TED|DOC|TRANSF|DEP|DEPOSITO)\b/.test(n)),
  }
}

function lerOfx(texto) {
  const saida = []
  for (const bloco of texto.split(/<STMTTRN>/i).slice(1)) {
    const campo = (nome) => ((bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i')) || [])[1] || '').trim()
    const valor = Number(campo('TRNAMT').replace(',', '.'))
    if (!(valor > 0)) continue
    const dt = campo('DTPOSTED')
    const data = montarData(dt.slice(6, 8), dt.slice(4, 6), dt.slice(0, 4))
    if (!data) continue
    const descricao = [campo('NAME'), campo('MEMO')].filter(Boolean).join(' - ') || 'Crédito'
    saida.push(lancamento({ data, descricao, valor: valor.toFixed(2), origem: 'ofx' }))
  }
  return saida
}

// texto: linhas do PDF (uma por linha) ou o arquivo OFX. Devolve só os créditos, em ordem.
function lerExtrato(texto) {
  const t = String(texto || '')
  if (/<OFX>|<STMTTRN>/i.test(t)) return lerOfx(t)
  const saida = []
  for (const bruta of t.split(/\r?\n/)) {
    const linha = bruta.replace(/\s+/g, ' ').trim()
    const m = linha.match(LINHA)
    if (!m) continue
    const descricao = m[4]
    if (/^SALDO\b/i.test(norm(descricao))) continue
    const bruto = m[5].replace(/\s/g, '')
    if (bruto.startsWith('-') || m[6]) continue // saída
    const data = montarData(m[1], m[2], m[3])
    const valor = parseValor(bruto)
    if (!data || !valor || Number(valor) <= 0) continue
    saida.push(lancamento({ data, descricao, valor, origem: 'pdf' }))
  }
  return saida
}

// ------------------------------------------------------------------------------- sugestão

// Pessoas conhecidas da empresa, por CPF: cadastro de clientes + notas já emitidas (gestor e
// Ambiente Nacional). Cada uma com os nomes que já usou e os valores das notas.
function montarPessoas({ tomadores = [], notasGestor = [], notasNacionais = [] }) {
  const porCpf = new Map()
  const pessoa = (cpf, nome) => {
    if (!cpf || cpf.length !== 11) return null
    if (!porCpf.has(cpf)) porCpf.set(cpf, { cpf, nome: nome || '', nomes: new Set(), notas: [] })
    const p = porCpf.get(cpf)
    if (nome) { p.nomes.add(norm(nome)); if (!p.nome) p.nome = nome }
    return p
  }
  for (const t of tomadores) {
    if (t.ativo === false) continue
    const p = pessoa(t.cpf, t.nome)
    if (!p) continue
    p.nome = t.nome
    p.tomadorId = t.id
    for (const a of t.apelidos || []) p.nomes.add(norm(a))
  }
  for (const n of notasGestor) {
    if (!['autorizada', 'numero_reservado', 'enviada', 'indeterminada'].includes(n.estado)) continue
    const p = pessoa(n.cpf, n.nome)
    if (p) p.notas.push({ valor: n.valor, data: n.data || n.competencia, numero: n.numero_nfse, chave: n.chave_acesso })
  }
  for (const n of notasNacionais) {
    const p = pessoa(String(n.tomador_doc || '').replace(/\D/g, ''), n.tomador_nome)
    // a mesma nota pode estar no gestor e no Ambiente Nacional: conta uma vez
    if (p && !p.notas.some((x) => x.chave && x.chave === n.chave_acesso)) {
      p.notas.push({ valor: n.valor, data: n.competencia || String(n.emitida_em || '').slice(0, 10), numero: n.numero_nfse, chave: n.chave_acesso })
    }
  }
  return [...porCpf.values()]
}

// O nome do extrato é o começo do nome da pessoa? O Itaú corta em 7 caracteres: "MARIA A" serve
// para "MARIA APARECIDA"; "THOMAZ" (6 letras + espaço cortado) só para quem se chama THOMAZ.
function comecaCom(nomePessoa, nomeExtrato, cortado) {
  if (!nomeExtrato) return false
  if (!cortado) return nomePessoa === nomeExtrato || nomePessoa.startsWith(`${nomeExtrato} `)
  if (nomeExtrato.length >= 7 || nomeExtrato.includes(' ')) return nomePessoa.startsWith(nomeExtrato)
  return nomePessoa === nomeExtrato || nomePessoa.startsWith(`${nomeExtrato} `)
}

const resumoPessoa = (p) => ({ cpf: p.cpf, nome: p.nome, tomadorId: p.tomadorId || null, notas: p.notas.length })

// lancamentos: de lerExtrato; pessoas: de montarPessoas. Devolve cada lançamento com:
//   situacao: 'identificado' | 'provavel' | 'escolher' | 'sem_cadastro' | 'ja_tem_nota' | 'nao_receita'
//   sugerido: { cpf, nome } | null, candidatos: [...], motivo (texto para a tela), emitir (marcado?)
function sugerirNotas(lancamentos, pessoas) {
  const sugestoes = lancamentos.map((l, i) => {
    const base = { id: i + 1, ...l, sugerido: null, candidatos: [], motivo: '', emitir: false }
    if (!l.receita) return { ...base, situacao: 'nao_receita', motivo: 'Não é pagamento de cliente (rendimento, dividendo...)' }
    const achados = pessoas.filter((p) => [...p.nomes].some((n) => comecaCom(n, l.nomeExtrato, l.cortado)))
    if (achados.length === 1) {
      return { ...base, situacao: 'identificado', sugerido: resumoPessoa(achados[0]), emitir: true, motivo: `"${l.nomeExtrato}" é ${achados[0].nome}` }
    }
    if (achados.length > 1) {
      const mesmoValor = achados.filter((p) => p.notas.some((n) => centavos(n.valor) === centavos(l.valor)))
      const ordenados = [...mesmoValor, ...achados.filter((p) => !mesmoValor.includes(p))].map(resumoPessoa)
      if (mesmoValor.length === 1) {
        return { ...base, situacao: 'provavel', sugerido: resumoPessoa(mesmoValor[0]), candidatos: ordenados, emitir: true,
          motivo: `"${l.nomeExtrato}" serve para ${achados.length} pessoas; ${mesmoValor[0].nome} já teve nota de ${reais(l.valor)}` }
      }
      return { ...base, situacao: 'escolher', candidatos: ordenados, motivo: `"${l.nomeExtrato}" serve para ${achados.length} pessoas: escolha quem pagou` }
    }
    return { ...base, situacao: 'sem_cadastro', motivo: l.nomeExtrato ? `Ninguém no cadastro começa com "${l.nomeExtrato}"` : 'Extrato sem o nome de quem pagou' }
  })
  return marcarJaEmitidas(sugestoes, pessoas)
}

const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mes = (iso) => String(iso || '').slice(0, 7)

// PIX que já tem nota: mesma pessoa, mesmo valor, nota do mesmo mês. Quem paga toda semana o mesmo
// valor tem vários PIX no mês: cada nota "cobre" um PIX (os primeiros), o resto fica para emitir.
function marcarJaEmitidas(sugestoes, pessoas) {
  const porCpf = new Map(pessoas.map((p) => [p.cpf, p]))
  const usadas = new Map() // `${cpf}|${mes}|${centavos}` → quantas notas já usadas
  for (const s of [...sugestoes].sort((a, b) => a.dataPix.localeCompare(b.dataPix))) {
    const cpf = s.sugerido?.cpf
    if (!cpf) continue
    const chave = `${cpf}|${mes(s.dataPix)}|${centavos(s.valor)}`
    const notas = (porCpf.get(cpf)?.notas || []).filter((n) => mes(n.data) === mes(s.dataPix) && centavos(n.valor) === centavos(s.valor))
    const ja = usadas.get(chave) || 0
    if (ja < notas.length) {
      usadas.set(chave, ja + 1)
      const n = notas[ja]
      s.situacao = 'ja_tem_nota'
      s.emitir = false
      s.motivo = `Já tem NFS-e${n.numero ? ` nº ${n.numero}` : ''} de ${reais(n.valor)} em ${mes(n.data).split('-').reverse().join('/')}`
    }
  }
  return sugestoes
}

// ------------------------------------------------------------------------------- guardados
//
// Os créditos do extrato ficam em nfse_extrato_lancamentos (supabase-schema-nfse-extrato.sql) com o
// que foi feito com cada um: pendente, em_lote, ja_tem_nota ou ignorado. Sem a tabela, a análise
// funciona igual, só não guarda (guardarLancamentos devolve null).

class SemTabelaExtrato extends Error {}
const AVISO_SEM_TABELA = 'Os lançamentos não ficaram guardados: falta rodar supabase-schema-nfse-extrato.sql no SQL Editor do Supabase.'
const semTabela = (error) => error && /nfse_extrato_lancamentos|42P01|does not exist|schema cache/i.test(`${error.code || ''} ${error.message || ''}`)
function checar(error) {
  if (!error) return
  if (semTabela(error)) throw new SemTabelaExtrato(AVISO_SEM_TABELA)
  throw new Error(error.message)
}

// Mesma linha repetida no mesmo dia (dois PIX iguais) ganha ordem 1, 2...: enviar o extrato de novo
// não duplica e não junta os dois.
function numerar(lancamentos) {
  const vistos = new Map()
  return lancamentos.map((l) => {
    const base = `${l.data}|${norm(l.descricao)}|${Number(l.valor).toFixed(2)}`
    const ordem = (vistos.get(base) || 0) + 1
    vistos.set(base, ordem)
    return { ...l, chave: `${base}|${ordem}` }
  })
}

const MOTIVO_AUTOMATICO = 'Rendimento, dividendo ou estorno (marcado sozinho)'

// Grava os que ainda não existem e devolve todos (os de antes com o que já foi feito com eles).
async function guardarLancamentos(db, clienteId, lancamentos, arquivo) {
  const numerados = numerar(lancamentos)
  const { data: existentes, error } = await db.from('nfse_extrato_lancamentos').select('*').eq('cliente_id', clienteId)
    .in('chave', numerados.map((l) => l.chave))
  checar(error)
  const porChave = new Map((existentes || []).map((r) => [r.chave, r]))
  const novos = numerados.filter((l) => !porChave.has(l.chave)).map((l) => ({
    cliente_id: clienteId, chave: l.chave, data: l.data, data_pix: l.dataPix, descricao: l.descricao, valor: l.valor, arquivo: arquivo || null, situacao: 'pendente',
    ...(l.receita ? {} : { situacao: 'ignorado', motivo: MOTIVO_AUTOMATICO, tratado_em: new Date().toISOString() }),
  }))
  if (novos.length) {
    const { data: gravados, error: e2 } = await db.from('nfse_extrato_lancamentos').insert(novos).select('*')
    checar(e2)
    for (const r of gravados || []) porChave.set(r.chave, r)
  }
  return numerados.map((l) => ({ ...l, guardado: porChave.get(l.chave) || null }))
}

// Lançamento guardado → o mesmo formato de lerExtrato (para sugerir de novo com o cadastro de hoje)
function deGuardado(r) {
  const l = lancamento({ data: String(r.data).slice(0, 10), descricao: r.descricao, valor: Number(r.valor).toFixed(2), origem: 'guardado' })
  return { ...l, dataPix: r.data_pix ? String(r.data_pix).slice(0, 10) : l.dataPix, chave: r.chave, guardado: r }
}

async function listarGuardados(db, clienteId, situacoes = ['pendente']) {
  const { data, error } = await db.from('nfse_extrato_lancamentos').select('*').eq('cliente_id', clienteId).in('situacao', situacoes).order('data')
  checar(error)
  return (data || []).sort((a, b) => String(a.data).localeCompare(String(b.data))).map(deGuardado)
}

async function marcarGuardados(db, clienteId, ids, campos) {
  if (!ids.length) return
  const { error } = await db.from('nfse_extrato_lancamentos')
    .update({ ...campos, tratado_em: campos.situacao === 'pendente' ? null : new Date().toISOString() })
    .eq('cliente_id', clienteId).in('id', ids)
  checar(error)
}

module.exports = {
  lerExtrato, nomeDoPagador, montarPessoas, sugerirNotas, comecaCom, norm, numerar,
  guardarLancamentos, listarGuardados, marcarGuardados, SemTabelaExtrato, AVISO_SEM_TABELA, MOTIVO_AUTOMATICO,
}
