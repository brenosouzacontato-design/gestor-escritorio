-- ============================================================
-- LEMBRETES COM NOTIFICAÇÃO POR WHATSAPP — Gestor Escritório Contábil
-- Lembrete com data/hora própria (independente do vencimento) numa
-- obrigação ou tarefa. Disparado pela Netlify Scheduled Function
-- netlify/functions/lembretes-cron.js, que manda a mensagem pro grupo
-- do escritório no WhatsApp (netlify/functions/lib/whatsapp.js).
-- ============================================================

create table if not exists lembretes (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid references obrigacoes(id) on delete cascade,
  tarefa_id uuid references tarefas(id) on delete cascade,
  data_hora timestamptz not null,
  mensagem text,
  enviado boolean not null default false,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint lembretes_um_item check (
    (obrigacao_id is not null and tarefa_id is null) or
    (obrigacao_id is null and tarefa_id is not null)
  )
);

-- lembretes-cron.js varre por enviado=false + data_hora vencida a cada
-- execução — índice parcial cobre exatamente essa consulta.
create index if not exists idx_lembretes_pendentes
  on lembretes(data_hora) where enviado = false;

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table lembretes disable row level security;
