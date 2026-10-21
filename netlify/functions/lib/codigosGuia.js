// netlify/functions/lib/codigosGuia.js
//
// Validação dos códigos de pagamento lidos de uma guia, pro botão "copiar"
// do painel do cliente (PainelCompartilhadoPage.jsx). Um dígito errado num
// código de barras ou num PIX copia e cola faz o pagamento falhar (ou pior),
// então nada é gravado sem passar pela conferência matemática do próprio
// código — a leitura (IA no texto da guia, QR code no navegador) pode errar,
// a conta dos dígitos verificadores não.

// ---------- linha digitável ----------

function mod10(numeros) {
  let soma = 0
  let peso = 2
  for (let i = numeros.length - 1; i >= 0; i--) {
    const p = Number(numeros[i]) * peso
    soma += p > 9 ? Math.floor(p / 10) + (p % 10) : p
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

// mod 11 da arrecadação (FEBRABAN): pesos 2 a 9 da direita pra esquerda;
// resto 0 ou 1 → DV 0, resto 10 → DV 1.
function mod11Arrecadacao(numeros) {
  let soma = 0
  let peso = 2
  for (let i = numeros.length - 1; i >= 0; i--) {
    soma += Number(numeros[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto <= 1 ? 0 : 11 - resto
}

// Arrecadação (DAS, DARF, GPS, FGTS, tributos municipais/estaduais): 48
// dígitos em 4 blocos de 11 + DV, começando por 8. O 3º dígito diz o módulo
// do DV: 6/7 → módulo 10, 8/9 → módulo 11.
function arrecadacaoValida(d) {
  if (d.length !== 48 || d[0] !== '8') return false
  const modulo = ['6', '7'].includes(d[2]) ? mod10 : ['8', '9'].includes(d[2]) ? mod11Arrecadacao : null
  if (!modulo) return false
  let codigo = ''
  for (let b = 0; b < 4; b++) {
    const bloco = d.slice(b * 12, b * 12 + 11)
    if (modulo(bloco) !== Number(d[b * 12 + 11])) return false
    codigo += bloco
  }
  // DV geral (4º dígito do código de barras de 44 posições), sobre os outros
  // 43 — pega os poucos erros que escapam do DV de bloco no módulo 11
  return modulo(codigo.slice(0, 3) + codigo.slice(4)) === Number(codigo[3])
}

// Boleto bancário: 47 dígitos; os 3 primeiros campos têm DV módulo 10.
function boletoValido(d) {
  if (d.length !== 47) return false
  const campos = [[0, 9], [10, 20], [21, 31]] // [início, posição do DV]
  return campos.every(([ini, dv]) => mod10(d.slice(ini, dv)) === Number(d[dv]))
}

// Só os dígitos, se for uma linha digitável válida; senão null.
function linhaDigitavelValida(texto) {
  const d = String(texto || '').replace(/\D/g, '')
  return arrecadacaoValida(d) || boletoValido(d) ? d : null
}

// ---------- PIX copia e cola (BR Code / EMV) ----------

function crc16(texto) {
  let crc = 0xffff
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// O payload, se for um PIX copia e cola íntegro (começa com "000201", tem
// o arranjo br.gov.bcb.pix e o CRC do campo 63 confere); senão null.
function pixValido(texto) {
  const p = String(texto || '').trim()
  if (!p.startsWith('000201') || !/br\.gov\.bcb\.pix/i.test(p) || p.length > 512) return null
  const m = /6304([0-9A-Fa-f]{4})$/.exec(p)
  if (!m) return null
  return crc16(p.slice(0, -4)) === m[1].toUpperCase() ? p : null
}

module.exports = { linhaDigitavelValida, pixValido, mod10, mod11Arrecadacao }
