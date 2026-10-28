// agendaApi.js
// Reuniões e compromissos do escritório (tabela agenda_eventos, ver
// supabase-schema-agenda.sql). Também nascem pelo WhatsApp com
// "reunião: ..." (netlify/functions/whatsapp-webhook.js), e o
// lembretes-cron avisa no grupo em lembrete_em.
import { supabase } from '../../lib/supabase';

const OFFSET = '-03:00';

// Mesmo critério do WhatsApp (lib/comandosWhatsapp.js → lembreteReuniao):
// 1 hora antes; sem hora, às 8h do dia.
export function calcularLembrete(data, hora) {
  if (!data) return null;
  if (!hora) return `${data}T08:00:00${OFFSET}`;
  const inicio = new Date(`${data}T${hora.slice(0, 5)}:00${OFFSET}`);
  return new Date(inicio.getTime() - 60 * 60 * 1000).toISOString();
}

// Tabela ainda não criada no banco
export function agendaNaoCriada(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || /agenda_eventos/.test(error.message || ''));
}

export async function listarEventos({ de, ate } = {}) {
  let q = supabase
    .from('agenda_eventos')
    .select('*, clientes(nome)')
    .order('data', { ascending: true })
    .order('hora', { ascending: true, nullsFirst: true });
  if (de) q = q.gte('data', de);
  if (ate) q = q.lte('data', ate);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// Aviso pendente enquanto a reunião não começou (se o horário do aviso já
// passou, o próximo giro do lembretes-cron avisa na hora).
function camposLembrete(data, hora) {
  const inicio = new Date(`${data}T${hora ? hora.slice(0, 5) : '23:59'}:00${OFFSET}`);
  return { lembrete_em: calcularLembrete(data, hora), lembrete_enviado: inicio <= new Date() };
}

function linha(ev) {
  return {
    titulo: ev.titulo.trim(),
    cliente_id: ev.cliente_id || null,
    data: ev.data,
    hora: ev.hora || null,
    duracao_min: ev.duracao_min ? Number(ev.duracao_min) : null,
    local: ev.local?.trim() || null,
    descricao: ev.descricao?.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

// `original`: o evento antes da edição. O aviso só é refeito quando muda
// o dia ou a hora (editar o assunto não repete um aviso já enviado).
export async function salvarEvento(ev, original = null) {
  const hora = ev.hora || null;
  const mudouQuando = !original || original.data !== ev.data || (original.hora || null)?.slice(0, 5) !== hora?.slice(0, 5);
  const campos = { ...linha(ev), ...(mudouQuando ? camposLembrete(ev.data, hora) : {}) };
  const { error } = ev.id
    ? await supabase.from('agenda_eventos').update(campos).eq('id', ev.id)
    : await supabase.from('agenda_eventos').insert({ ...campos, origem: 'manual' });
  if (error) throw error;
}

export async function cancelarEvento(id, cancelado = true) {
  const { error } = await supabase
    .from('agenda_eventos')
    .update({ cancelado, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function excluirEvento(id) {
  const { error } = await supabase.from('agenda_eventos').delete().eq('id', id);
  if (error) throw error;
}

export async function listarClientesAtivos() {
  const { data, error } = await supabase.from('clientes').select('id, nome').eq('ativo', true).order('nome');
  if (error) throw error;
  return data;
}
