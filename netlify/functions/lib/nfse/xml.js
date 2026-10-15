// netlify/functions/lib/nfse/xml.js
//
// XML mínimo para a DPS: só elementos, atributos e texto (sem comentários, CDATA ou
// conteúdo misto), que é tudo o que o leiaute da DPS usa.
//
// Por que não uma biblioteca de XML? A assinatura depende da forma canônica (C14N) byte a
// byte. No app Python, o canonizador do libxml2 (e o do signxml, que usa o mesmo) inseria
// xmlns="" em elementos da DPS e a Sefin rejeitava com E0714. Aqui a forma canônica é gerada
// diretamente pelo nosso serializador, e os testes golden comparam com o Python.
//
// Nó: { tag, ns?, attrs: [[nome, valor]], children: [nó], text }
//   ns = namespace padrão declarado NESTE elemento (xmlns="..."); os filhos herdam.

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodificar(texto) {
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    if (!(e in ENTIDADES)) throw new Error(`Entidade XML desconhecida: ${m}`)
    return ENTIDADES[e]
  })
}

// Lê o primeiro elemento <nomeRaiz> de um texto XML (pode estar dentro de outro, ex.: <DPS> dentro de <NFSe>).
function lerElemento(xml, nomeRaiz) {
  const semComentarios = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*\?>/, '')
  const inicio = semComentarios.search(new RegExp(`<${nomeRaiz}[\\s>]`))
  if (inicio < 0) throw new Error(`<${nomeRaiz}> não encontrado no XML`)
  const token = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g
  token.lastIndex = inicio
  const pilha = []
  let raiz = null
  let m
  while ((m = token.exec(semComentarios))) {
    const [, fecha, tag, attrsBrutos, autoFecha, texto] = m
    if (texto !== undefined) {
      if (pilha.length && texto.trim()) pilha[pilha.length - 1].text += decodificar(texto)
      continue
    }
    if (fecha) {
      const no = pilha.pop()
      if (!no || no.tag !== tag) throw new Error(`XML mal formado perto de </${tag}>`)
      if (!pilha.length) { raiz = no; break }
      continue
    }
    const no = { tag, attrs: [], children: [], text: '' }
    for (const [, nome, valor] of (attrsBrutos || '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
      if (nome === 'xmlns') no.ns = decodificar(valor)
      else no.attrs.push([nome, decodificar(valor)])
    }
    if (pilha.length) pilha[pilha.length - 1].children.push(no)
    if (autoFecha) { if (!pilha.length) { raiz = no; break } } else pilha.push(no)
  }
  if (!raiz) throw new Error(`<${nomeRaiz}> sem fechamento`)
  return raiz
}

// Escape de texto e de atributo segundo a C14N 1.0 (também coincide com o que o lxml grava).
const escTexto = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')

// Forma canônica (C14N 1.0 inclusiva, sem comentários) do nó e descendentes.
// nsHerdado = namespace padrão em vigor no pai, no documento original. No elemento do topo do
// subconjunto, a C14N emite a declaração do namespace herdado (ex.: <infDPS xmlns="...nfse">).
function canonico(no, nsHerdado = '', topo = true) {
  const nsDoNo = no.ns !== undefined ? no.ns : nsHerdado
  let s = `<${no.tag}`
  // Topo do subconjunto: declara o namespace padrão em vigor (se houver). Demais: só quando muda.
  const declarar = topo ? Boolean(nsDoNo) : no.ns !== undefined && no.ns !== nsHerdado
  if (declarar) s += ` xmlns="${escAttr(nsDoNo)}"`
  const attrs = [...no.attrs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [k, v] of attrs) s += ` ${k}="${escAttr(v)}"`
  s += '>'
  if (no.children.length) for (const f of no.children) s += canonico(f, nsDoNo, false)
  else s += escTexto(no.text || '')
  return s + `</${no.tag}>`
}

// Serialização do documento como o lxml faz (mesmos bytes do app Python): declaração com aspas
// simples, quebra de linha, xmlns antes dos atributos e elementos vazios auto-fechados.
function serializar(raiz) {
  const ser = (no) => {
    let s = `<${no.tag}`
    if (no.ns !== undefined) s += ` xmlns="${escAttr(no.ns)}"`
    for (const [k, v] of no.attrs) s += ` ${k}="${escAttr(v).replace(/>/g, '&gt;')}"`
    if (!no.children.length && !no.text) return s + '/>'
    s += '>'
    s += no.children.length ? no.children.map(ser).join('') : escTexto(no.text)
    return s + `</${no.tag}>`
  }
  return `<?xml version='1.0' encoding='UTF-8'?>\n${ser(raiz)}`
}

function filho(no, caminho) {
  let atual = no
  for (const parte of caminho.split('/')) {
    atual = atual && atual.children.find((c) => c.tag === parte)
  }
  return atual || null
}

function novo(tag, text = '', attrs = []) {
  return { tag, attrs, children: [], text }
}

function clonar(no) {
  return JSON.parse(JSON.stringify(no))
}

module.exports = { lerElemento, canonico, serializar, filho, novo, clonar, decodificar }
