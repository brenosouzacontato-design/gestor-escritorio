// netlify/functions/lib/admissao.js
//
// Regras da ficha de admissão (link ?admissao=<token>), sem banco nem rede —
// testadas em __tests__/admissao.test.cjs. Os campos e anexos vêm de
// admissaoCampos.json (o mesmo arquivo que a página do candidato usa).

const crypto = require('crypto')
const CAMPOS = require('./admissaoCampos.json')

class ErroAdmissao extends Error {}

// O candidato só mexe na ficha enquanto ela não foi enviada (ou se o escritório devolveu).
const STATUS_EDITAVEL = ['aguardando', 'preenchendo', 'devolvida']
const STATUS = {
  aguardando: 'Link enviado',
  preenchendo: 'Preenchendo',
  enviada: 'Recebida',
  devolvida: 'Devolvida para correção',
  concluida: 'Cadastrada no OneFlow',
  cancelada: 'Cancelada',
}

const TODOS_CAMPOS = CAMPOS.secoes.flatMap((s) => s.campos)
const MAX_DEPENDENTES = 15

const digitos = (v) => String(v || '').replace(/\D/g, '')

function gerarToken() {
  return crypto.randomBytes(18).toString('base64url')
}

// ---------- validações de documento ----------

function cpfValido(valor) {
  const d = digitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const t of [9, 10]) {
    let soma = 0
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i)
    const dv = ((soma * 10) % 11) % 10
    if (dv !== Number(d[t])) return false
  }
  return true
}

function pisValido(valor) {
  const d = digitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const soma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = 11 - (soma % 11)
  const dv = resto >= 10 ? 0 : resto
  return dv === Number(d[10])
}

// "AAAA-MM-DD" de verdade (o input date do celular manda assim)
function dataValida(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''))
  if (!m) return false
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3]
    && +m[1] >= 1900 && +m[1] <= 2100
}

// ---------- campos condicionais ----------

function campoAtivo(item, dados = {}) {
  if (item.seDependentes) return (dados.dependentes || []).length > 0
  if (!item.se) return true
  return item.se.valores.includes(dados[item.se.campo])
}

// ---------- normalização ----------

function limpar(valor, max = 200) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizarCampo(campo, bruto) {
  switch (campo.tipo) {
    case 'cpf': case 'pis': return digitos(bruto).slice(0, 11)
    case 'cep': return digitos(bruto).slice(0, 8)
    case 'telefone': return digitos(bruto).slice(0, 13)
    case 'uf': return limpar(bruto, 2).toUpperCase()
    case 'data': return dataValida(bruto) ? bruto : ''
    case 'email': return limpar(bruto, 120).toLowerCase()
    case 'textarea': return String(bruto ?? '').trim().slice(0, 1000)
    case 'opcao': return campo.opcoes.includes(bruto) ? bruto : ''
    default: return limpar(bruto)
  }
}

function normalizarDependente(bruto = {}) {
  return {
    nome: limpar(bruto.nome, 150),
    cpf: digitos(bruto.cpf).slice(0, 11),
    data_nascimento: dataValida(bruto.data_nascimento) ? bruto.data_nascimento : '',
    parentesco: CAMPOS.parentescos.includes(bruto.parentesco) ? bruto.parentesco : '',
    irrf: !!bruto.irrf,
    salario_familia: !!bruto.salario_familia,
  }
}

// Só as chaves conhecidas, limpas. Campo que deixou de valer (ex.: reservista
// depois de trocar o sexo) é apagado.
function normalizarDados(bruto = {}) {
  const dados = {}
  for (const campo of TODOS_CAMPOS) dados[campo.id] = normalizarCampo(campo, bruto[campo.id])
  dados.dependentes = (Array.isArray(bruto.dependentes) ? bruto.dependentes : [])
    .slice(0, MAX_DEPENDENTES).map(normalizarDependente)
    .filter((d) => d.nome || d.cpf || d.data_nascimento)
  for (const campo of TODOS_CAMPOS) if (!campoAtivo(campo, dados)) dados[campo.id] = ''
  return dados
}

// ---------- validação para envio ----------

// Lista de pendências em português (vazia = pode enviar).
function pendenciasFicha(dados, documentos = []) {
  const erros = []
  for (const campo of TODOS_CAMPOS) {
    if (!campoAtivo(campo, dados)) continue
    const v = dados[campo.id]
    if (campo.obrigatorio && !v) { erros.push(`Preencha: ${campo.rotulo}`); continue }
    if (!v) continue
    if (campo.tipo === 'cpf' && !cpfValido(v)) erros.push(`${campo.rotulo} inválido — confira os números.`)
    if (campo.tipo === 'pis' && !pisValido(v)) erros.push(`${campo.rotulo} inválido — confira os números.`)
    if (campo.tipo === 'cep' && v.length !== 8) erros.push('CEP precisa ter 8 números.')
    if (campo.tipo === 'telefone' && (v.length < 10 || v.length > 13)) erros.push(`${campo.rotulo}: informe com DDD.`)
    if (campo.tipo === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) erros.push('E-mail inválido.')
  }
  if (dados.data_nascimento) {
    const idade = (Date.now() - new Date(dados.data_nascimento).getTime()) / (365.25 * 864e5)
    if (idade < 14 || idade > 100) erros.push('Data de nascimento parece errada.')
  }
  ;(dados.dependentes || []).forEach((d, i) => {
    const n = `Dependente ${i + 1}`
    if (!d.nome) erros.push(`${n}: falta o nome.`)
    if (!d.data_nascimento) erros.push(`${n}: falta a data de nascimento.`)
    if (!d.parentesco) erros.push(`${n}: falta o parentesco.`)
    if (d.cpf && !cpfValido(d.cpf)) erros.push(`${n}: CPF inválido.`)
  })
  for (const anexo of CAMPOS.anexos) {
    if (!anexo.obrigatorio || !campoAtivo(anexo, dados)) continue
    if (!documentos.some((doc) => doc.tipo === anexo.id)) erros.push(`Anexe: ${anexo.rotulo}`)
  }
  return erros
}

// ---------- textos ----------

const fmtCpf = (v) => (digitos(v).length === 11 ? digitos(v).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v || '')
const fmtPis = (v) => (digitos(v).length === 11 ? digitos(v).replace(/(\d{3})(\d{5})(\d{2})(\d)/, '$1.$2.$3-$4') : v || '')
const fmtData = (v) => (dataValida(v) ? v.split('-').reverse().join('/') : '')
const fmtCep = (v) => (digitos(v).length === 8 ? digitos(v).replace(/(\d{5})(\d{3})/, '$1-$2') : v || '')
function fmtTelefone(v) {
  let d = digitos(v)
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return v || ''
}

function valorExibido(campo, v) {
  if (!v) return ''
  if (campo.tipo === 'cpf') return fmtCpf(v)
  if (campo.tipo === 'pis') return fmtPis(v)
  if (campo.tipo === 'data') return fmtData(v)
  if (campo.tipo === 'cep') return fmtCep(v)
  if (campo.tipo === 'telefone') return fmtTelefone(v)
  return v
}

function rotuloAnexo(id) {
  return CAMPOS.anexos.find((a) => a.id === id)?.rotulo || id
}

// Resumo que o funcionário recebe no WhatsApp depois de enviar a ficha.
function resumoWhatsapp(adm, empresaNome) {
  const d = adm.dados || {}
  const linhas = [`✅ *Ficha de admissão recebida*`, `Empresa: ${empresaNome || '-'}`]
  if (adm.cargo) linhas.push(`Cargo: ${adm.cargo}`)
  if (adm.data_admissao) linhas.push(`Admissão prevista: ${fmtData(adm.data_admissao)}`)
  for (const secao of CAMPOS.secoes) {
    const itens = secao.campos
      .filter((c) => campoAtivo(c, d) && d[c.id])
      .map((c) => `• ${c.rotulo}: ${valorExibido(c, d[c.id])}`)
    if (itens.length) linhas.push('', `*${secao.titulo}*`, ...itens)
  }
  if ((d.dependentes || []).length) {
    linhas.push('', '*Dependentes*')
    for (const dep of d.dependentes) {
      const extras = [dep.irrf && 'IR', dep.salario_familia && 'salário-família'].filter(Boolean).join(', ')
      linhas.push(`• ${dep.nome} — ${dep.parentesco}, ${fmtData(dep.data_nascimento)}${dep.cpf ? `, CPF ${fmtCpf(dep.cpf)}` : ''}${extras ? ` (${extras})` : ''}`)
    }
  }
  const docs = adm.documentos || []
  if (docs.length) {
    const contagem = {}
    for (const doc of docs) contagem[doc.tipo] = (contagem[doc.tipo] || 0) + 1
    linhas.push('', '*Documentos anexados*', ...Object.entries(contagem).map(([t, n]) => `• ${rotuloAnexo(t)}${n > 1 ? ` (${n})` : ''}`))
  }
  linhas.push('', 'Se algo estiver errado, avise o RH. Guarde esta mensagem.')
  return linhas.join('\n')
}

function mensagemConvite({ nome, empresaNome, link, cargo }) {
  const primeiro = limpar(nome).split(' ')[0]
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! 👋`,
    `Para a sua admissão na *${empresaNome}*${cargo ? ` (${cargo})` : ''}, preencha a ficha e envie fotos dos documentos por este link:`,
    link,
    '',
    'Leva uns 10 minutos. Tenha em mãos RG/CNH, CPF, comprovante de residência e carteira de trabalho. Dá para parar e continuar depois pelo mesmo link.',
  ].join('\n')
}

function mensagemDevolucao({ nome, motivo, link }) {
  const primeiro = limpar(nome).split(' ')[0]
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}! Sua ficha de admissão precisa de um ajuste:`,
    '',
    motivo,
    '',
    `Corrija pelo mesmo link e envie de novo: ${link}`,
  ].join('\n')
}

// ---------- planilha (OneFlow) ----------

// Uma linha por funcionário: dados do escritório + todos os campos da ficha,
// na ordem do admissaoCampos.json, com os cabeçalhos de 'coluna'.
function linhaPlanilha(adm, empresa = {}) {
  const d = adm.dados || {}
  const linha = {
    'CNPJ Empregador': digitos(empresa.cnpj),
    Empregador: empresa.nome || '',
    'Data de Admissão': fmtData(adm.data_admissao),
    Cargo: adm.cargo || '',
    'Salário': adm.salario != null ? Number(adm.salario) : '',
    Jornada: adm.jornada || '',
  }
  for (const campo of TODOS_CAMPOS) {
    const v = campoAtivo(campo, d) ? d[campo.id] : ''
    linha[campo.coluna] = campo.tipo === 'data' ? fmtData(v) : (v || '')
  }
  linha['Qtd. Dependentes'] = (d.dependentes || []).length
  return linha
}

function linhasDependentes(adm) {
  const d = adm.dados || {}
  return (d.dependentes || []).map((dep) => ({
    'CPF Funcionário': d.cpf || '',
    'Funcionário': d.nome || '',
    'Nome do Dependente': dep.nome,
    'CPF do Dependente': dep.cpf,
    'Data de Nascimento': fmtData(dep.data_nascimento),
    Parentesco: dep.parentesco,
    'Dependente IRRF': dep.irrf ? 'Sim' : 'Não',
    'Salário-Família': dep.salario_familia ? 'Sim' : 'Não',
  }))
}

module.exports = {
  CAMPOS, STATUS, STATUS_EDITAVEL, ErroAdmissao, MAX_DEPENDENTES,
  gerarToken, cpfValido, pisValido, dataValida, campoAtivo,
  normalizarDados, pendenciasFicha, resumoWhatsapp, mensagemConvite, mensagemDevolucao,
  linhaPlanilha, linhasDependentes, rotuloAnexo, fmtCpf, fmtData,
}
