// netlify/functions/lib/honorariosLembrete.js
//
// Lógica de envio do lembrete de honorário — compartilhada entre o cron
// diário (honorarios-cron.js) e o envio manual sob demanda
// (honorarios-enviar-lembrete.js, botão "Enviar lembrete agora" na tela).
// Diferente de lembretes.js (obrigação/tarefa), esse manda DIRETO pro
// celular do cliente, não pro grupo interno — por isso a validação de
// telefone é rígida (ver lib/telefone.js): sem confirmar que o número é
// mesmo um celular, não envia.

const { normalizarTelefoneWhatsapp } = require('./telefone');
const { enviarMensagem } = require('./whatsapp');

function fmtMoeda(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtData(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

// Retorna { enviado: boolean, motivo?: string } — motivo preenchido só
// quando enviado=false, explica por que pulou (não é erro fatal).
async function enviarLembreteHonorario(supabase, honorarioId) {
  const { data: honorario, error: errHon } = await supabase
    .from('honorarios')
    .select('id, competencia, valor, vencimento, status, clientes(nome, telefone)')
    .eq('id', honorarioId)
    .single();
  if (errHon) throw errHon;
  if (!honorario) return { enviado: false, motivo: 'Honorário não encontrado.' };
  if (honorario.status !== 'pendente') return { enviado: false, motivo: 'Honorário já está marcado como pago.' };

  const numero = normalizarTelefoneWhatsapp(honorario.clientes?.telefone);
  if (!numero) return { enviado: false, motivo: 'Telefone do cliente não é um celular válido (confira em Clientes).' };

  const { data: config, error: errConfig } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', ['honorarios_pix_chave', 'honorarios_pix_favorecido']);
  if (errConfig) throw errConfig;
  const porChave = Object.fromEntries((config || []).map((r) => [r.chave, r.valor]));
  const chavePix = porChave.honorarios_pix_chave;
  if (!chavePix) return { enviado: false, motivo: 'Chave PIX não configurada (tela Honorários → Configurar PIX).' };
  const favorecido = porChave.honorarios_pix_favorecido || '';

  const texto = `🧾 *Lembrete de honorário contábil*\n`
    + `Olá, ${honorario.clientes?.nome || ''}! O honorário de ${honorario.competencia} no valor de ${fmtMoeda(honorario.valor)} venceu em ${fmtData(honorario.vencimento)}.\n\n`
    + `💳 Chave PIX: ${chavePix}`
    + (favorecido ? `\n👤 ${favorecido}` : '')
    + `\n\nSe já pagou, pode desconsiderar. Qualquer dúvida, é só chamar por aqui.`;

  await enviarMensagem(numero, texto);

  const { error: errUpdate } = await supabase
    .from('honorarios')
    .update({ lembrete_enviado_em: new Date().toISOString() })
    .eq('id', honorarioId);
  if (errUpdate) throw errUpdate;

  return { enviado: true };
}

module.exports = { enviarLembreteHonorario };
