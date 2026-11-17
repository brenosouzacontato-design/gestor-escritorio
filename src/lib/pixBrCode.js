// pixBrCode.js
//
// Monta o "PIX copia e cola" (BR Code estático, padrão EMV do Banco Central)
// a partir da chave PIX do escritório e de um valor — o mesmo texto que vira
// o QR Code. Usado na tela de Honorários pra cobrar um ou mais honorários do
// cliente num PIX só (ver ModalQrCodePix em HonorariosPage.jsx).
//
// Campos (Manual do BR Code / Manual de Padrões para Iniciação do PIX):
//   00 formato · 26 conta (GUI br.gov.bcb.pix + chave + descrição) ·
//   52 categoria · 53 moeda (986 = BRL) · 54 valor · 58 país · 59 nome ·
//   60 cidade · 62 txid · 63 CRC16-CCITT

const GUI_PIX = 'br.gov.bcb.pix';

function campo(id, valor) {
  const v = String(valor);
  return id + String(v.length).padStart(2, '0') + v;
}

// sem acento e só ASCII imprimível (o padrão não aceita outros caracteres)
export function textoPix(s, max) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// Chave como o PIX espera: CPF/CNPJ só dígitos, telefone +55DDDNÚMERO,
// e-mail em minúsculas, chave aleatória como está.
export function normalizarChavePix(chave) {
  const c = String(chave || '').trim();
  if (!c) return '';
  if (c.includes('@')) return c.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c.toLowerCase();
  if (c.startsWith('+')) return '+' + c.replace(/\D/g, '');
  const d = c.replace(/\D/g, '');
  if (d.length === 14) return d; // CNPJ
  if (d.length === 11 && cpfValido(d)) return d; // CPF (11 dígitos que não fecham o CPF = celular)
  if (d.length === 10 || d.length === 11) return '+55' + d; // telefone com DDD
  if (d.length === 12 || d.length === 13) return '+' + d; // telefone já com 55
  return c;
}

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), em 4 dígitos hexa maiúsculos
export function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// { chave, nome, cidade, valor, txid?, descricao? } → texto do PIX copia e cola.
// Lança erro com mensagem pra tela quando falta algo obrigatório.
export function montarPixCopiaCola({ chave, nome, cidade, valor, txid, descricao }) {
  const chaveNorm = normalizarChavePix(chave);
  if (!chaveNorm) throw new Error('Configure a chave PIX dos honorários.');
  const nomePix = textoPix(nome, 25);
  if (!nomePix) throw new Error('Configure o nome do favorecido (sai no app do banco do cliente).');
  const cidadePix = textoPix(cidade, 15);
  if (!cidadePix) throw new Error('Configure a cidade do favorecido.');
  const total = Math.round(Number(valor) * 100) / 100;
  if (!(total > 0)) throw new Error('O valor do PIX precisa ser maior que zero.');

  // descrição limitada pra conta caber nos 99 caracteres do campo 26
  const espacoDescricao = 99 - (4 + GUI_PIX.length) - (4 + chaveNorm.length) - 4;
  const desc = textoPix(descricao, Math.min(40, Math.max(0, espacoDescricao)));
  const conta = campo('00', GUI_PIX) + campo('01', chaveNorm) + (desc ? campo('02', desc) : '');
  const id = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  const semCrc = campo('00', '01')
    + campo('26', conta)
    + campo('52', '0000')
    + campo('53', '986')
    + campo('54', total.toFixed(2))
    + campo('58', 'BR')
    + campo('59', nomePix)
    + campo('60', cidadePix)
    + campo('62', campo('05', id))
    + '6304';
  return semCrc + crc16(semCrc);
}
