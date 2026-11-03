-- ============================================================
-- LICENCIAMENTO — Gestor Escritório Contábil
-- Alvarás e licenças das empresas clientes (funcionamento, sanitário,
-- bombeiros, ambiental...), com validade, etapa da renovação e checklist
-- dos documentos exigidos. Tela: src/pages/licenciamento/LicenciamentoPage.jsx.
--
-- O lembretes-cron (netlify/functions/lembretes-cron.js) avisa o grupo do
-- escritório no WhatsApp quando faltam os dias de avisos_dias para vencer
-- (e no dia em que vence) e, com criar_tarefa ligado, abre uma tarefa de
-- renovação no primeiro aviso. avisos_enviados guarda quais avisos já
-- foram mandados para a validade atual; o front zera ao mudar a validade.
--
-- O documento da licença vai para a tabela "documentos" (mesmo bucket do
-- resto do app) com licenca_id preenchido.
-- ============================================================

create table if not exists licencas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo in ('funcionamento', 'sanitario', 'bombeiros', 'ambiental', 'outro')),
  descricao text,                   -- nome livre (obrigatório na prática quando tipo = 'outro')
  orgao text,                       -- prefeitura, vigilância sanitária, corpo de bombeiros...
  numero text,
  municipio text,
  data_emissao date,
  data_validade date,               -- null = sem vencimento (licença definitiva)
  -- Renovação/emissão em andamento. null = nada em andamento.
  etapa text check (etapa in ('a_iniciar', 'aguardando_cliente', 'protocolado')),
  protocolo text,
  checklist jsonb not null default '[]'::jsonb,   -- [{ "texto": "...", "ok": false }]
  observacao text,
  avisos_dias integer[] not null default '{60,30}',
  avisos_enviados integer[] not null default '{}',
  criar_tarefa boolean not null default true,
  tarefa_id uuid references tarefas(id) on delete set null,
  arquivada boolean not null default false,       -- empresa não precisa mais (baixa, mudou de atividade...)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_licencas_cliente on licencas(cliente_id);
create index if not exists idx_licencas_validade on licencas(data_validade) where arquivada = false;

-- Documento (alvará emitido, protocolo, laudos) ligado à licença.
alter table documentos
  add column if not exists licenca_id uuid references licencas(id) on delete set null;
create index if not exists idx_documentos_licenca on documentos(licenca_id) where licenca_id is not null;

-- Acesso: as functions usam a service key (passam por cima do RLS). O
-- front usa o login do escritório: com o RLS do projeto aplicado
-- (supabase-rls-01-preparacao.sql) vale is_escritorio(); sem ele, qualquer
-- usuário logado. Mesmo padrão de supabase-schema-agenda.sql.
alter table licencas enable row level security;

do $$
begin
  drop policy if exists escritorio_total on licencas;
  if to_regprocedure('public.is_escritorio()') is not null then
    execute 'create policy escritorio_total on licencas for all to authenticated
               using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    execute 'create policy escritorio_total on licencas for all to authenticated
               using (true) with check (true)';
  end if;
end $$;
