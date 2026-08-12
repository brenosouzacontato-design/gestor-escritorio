// netlify/functions/lib/telefone.js
//
// clientes.telefone é texto livre (a máscara do formulário grava
// "(31) 99999-0000", mas há registros antigos com 8 dígitos, sem DDD, ou
// vazios) — nunca foi pensado pra virar automaticamente um número de
// WhatsApp. Antes deste módulo, NADA no sistema mandava mensagem direto
// pro celular de um cliente (só pro grupo interno do escritório), então
// não havia normalização nenhuma pra reaproveitar.
//
// Só devolve um número quando dá pra confirmar com razoável certeza que é
// um celular (DDD + 9 dígitos começando em 9) — nos outros casos (10
// dígitos sem o 9º, sem DDD, vazio) devolve null e quem chamar deve pular
// o envio, nunca completar o número "no chute": mandar uma cobrança de
// honorário com chave PIX pro número errado é pior do que não mandar.
function normalizarTelefoneWhatsapp(bruto) {
  if (!bruto) return null;
  let digitos = String(bruto).replace(/\D/g, '');
  if (!digitos) return null;

  // já veio com o DDI 55 na frente — tira pra trabalhar só com DDD+número
  // e recolocar no final, mesma validação pros dois casos.
  if (digitos.length >= 12 && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  }

  if (digitos.length !== 11) return null; // DDD (2) + celular com 9º dígito (9)
  const ddd = Number(digitos.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (digitos[2] !== '9') return null;

  return `55${digitos}`;
}

module.exports = { normalizarTelefoneWhatsapp };
