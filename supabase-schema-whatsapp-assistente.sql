-- Assistente guiado do grupo "ANALISTA JR" do WhatsApp (variável WHATSAPP_ANALISTA_GROUP_ID no Netlify).
-- Guarda em que passo está a conversa de cada pessoa do grupo (menu → empresa → tomador → valor → ...).
-- Conversa parada há mais de 30 minutos recomeça do menu. Ver netlify/functions/lib/assistenteWhatsapp.js.
-- Só as functions (service role) leem e escrevem: RLS ligado e nenhuma política.
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists whatsapp_conversas (
  remote_jid text not null,                 -- o grupo
  participante text not null,               -- quem escreveu no grupo
  estado jsonb,                             -- { etapa, fluxo, empresa_id, ref, valor }
  atualizado_em timestamptz not null default now(),
  primary key (remote_jid, participante)
);

alter table whatsapp_conversas enable row level security;
