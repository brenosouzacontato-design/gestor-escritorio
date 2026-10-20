// netlify/functions/lib/nfse/validador.js
//
// Validação dos registros: pronto | pendente | invalido. Porte de app/validador.py.

const PRONTO = 'pronto'
const PENDENTE = 'pendente'
const INVALIDO = 'invalido'

const ROTULOS = { nome: 'Nome', cpf: 'CPF', data: 'Data', valor: 'Valor', descricao: 'Descrição', endereco: 'Endereço' }

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || cpf === cpf[0].repeat(11)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(cpf[i]) * (tamanho + 1 - i)
    if ((soma * 10) % 11 % 10 !== Number(cpf[tamanho])) return false
  }
  return true
}

const dataBR = (iso) => iso.split('-').reverse().join('/')

// Datas como 'AAAA-MM-DD' e valor como string decimal ('1590.00'): comparação por texto funciona.
// hoje: 'AAAA-MM-DD' (data de Brasília).
function validar({ nome, cpf, data, valor, descricao, endereco, competencia = null, camposObrigatorios, hoje }) {
  const presentes = {
    nome: Boolean((nome || '').trim()),
    cpf: Boolean(cpf),
    data: Boolean(data),
    valor: valor !== null && valor !== undefined && valor !== '',
    descricao: Boolean((descricao || '').trim()),
    endereco: Boolean((endereco || '').trim()),
  }
  const pendencias = Object.keys(ROTULOS).filter((c) => camposObrigatorios.includes(c) && !presentes[c]).map((c) => ROTULOS[c])

  const erros = []
  if (cpf) {
    if (cpf.length !== 11) erros.push(`CPF com ${cpf.length} dígitos (precisa ter 11)`)
    else if (!cpfValido(cpf)) erros.push('CPF com dígito verificador errado')
  }
  if (presentes.valor && Number(valor) <= 0) erros.push('Valor precisa ser maior que zero')
  if (data && data > hoje) erros.push(`Data futura (${dataBR(data)})`)
  // A Sefin rejeita competência posterior à data de emissão (E0015)
  if (competencia && competencia > hoje) erros.push(`Competência futura (${dataBR(competencia)})`)

  const status = erros.length ? INVALIDO : pendencias.length ? PENDENTE : PRONTO
  return { status, pendencias, erros }
}

// Mesmo CPF + data + valor = provável nota repetida. Sem os três, não dá para afirmar.
function chaveDuplicidade(cpf, data, valor) {
  if (!cpf || !data || valor === null || valor === undefined || valor === '') return null
  return `${cpf}|${data}|${Number(valor).toFixed(2)}`
}

// Data de hoje em Brasília (UTC-3)
function hojeBrasilia(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

module.exports = { PRONTO, PENDENTE, INVALIDO, cpfValido, validar, chaveDuplicidade, hojeBrasilia }
