-- ============================================================
-- SITUAÇÃO FISCAL (RFB) — Gestor Escritório Contábil
-- Dados extraídos por IA (netlify/functions/extrair-situacao-fiscal.js)
-- do Relatório de Situação Fiscal emitido pela Receita Federal, pra
-- alimentar o painel consolidado do cliente (src/pages/painel/PainelClientePage.jsx).
-- Mesmo molde de dados_gerenciais_simples (supabase-schema-dados-gerenciais.sql).
-- ============================================================

create table if not exists situacao_fiscal_rfb (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text not null,                 -- "MM/YYYY", mesmo formato de obrigacoes.competencia
  data_emissao date,
  situacao_geral text check (situacao_geral in ('regular','pendente')),
  debitos jsonb,                             -- [{tributo, valor, situacao}]
  parcelamentos jsonb,                       -- [{modalidade, valor, parcelas}]
  dividas_ativas jsonb,                      -- [{inscricao, valor, situacao}] (PGFN)
  storage_path text,                         -- PDF original, no bucket "documentos"
  observacao_ia text,
  created_at timestamptz not null default now()
);

-- Reenviar o relatório da mesma competência substitui os dados antigos
-- (upsert em uploadSituacaoFiscal, painelApi.js).
create unique index if not exists idx_situacao_fiscal_cliente_competencia
  on situacao_fiscal_rfb(cliente_id, competencia);

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table situacao_fiscal_rfb disable row level security;
