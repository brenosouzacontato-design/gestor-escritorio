// netlify/functions/lib/nfse/duplicidade.js
//
// Trava contra NFS-e repetida, conferida na hora de emitir (não só na importação):
//   - igual:    mesmo CPF, mesma data de atendimento e mesmo valor de uma nota já emitida ou em
//               emissão → bloqueia, nada é enviado;
//   - parecida: mesmo CPF e mesmo valor, com data ou competência no mesmo mês → só emite com
//               confirmação explícita (pode ser outra sessão legítima do mesmo paciente).
// Nota cancelada não conta: depois de cancelar no portal, pode emitir de novo.

const { EM_EMISSAO_OU_EMITIDA } = require('./repositorio')

const mes = (iso) => (iso ? String(iso).slice(0, 7) : null)
const centavos = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100))
const dataBR = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/')
const mesBR = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`
const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Meses que a nota "ocupa": o do atendimento e o da competência. Sem competência gravada e com a
// regra "mês da emissão", a competência é o mês em que foi (ou será) emitida.
function mesesDa(nota, { regraCompetencia, hoje }, emitida) {
  const meses = new Set([mes(nota.data), mes(nota.competencia)])
  if (!nota.competencia && regraCompetencia === 'mes_da_emissao') meses.add(mes(emitida ? nota.atualizado_em : hoje))
  meses.delete(null)
  return meses
}

// nota: a que vai ser emitida; outras: notas do mesmo prestador/ambiente com o mesmo CPF
function conferirDuplicidade(nota, outras, contexto) {
  const vazio = { iguais: [], parecidas: [] }
  if (!nota.cpf || centavos(nota.valor) === null) return vazio
  const meus = mesesDa(nota, contexto, false)
  const iguais = []
  const parecidas = []
  for (const o of outras) {
    if (o.id === nota.id || o.cpf !== nota.cpf || !EM_EMISSAO_OU_EMITIDA.includes(o.estado)) continue
    if (centavos(o.valor) !== centavos(nota.valor)) continue
    if (nota.data && o.data === nota.data) { iguais.push(o); continue }
    const deles = mesesDa(o, contexto, true)
    if ([...meus].some((m) => deles.has(m))) parecidas.push({ ...o, mesComum: [...meus].find((m) => deles.has(m)) })
  }
  return { iguais, parecidas }
}

const descrever = (o) => `${o.numero_nfse ? `NFS-e nº ${o.numero_nfse}` : 'nota em emissão'}`
  + `${o.data ? ` (atendimento ${dataBR(o.data)})` : ''} de ${reais(o.valor)}`

function mensagemIgual(nota, iguais) {
  return `Nota repetida: ${nota.nome || 'este CPF'} já tem ${iguais.map(descrever).join(', ')} com a mesma data e valor. `
    + 'Nada foi enviado. Se a anterior foi cancelada no portal, marque-a como cancelada antes.'
}

const PREFIXO_PARECIDA = 'Possível nota repetida:'

function mensagemParecida(nota, parecidas) {
  return `${PREFIXO_PARECIDA} ${nota.nome || 'este CPF'} já tem ${parecidas.map((o) => `${descrever(o)} em ${mesBR(o.mesComum)}`).join(', ')}.`
}

// ---------------------------------------------------------------- já emitida / complementar
// Na validação do lote (antes de emitir), além de CPF + data + valor:
//   - nota do gestor com o mesmo CPF e a mesma data, mas outro valor → "Complementar?";
//   - nota do Ambiente Nacional emitida FORA do gestor (sem data de atendimento) para o mesmo CPF,
//     emitida depois do atendimento: mesmo valor → "Já emitida"; outro valor → "Complementar?".
// As duas travam a emissão. Descrição começando com "Complementar" libera (é a nota da diferença).

const PREFIXO_JA_EMITIDA = 'Já emitida:'
const PREFIXO_COMPLEMENTAR = 'Complementar?'
const ehComplementar = (descricao) => /^\s*complement/i.test(descricao || '')
const soDigitos = (v) => String(v || '').replace(/\D/g, '')

function descreverAnterior(o) {
  const quando = o.data ? `atendimento ${dataBR(o.data)}` : `emitida em ${dataBR(o.emitida_em)} fora do gestor`
  return `NFS-e nº ${o.numero_nfse || '?'} de ${reais(o.valor)} (${quando})`
}

// nota: editável do lote; doGestor: notas do gestor (outros lotes e este); nacionais: nfse_adn_notas
// já sem as que saíram do gestor. Devolve a mensagem de erro ou null.
function conferirJaEmitida(nota, doGestor, nacionais) {
  if (!nota.cpf || centavos(nota.valor) === null || ehComplementar(nota.descricao)) return null
  const candidatas = [
    ...doGestor.filter((o) => o.id !== nota.id && o.cpf === nota.cpf && nota.data && o.data === nota.data
      && EM_EMISSAO_OU_EMITIDA.includes(o.estado)),
    ...nacionais.filter((x) => soDigitos(x.tomador_doc) === nota.cpf
      && (!nota.data || String(x.emitida_em || '').slice(0, 10) >= nota.data)),
  ]
  if (!candidatas.length) return null
  const igual = candidatas.find((o) => centavos(o.valor) === centavos(nota.valor))
  if (igual) return `${PREFIXO_JA_EMITIDA} ${descreverAnterior(igual)}. Remova do lote se for o mesmo atendimento.`
  const emitido = candidatas.reduce((s, o) => s + centavos(o.valor), 0)
  const falta = centavos(nota.valor) - emitido
  const ja = `${PREFIXO_COMPLEMENTAR} ${nota.nome || 'Este CPF'} já tem ${candidatas.map(descreverAnterior).join(', ')}.`
  if (falta <= 0) return `${ja} O valor já emitido cobre este. Confira com a empresa antes de emitir.`
  return `${ja} Se faltar só a diferença, mude o valor para ${reais(falta / 100)} e comece a descrição com "Complementar".`
}

module.exports = { conferirDuplicidade, mensagemIgual, mensagemParecida, PREFIXO_PARECIDA,
  conferirJaEmitida, PREFIXO_JA_EMITIDA, PREFIXO_COMPLEMENTAR }
