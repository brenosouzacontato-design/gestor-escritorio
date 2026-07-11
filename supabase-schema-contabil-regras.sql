-- ============================================================
-- MÓDULO CONTÁBIL — Regras de classificação automática
-- Toda vez que um lançamento é classificado (manual, em lote, ou
-- escolhido na hora de importar o extrato), o sistema grava aqui
-- "quando o histórico tiver X, classifica em Y". Da próxima vez que
-- aparecer uma transação parecida, já entra classificada sozinha.
-- ============================================================

create table if not exists regras_classificacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references clientes(id) on delete cascade,
  padrao text not null,              -- contraparte extraída do histórico (normalizada)
  conta_id uuid not null references contas_contabeis(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (empresa_id, padrao)
);

create index if not exists idx_regras_classificacao_empresa on regras_classificacao(empresa_id);

-- Sem RLS, mesmo padrão do resto do módulo contábil (ver 01_schema_contabil.sql).
