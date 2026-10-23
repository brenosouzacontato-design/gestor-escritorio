// netlify/functions/lib/nfse/tomadores.js
//
// Cadastro de clientes do prestador (tomadores das notas): leitura de planilha de controle,
// busca por nome/apelido e preenchimento dos atendimentos importados.
//
// Regra de ouro (a mesma do importador): só preenche o CPF sozinho quando a correspondência é
// inequívoca. Nome parecido mas não igual vira aviso com o candidato, para a pessoa confirmar.

const { semAcento, soDigitos, parseValor } = require('./importador')
const { cpfValido } = require('./validador')

const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])

// "Maria Helena Costa (José Ricardo)" → { nome: 'Maria Helena Costa', apelidos: ['José Ricardo'] }
function separarApelidos(bruto) {
  const texto = String(bruto ?? '')
  const apelidos = [...texto.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
  const nome = texto.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().replace(/[,;.\-\s]+$/, '')
  return { nome, apelidos }
}

const tokens = (nome) => semAcento(String(nome || '')).toLowerCase().split(/[^a-z]+/)
  .filter((t) => t.length > 1 && !PARTICULAS.has(t))

// Quanto do nome menor está contido no maior (1 = todas as palavras do menor aparecem no maior).
function semelhanca(a, b) {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return { score: 0, comuns: 0 }
  const comuns = [...ta].filter((t) => tb.has(t)).length
  return { score: comuns / Math.min(ta.size, tb.size), comuns }
}

// Procura o tomador pelo nome (e pelos apelidos do cadastro). Devolve:
//   { tomador, como }            correspondência inequívoca (todas as palavras, ≥ 2 palavras, uma só pessoa)
//   { candidatos: [...] }        parecidos (≥ 2 palavras em comum), para a pessoa confirmar
function encontrarPorNome(nomeBruto, tomadores) {
  const { nome, apelidos: observacoes } = separarApelidos(nomeBruto)
  const certos = []
  const parecidos = []
  for (const t of tomadores) {
    if (t.ativo === false) continue
    const alvos = [['nome', t.nome], ...(t.apelidos || []).map((a) => ['apelido', a])]
    let melhor = { score: 0, comuns: 0, como: null }
    for (const [como, alvo] of alvos) {
      const s = semelhanca(nome, alvo)
      if (s.score > melhor.score || (s.score === melhor.score && s.comuns > melhor.comuns)) melhor = { ...s, como }
    }
    // "(recibo em nome de Maria Helena)": o nome citado na observação também conta
    for (const obs of observacoes) {
      const s = semelhanca(obs.replace(/.*\bnome de\b/i, ''), t.nome)
      if (s.comuns >= 1 && melhor.score >= 0.5) melhor = { ...melhor, como: `${melhor.como} + observação` }
    }
    if (melhor.score === 1 && melhor.comuns >= 2) certos.push({ tomador: t, como: melhor.como })
    else if (melhor.comuns >= 2 && melhor.score >= 0.5) parecidos.push({ tomador: t, score: melhor.score })
  }
  if (certos.length === 1) return { tomador: certos[0].tomador, como: certos[0].como }
  const candidatos = [...certos.map((c) => ({ tomador: c.tomador, score: 1 })), ...parecidos]
    .sort((a, b) => b.score - a.score).map((c) => c.tomador)
  return { candidatos }
}

const fmtCpf = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || 'sem CPF')

// Completa os registros importados com o cadastro. Não sobrescreve o que veio na mensagem, exceto o
// nome quando o CPF veio do cadastro (a nota sai no nome do dono do CPF).
function completarComCadastro(registros, tomadores, { descricaoPadrao = '' } = {}) {
  const porCpf = new Map(tomadores.filter((t) => t.cpf).map((t) => [t.cpf, t]))
  return registros.map((r) => {
    const reg = { ...r, avisos: [...(r.avisos || [])] }
    let t = reg.cpf ? porCpf.get(reg.cpf) : null
    if (!t && !reg.cpf && reg.nome) {
      const achado = encontrarPorNome(reg.nome, tomadores)
      if (achado.tomador && achado.tomador.cpf) {
        t = achado.tomador
        const porApelido = achado.como.startsWith('apelido')
        reg.avisos.push(`CPF do cadastro de clientes: ${t.nome} (${fmtCpf(t.cpf)})` +
          (porApelido ? ` — encontrado pelo apelido "${reg.nome}"; a nota sai em nome de ${t.nome}` : ''))
        reg.cpf = t.cpf
        // Pelo nome: fica o da mensagem, em geral mais completo que o da planilha ("Ana Souza
        // Lima" x "Ana Souza"). Pelo apelido: a nota sai no nome do dono do CPF.
        if (porApelido) reg.nome = t.nome
      } else if (achado.tomador) {
        reg.avisos.push(`Cliente ${achado.tomador.nome} está no cadastro, mas sem CPF`)
      } else if (achado.candidatos.length) {
        reg.avisos.push(`Sem CPF. Parecido com: ${achado.candidatos.slice(0, 3).map((c) => `${c.nome} (${fmtCpf(c.cpf)})`).join('; ')} — confirme e digite o CPF`)
      } else {
        reg.avisos.push('Sem CPF e não está no cadastro de clientes')
      }
    }
    if (t) {
      if (!reg.endereco && t.endereco) reg.endereco = t.endereco
      if (!reg.cep && t.cep) reg.cep = t.cep
      if (!reg.descricao && t.descricao_padrao) reg.descricao = t.descricao_padrao
    }
    if (!reg.descricao && descricaoPadrao) reg.descricao = descricaoPadrao
    return reg
  })
}

// ------------------------------------------------------------------------- planilha de clientes

const ehCpf = (v) => {
  if (v === null || v === undefined || v === '') return false
  const d = soDigitos(typeof v === 'number' ? String(Math.trunc(v)) : v)
  return d.length >= 9 && d.length <= 11 && !/[a-z]/i.test(String(v))
}

// Lê uma planilha de controle de clientes (ex.: nome | CPF | Janeiro | Fevereiro | ...). Descobre sozinha
// as colunas: a de CPF é a que mais tem números de 9 a 11 dígitos; a de nome, a primeira com texto.
// Colunas de cabeçalho conhecidas (endereço, CEP, e-mail, telefone, descrição, valor) são aproveitadas.
function lerPlanilhaTomadores(linhas) {
  const larg = Math.max(0, ...linhas.map((l) => l.length))
  const contagem = (teste) => Array.from({ length: larg }, (_, c) => linhas.filter((l) => teste(l[c])).length)
  const cpfs = contagem(ehCpf)
  const textos = contagem((v) => typeof v === 'string' && /[a-zà-ÿ]{3,}/i.test(v) && !ehCpf(v))
  const colCpf = cpfs.indexOf(Math.max(...cpfs))
  const colNome = textos.findIndex((n, c) => c !== colCpf && n === Math.max(...textos.filter((_, i) => i !== colCpf)))
  if (colNome < 0 || cpfs[colCpf] === 0) throw new Error('Não encontrei as colunas de nome e CPF na planilha')

  // cabeçalho (linha com rótulos conhecidos) para colunas extras
  const rotulo = (v) => semAcento(String(v ?? '')).toLowerCase().trim()
  const extras = {}
  const cab = linhas.find((l) => l.some((v) => /^(cpf|nome|cliente|endereco|cep|e-?mail|telefone|celular|descricao|servico|valor)$/.test(rotulo(v))))
  if (cab) {
    cab.forEach((v, c) => {
      const r = rotulo(v)
      if (/^endereco/.test(r)) extras.endereco = c
      else if (r === 'cep') extras.cep = c
      else if (/^e-?mail/.test(r)) extras.email = c
      else if (/^(telefone|celular|whats)/.test(r)) extras.telefone = c
      else if (/^(descricao|servico)/.test(r)) extras.descricao_padrao = c
      else if (/^valor/.test(r)) extras.valor_padrao = c
    })
  }

  const saida = []
  for (const linha of linhas) {
    const bruto = linha[colNome]
    if (typeof bruto !== 'string' || !/[a-zà-ÿ]{2,}/i.test(bruto) || linha === cab) continue
    const { nome, apelidos } = separarApelidos(bruto)
    if (!nome) continue
    const avisos = []
    let cpf = ''
    const v = linha[colCpf]
    if (ehCpf(v)) {
      cpf = soDigitos(typeof v === 'number' ? String(Math.trunc(v)) : v)
      if (cpf.length < 11) { avisos.push(`CPF completado com zeros à esquerda (${cpf})`); cpf = cpf.padStart(11, '0') }
      if (!cpfValido(cpf)) avisos.push(`CPF ${fmtCpf(cpf)} com dígito verificador errado — confira`)
    } else {
      avisos.push('Sem CPF na planilha')
    }
    const t = { nome, cpf, apelidos, avisos }
    for (const [campo, c] of Object.entries(extras)) {
      const val = linha[c]
      if (val === null || val === undefined || val === '') continue
      t[campo] = campo === 'valor_padrao' ? (typeof val === 'number' ? parseValor(val.toFixed(2)) : parseValor(String(val)))
        : campo === 'cep' ? soDigitos(String(val)).padStart(8, '0') : String(val).trim()
    }
    saida.push(t)
  }
  return saida
}

// Compara a planilha com o cadastro atual: o que é novo, o que atualiza e o que conflita.
function planejarImportacao(lidos, existentes) {
  const porCpf = new Map(existentes.filter((t) => t.cpf).map((t) => [t.cpf, t]))
  const porNome = new Map(existentes.map((t) => [tokens(t.nome).join(' '), t]))
  const vistos = new Map() // CPF → nome, dentro da própria planilha
  return lidos.map((l) => {
    if (l.cpf && vistos.has(l.cpf)) {
      return { ...l, acao: 'conflito', avisos: [...l.avisos, `CPF repetido na planilha (também em ${vistos.get(l.cpf)})`] }
    }
    if (l.cpf) vistos.set(l.cpf, l.nome)
    const atual = (l.cpf && porCpf.get(l.cpf)) || porNome.get(tokens(l.nome).join(' '))
    if (!atual) return { ...l, acao: 'novo' }
    if (atual.cpf && l.cpf && atual.cpf !== l.cpf) return { ...l, acao: 'conflito', id: atual.id, avisos: [...l.avisos, `No cadastro com outro CPF: ${fmtCpf(atual.cpf)}`] }
    return { ...l, acao: 'atualizar', id: atual.id, apelidos: [...new Set([...(atual.apelidos || []), ...l.apelidos])] }
  })
}

module.exports = {
  separarApelidos, tokens, semelhanca, encontrarPorNome, completarComCadastro, lerPlanilhaTomadores, planejarImportacao, fmtCpf,
}
