// netlify/functions/lib/nfse/recorrentes.js
//
// Notas recorrentes: o mesmo tomador, a mesma descrição e o mesmo serviço todo período; só o valor
// muda. Ex.: lanchonete que é ponto de coleta e emite toda semana para a Shopee (tomador CNPJ).
//
// Semanal: semana de segunda a domingo. Cada semana, inclusive a que está em andamento, aparece "a
// emitir" até ter nota; o escritório confere (e, se precisar, ajusta tomador, descrição e data só
// daquela nota), digita o valor e a nota é emitida na hora (ação recorrente_emitir em nfse.js).
// Data do atendimento: o domingo da semana, ou hoje se a semana ainda não acabou; pode ser qualquer
// dia da semana até hoje. A nota pertence à semana em que cai a data. Na descrição, {inicio} e {fim}
// viram as datas da semana.
// Mensal: o mês do dia 1º ao último dia, com as mesmas regras (o mês em andamento já aparece; data
// padrão: o último dia do mês, ou hoje se o mês não acabou). Ex.: contrato de engenharia faturado
// todo mês para o mesmo tomador. Na descrição, {mes} vira MM/AAAA.
// Os períodos são identificados pelo primeiro dia (segunda-feira ou dia 1º); a API chama de "semana"
// por compatibilidade.
// Tabela nfse_recorrentes (supabase-schema-nfse.sql + supabase-schema-nfse-recorrentes-semanal.sql);
// a coluna cpf guarda CPF (11) ou CNPJ (14) do tomador.

const { cpfValido, cnpjValido } = require('./validador')

const FEITAS = ['numero_reservado', 'enviada', 'autorizada', 'indeterminada']
const ABERTAS = ['importada', 'validada']
const LIMITE_SEMANAS = 26
const LIMITE_MESES = 12
const PERIODICIDADES = ['semanal', 'mensal']
const DESCRICAO_PADRAO = 'Serviços prestados no período de {inicio} a {fim}'

const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
// Segunda-feira da semana da data
const segundaDa = (iso) => somarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))
const dataBR = (iso) => iso.split('-').reverse().join('/')

// Primeiro dia do mês da data e último dia do mês
const primeiroDoMes = (iso) => `${iso.slice(0, 7)}-01`
const ultimoDoMes = (iso) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
const mesAnterior = (primeiro) => primeiroDoMes(somarDias(primeiro, -1))

// Meses (1º ao último dia) desde o de `inicio` até o de hoje (em andamento); no máximo LIMITE_MESES.
function mesesAte(inicio, hoje) {
  const primeiro = primeiroDoMes(inicio)
  const saida = []
  for (let m = primeiroDoMes(hoje); m >= primeiro && saida.length < LIMITE_MESES; m = mesAnterior(m)) {
    saida.push({ inicio: m, fim: ultimoDoMes(m) })
  }
  return saida.reverse()
}

const ehMensal = (modelo) => modelo && modelo.periodicidade === 'mensal'
// Períodos do modelo (semanas ou meses) desde o início até o atual
const periodosAte = (modelo, hoje) => (ehMensal(modelo) ? mesesAte : semanasAte)(modelo.inicio, hoje)
// Primeiro dia do período em que cai a data
const inicioDoPeriodo = (iso, periodicidade) => (periodicidade === 'mensal' ? primeiroDoMes(iso) : segundaDa(iso))

// Semanas (seg–dom) desde a de `inicio` até a de hoje (em andamento), em ordem; no máximo
// LIMITE_SEMANAS (as mais recentes).
function semanasAte(inicio, hoje) {
  const primeira = segundaDa(inicio)
  const saida = []
  for (let s = segundaDa(hoje); s >= primeira && saida.length < LIMITE_SEMANAS; s = somarDias(s, -7)) {
    saida.push({ inicio: s, fim: somarDias(s, 6) })
  }
  return saida.reverse()
}
// Só as que já terminaram (o domingo já passou)
const semanasFechadas = (inicio, hoje) => semanasAte(inicio, hoje).filter((s) => s.fim < hoje)
// Dia padrão do atendimento: o domingo, ou hoje se a semana não acabou
const dataSugerida = (semana, hoje) => (semana.fim < hoje ? semana.fim : hoje)
const naSemana = (data, semana) => !!data && data >= semana.inicio && data <= semana.fim

const descricaoDa = (modelo, semana) => String(modelo.descricao || '')
  .replace(/\{inicio\}/g, dataBR(semana.inicio)).replace(/\{fim\}/g, dataBR(semana.fim))
  .replace(/\{mes\}/g, dataBR(semana.inicio).slice(3))

const resumoNota = (n) => n && {
  id: n.id, estado: n.estado, valor: n.valor === null || n.valor === undefined ? null : Number(n.valor),
  numero: n.numero_nfse || null, mensagem: n.mensagem_sefin || '', erros: n.erros || [], lote_id: n.lote_id,
}

// situacao: a_emitir | emitida | em_emissao (enviada sem resposta, número reservado...) | pulada
function semanasDoModelo(modelo, notas, hoje) {
  const puladas = new Set(modelo.puladas || [])
  return periodosAte(modelo, hoje).map((s) => {
    const daSemana = notas.filter((n) => naSemana(n.data, s))
    const feita = daSemana.find((n) => FEITAS.includes(n.estado))
    const aberta = daSemana.find((n) => ABERTAS.includes(n.estado))
    const rejeitada = daSemana.filter((n) => n.estado === 'rejeitada').pop()
    const situacao = feita ? (feita.estado === 'autorizada' ? 'emitida' : 'em_emissao') : puladas.has(s.inicio) ? 'pulada' : 'a_emitir'
    return {
      ...s, situacao, emAndamento: s.fim >= hoje, data: dataSugerida(s, hoje),
      descricao: descricaoDa(modelo, s), nota: resumoNota(feita || aberta || rejeitada),
    }
  })
}

const docValido = (doc) => (doc.length === 14 ? cnpjValido(doc) : cpfValido(doc))

// Dados do modelo vindos da tela, validados. Devolve { campos } ou { erro }.
function validarModelo(m, hoje) {
  const nome = String(m.nome || '').replace(/\s+/g, ' ').trim().slice(0, 150)
  const doc = String(m.cpf || m.documento || '').replace(/\D/g, '')
  const descricao = String(m.descricao || '').trim().slice(0, 2000) || DESCRICAO_PADRAO
  const endereco = String(m.endereco || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const cep = String(m.cep || '').replace(/\D/g, '').slice(0, 8)
  if (!nome) return { erro: 'Informe o nome (razão social) do tomador' }
  if (doc.length !== 11 && doc.length !== 14) return { erro: 'CNPJ (14 dígitos) ou CPF (11) do tomador' }
  if (!docValido(doc)) return { erro: `${doc.length === 14 ? 'CNPJ' : 'CPF'} com dígito verificador errado` }
  let valor = null
  if (m.valor !== undefined && m.valor !== null && String(m.valor).trim() !== '') {
    valor = Number(String(m.valor).replace(/\./g, '').replace(',', '.'))
    if (!(valor > 0)) return { erro: 'Valor sugerido inválido' }
  }
  const periodicidade = m.periodicidade === undefined || m.periodicidade === null || m.periodicidade === '' ? 'semanal' : String(m.periodicidade)
  if (!PERIODICIDADES.includes(periodicidade)) return { erro: 'Periodicidade inválida (semanal ou mensal)' }
  // sem início: o período anterior ao atual
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(m.inicio || ''))
    ? inicioDoPeriodo(m.inicio, periodicidade)
    : periodicidade === 'mensal' ? mesAnterior(primeiroDoMes(hoje)) : somarDias(segundaDa(hoje), -7)
  return {
    campos: { nome, cpf: doc, endereco, cep, descricao, valor, inicio, periodicidade, ativo: m.ativo !== false },
  }
}

module.exports = {
  mesesAte, periodosAte, inicioDoPeriodo, ehMensal, primeiroDoMes, ultimoDoMes, PERIODICIDADES,
  semanasAte, semanasFechadas, dataSugerida, naSemana, docValido, semanasDoModelo, descricaoDa, validarModelo, segundaDa, somarDias, DESCRICAO_PADRAO, FEITAS, ABERTAS,
}
