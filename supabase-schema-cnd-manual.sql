-- ============================================================
-- CND ESTADUAL/MUNICIPAL (marcação manual) — Gestor Escritório Contábil
-- Complementa situacao_fiscal_rfb (só federal) — estadual e municipal têm
-- formato de certidão muito variável por estado/prefeitura, então aqui é
-- marcação manual (Regular/Pendente) feita no modal de Empresas, em vez
-- de upload+IA. Alimenta a aba CND do painel consolidado do cliente
-- (src/pages/painel/PainelClientePage.jsx).
-- ============================================================

create table if not exists cnd_manual (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text not null,                 -- "MM/YYYY", mesmo formato de obrigacoes.competencia
  situacao_estadual text check (situacao_estadual in ('regular','pendente')),
  situacao_municipal text check (situacao_municipal in ('regular','pendente')),
  observacao text,
  atualizado_em timestamptz not null default now()
);

-- Marcar de novo na mesma competência substitui (upsert em
-- salvarCndManual, painelApi.js).
create unique index if not exists idx_cnd_manual_cliente_competencia
  on cnd_manual(cliente_id, competencia);

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table cnd_manual disable row level security;
