-- ============================================================
-- DADOS GERENCIAIS DO SIMPLES NACIONAL — Gestor Escritório Contábil
-- Números extraídos por IA (netlify/functions/extrair-declaracao-simples.js)
-- de uma Declaração do Simples enviada pelo escritório, pra alimentar o
-- painel consolidado do cliente (src/pages/painel/PainelClientePage.jsx).
-- ============================================================

create table if not exists dados_gerenciais_simples (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text not null,                 -- "MM/YYYY", mesmo formato de obrigacoes.competencia
  faturamento_periodo numeric,
  rbt12 numeric,
  aliquota_efetiva numeric,
  valor_das numeric,
  anexo text,                                -- I a V
  storage_path text,                         -- PDF original, no bucket "documentos"
  observacao_ia text,
  created_at timestamptz not null default now()
);

-- Reenviar a declaração da mesma competência substitui os dados antigos
-- (upsert em uploadDeclaracaoSimples, painelApi.js).
create unique index if not exists idx_dados_gerenciais_cliente_competencia
  on dados_gerenciais_simples(cliente_id, competencia);

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table dados_gerenciais_simples disable row level security;
