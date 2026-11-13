-- ============================================================
-- FINANCEIRO -> ONEFLOW — controle do que já foi lançado no OneFlow
-- ============================================================

-- O Gestor virou ponte: importa o extrato (tela ou WhatsApp), classifica e
-- gera a planilha oficial do OneFlow ("Planilha de Lançamentos — partidas
-- simples"), que o escritório importa em Contábil > Lançamentos > Importar
-- lançamentos. O OneFlow não tem API pra receber lançamentos, então cada
-- arquivo gerado vira um "envio" e os lançamentos dele ficam marcados — o
-- próximo arquivo leva só o que ainda não foi (sem duplicar no OneFlow).
-- Tela: src/pages/contabil/LancarOneflowTab.jsx.
create table if not exists oneflow_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references clientes(id) on delete cascade,
  data_inicio date,
  data_fim date,
  qtd_lancamentos integer not null default 0,
  qtd_linhas integer not null default 0,
  total numeric(14,2) not null default 0,
  modo text,
  arquivo text,
  criado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_oneflow_envios_empresa on oneflow_envios(empresa_id, created_at desc);
alter table oneflow_envios disable row level security;

alter table lancamentos_contabeis add column if not exists oneflow_envio_id uuid references oneflow_envios(id) on delete set null;
alter table lancamentos_contabeis add column if not exists oneflow_enviado_em timestamptz;
create index if not exists idx_lancamentos_oneflow_envio on lancamentos_contabeis(oneflow_envio_id);
