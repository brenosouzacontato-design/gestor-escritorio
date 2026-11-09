// netlify/functions/lib/nfse/mei.js
//
// NFS-e de MEI pelo Emissor Nacional (portal, login com senha). Funções puras usadas pela
// function nfse-mei: conferem o modelo e a nota antes de ir para a fila do robô
// (deploy/robo-parcelamentos/nfse_mei.py). Ver docs/nfse-mei.md.

const soDig = (v) => String(v || '').replace(/\D/g, '')

class ErroMei extends Error {}

function dvOk(doc) {
  const d = soDig(doc)
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false
    const calc = (n) => {
      let s = 0
      for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
      const r = (s * 10) % 11
      return r === 10 ? 0 : r
    }
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false
    const calc = (n) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      const s = pesos.reduce((t, p, i) => t + Number(d[i]) * p, 0)
      const r = s % 11
      return r < 2 ? 0 : 11 - r
    }
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
  }
  return false
}

// "1.234,56" | "1234.56" | 1234.56 → 1234.56 (null se vazio)
function numero(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(/[R$\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n)) throw new ErroMei(`Valor inválido: ${v}`)
  return Math.round(n * 100) / 100
}

// Código de tributação nacional: aceita "01.07.01", "010701" ou "1.07.01"
function codigoTributacao(v) {
  const partes = String(v || '').trim().split('.')
  const d = partes.length === 3 ? partes.map((p, i) => p.padStart(2, '0')).join('') : soDig(v)
  if (!/^\d{6}$/.test(d)) throw new ErroMei('Código de tributação nacional precisa de 6 dígitos (ex.: 01.07.01).')
  return d
}

function tomador(nome, doc) {
  const d = soDig(doc)
  if (!d) return { tomador_nome: String(nome || '').trim(), tomador_doc: null }
  if (d.length !== 11 && d.length !== 14) throw new ErroMei('CPF/CNPJ do tomador precisa ter 11 ou 14 dígitos.')
  if (!dvOk(d)) throw new ErroMei(`CPF/CNPJ do tomador com dígito verificador errado: ${doc}`)
  const n = String(nome || '').trim()
  if (d.length === 11 && !n) throw new ErroMei('Tomador pessoa física: informe o nome.')
  return { tomador_nome: n, tomador_doc: d }
}

function normalizarModelo(m) {
  if (!m) throw new ErroMei('Modelo vazio.')
  const descricao = String(m.descricao || '').trim()
  if (!descricao) throw new ErroMei('Informe a descrição do serviço.')
  if (descricao.length > 2000) throw new ErroMei('Descrição com mais de 2000 caracteres.')
  const valor = numero(m.valor)
  if (valor !== null && valor <= 0) throw new ErroMei('Valor sugerido precisa ser maior que zero.')
  return {
    ...tomador(m.tomador_nome, m.tomador_doc),
    codigo_tributacao: codigoTributacao(m.codigo_tributacao),
    municipio_prestacao: String(m.municipio_prestacao || '').trim(),
    descricao,
    valor,
    ativo: m.ativo !== false,
  }
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// "{mes}" na descrição do modelo vira o mês da competência: "Serviços prestados em {mes}." →
// "Serviços prestados em novembro de 2026."
function descricaoDoMes(descricao, competencia) {
  const [ano, mes] = String(competencia || '').split('-')
  if (!ano || !mes) return descricao
  return String(descricao || '').replace(/\{mes\}/gi, `${MESES[Number(mes) - 1]} de ${ano}`)
}

// competência: 'AAAA-MM-DD' (o portal pede a data); não pode ser futura
function normalizarNota(n, hoje = new Date()) {
  const base = normalizarModelo({ ...n, valor: n.valor })
  if (base.valor === null) throw new ErroMei('Informe o valor da nota.')
  const comp = String(n.competencia || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(comp) || Number.isNaN(Date.parse(comp))) throw new ErroMei('Data de competência inválida.')
  const hojeIso = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  if (comp > hojeIso) throw new ErroMei('A data de competência não pode ser futura.')
  const { ativo, ...resto } = base
  return { ...resto, descricao: descricaoDoMes(resto.descricao, comp), competencia: comp }
}

// Nota igual já pedida: mesmo tomador, mesmo valor, mesmo mês de competência e não descartada.
function notaRepetida(nova, existentes) {
  const mes = nova.competencia.slice(0, 7)
  return existentes.find((e) => !['erro', 'cancelada'].includes(e.status)
    && (e.tomador_doc || '') === (nova.tomador_doc || '')
    && Number(e.valor) === Number(nova.valor)
    && String(e.competencia).slice(0, 7) === mes) || null
}

// Observações do cadastro com a senha do portal numa linha "Senha portal nacional nfse: XXXX".
// Só aceita uma linha única com "nfse:" (senão devolve null e a senha vai pela tela).
function senhaDasObservacoes(obs) {
  const linhas = String(obs || '').split(/\r?\n/).filter((l) => /nfse\s*:/i.test(l))
  const m = linhas.length === 1 && linhas[0].match(/nfse\s*:\s*(\S+)\s*$/i)
  return m ? m[1] : null
}

module.exports = { senhaDasObservacoes, ErroMei, dvOk, descricaoDoMes, numero, codigoTributacao, normalizarModelo, normalizarNota, notaRepetida }
