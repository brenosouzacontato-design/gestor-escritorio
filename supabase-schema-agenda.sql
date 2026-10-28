-- ============================================================
-- AGENDA — Gestor Escritório Contábil
-- Reuniões e compromissos do escritório. Criados na tela Agenda ou pelo
-- WhatsApp ("reunião: ..." no grupo do escritório, ver
-- netlify/functions/whatsapp-webhook.js). O lembretes-cron avisa no
-- grupo em lembrete_em (1 hora antes; sem hora, às 8h do dia).
-- ============================================================

create table if not exists agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  cliente_id uuid references clientes(id) on delete set null,
  data date not null,
  hora time,                       -- null = dia inteiro / sem hora definida
  duracao_min integer check (duracao_min is null or duracao_min between 1 and 600),
  local text,                      -- endereço ou link da chamada
  descricao text,
  origem text not null default 'manual' check (origem in ('manual', 'whatsapp')),
  lembrete_em timestamptz,
  lembrete_enviado boolean not null default false,
  cancelado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agenda_eventos_data on agenda_eventos(data);
create index if not exists idx_agenda_eventos_lembrete
  on agenda_eventos(lembrete_em) where lembrete_enviado = false and cancelado = false;

-- Acesso: as functions usam a service key (passam por cima do RLS). O
-- front usa o login do escritório: com o RLS do projeto aplicado
-- (supabase-rls-01-preparacao.sql) vale is_escritorio(); sem ele, qualquer
-- usuário logado. Anônimo (painel do cliente) não vê a agenda.
alter table agenda_eventos enable row level security;

do $$
begin
  drop policy if exists escritorio_total on agenda_eventos;
  if to_regprocedure('public.is_escritorio()') is not null then
    execute 'create policy escritorio_total on agenda_eventos for all to authenticated
               using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    execute 'create policy escritorio_total on agenda_eventos for all to authenticated
               using (true) with check (true)';
  end if;
end $$;
