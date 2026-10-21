-- ============================================================
-- REGISTRO DO QUE FOI FEITO PELO LINK DA CARTEIRA — Gestor Escritório Contábil
-- O link da carteira (?carteira=<token>, sem login) pode criar tarefa, dar
-- baixa em obrigação/tarefa e anexar documento — sempre pela Netlify Function
-- netlify/functions/carteira-acao.js, que confere o token e a carteira da
-- empresa antes. Cada uma dessas ações vira uma linha aqui, pra o escritório
-- saber o que foi feito por esse caminho.
-- Sem esta tabela as ações funcionam do mesmo jeito, só não ficam registradas.
-- Seguro rodar mais de uma vez.
-- ============================================================

create table if not exists carteira_acoes (
  id         uuid primary key default gen_random_uuid(),
  carteira   text not null,
  acao       text not null,      -- criar_tarefa | concluir_tarefa | reabrir_tarefa | status_obrigacao | anexar
  cliente_id uuid references clientes(id) on delete cascade,
  alvo_id    uuid,               -- obrigação ou tarefa
  detalhe    text,
  user_agent text,
  criado_em  timestamptz not null default now()
);

create index if not exists idx_carteira_acoes_criado on carteira_acoes(criado_em desc);
create index if not exists idx_carteira_acoes_cliente on carteira_acoes(cliente_id, criado_em desc);

-- Grava só a function (service key). Lê quem está logado no gestor; depois do
-- passo 1 do RLS (supabase-rls-01-preparacao.sql), só quem é do escritório —
-- rodar este script de novo troca a policy.
alter table carteira_acoes enable row level security;
drop policy if exists carteira_acoes_ler on carteira_acoes;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    execute 'create policy carteira_acoes_ler on carteira_acoes for select to authenticated using ((select is_escritorio()))';
  else
    execute 'create policy carteira_acoes_ler on carteira_acoes for select to authenticated using (true)';
  end if;
end $$;
