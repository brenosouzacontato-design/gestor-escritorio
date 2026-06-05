-- ============================================================
-- GESTOR ESCRITÓRIO CONTÁBIL — Schema Supabase
-- Execute no SQL Editor do seu projeto Supabase
-- ============================================================

-- Clientes
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  regime text default 'Simples Nacional',
  email text,
  telefone text,
  responsavel text,
  oneflow_app_hash text,
  oneflow_token text,
  oneflow_refresh_token text,
  oneflow_token_expires_at timestamptz,
  ativo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tarefas
create table if not exists tarefas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete cascade,
  titulo text not null,
  descricao text,
  departamento text not null check (departamento in ('fiscal','pessoal','societario','contabil','comunicacao')),
  prioridade text default 'media' check (prioridade in ('alta','media','baixa')),
  vencimento date,
  concluida boolean default false,
  concluida_em timestamptz,
  origem text default 'manual' check (origem in ('manual','erp')),
  competencia text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Fechamentos ERP (cache dos dados do OneFlow)
create table if not exists fechamentos_erp (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete cascade,
  competencia text not null,
  tipo text not null check (tipo in ('folha','fiscal')),
  status text not null check (status in ('aberto','fechado','nao_aplica')),
  dados_erp jsonb,
  sincronizado_em timestamptz default now(),
  created_at timestamptz default now()
);

-- Configurações do escritório (OneFlow tokens globais)
create table if not exists configuracoes (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null,
  valor text,
  updated_at timestamptz default now()
);

-- Índices
create index if not exists idx_tarefas_cliente on tarefas(cliente_id);
create index if not exists idx_tarefas_concluida on tarefas(concluida);
create index if not exists idx_tarefas_vencimento on tarefas(vencimento);
create index if not exists idx_fechamentos_cliente on fechamentos_erp(cliente_id);
create index if not exists idx_fechamentos_competencia on fechamentos_erp(competencia);

-- RLS (Row Level Security) — habilitar se usar auth por usuário
-- alter table clientes enable row level security;
-- alter table tarefas enable row level security;
-- alter table fechamentos_erp enable row level security;
-- alter table configuracoes enable row level security;

-- Dados de exemplo
insert into clientes (nome, cnpj, regime) values
  ('Simple Care Odontologia', '47.619.250/0001-78', 'Simples Nacional'),
  ('ZAP Burguer Ltda', '00.000.000/0001-00', 'Simples Nacional'),
  ('AC Almeida Cortinas', '00.000.000/0002-00', 'MEI'),
  ('Lilliam Alves Queiroz', '00.000.000/0003-00', 'Lucro Presumido'),
  ('Cliente Exemplo 5', '00.000.000/0004-00', 'Simples Nacional')
on conflict do nothing;
