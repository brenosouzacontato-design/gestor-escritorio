-- ============================================================
-- LANÇAMENTOS — links curtos pra identificação — Gestor Escritório Contábil
-- ============================================================

-- "Enviar pra identificação" (LancamentosTab.jsx/EnviarIdentificacaoButton.jsx)
-- pode mandar uma lista de lançamentos específica (filtro aplicado na tela
-- ou seleção manual) em vez do período inteiro. Listar um UUID por
-- lançamento direto na URL (?ids=id1,id2,...) deixava o link enorme (uma
-- centena de lançamentos já passa de 10 mil caracteres) — trava em alguns
-- apps/navegadores e fica feio de compartilhar. Esta tabela guarda a lista
-- de IDs por trás de um único UUID curto (?link=<id>), resolvido em
-- IdentificarLancamentosPage.jsx antes de buscar os lançamentos de fato.
create table if not exists lancamentos_identificacao_links (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references clientes(id) on delete cascade,
  lancamento_ids uuid[] not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lancamentos_identificacao_links_empresa on lancamentos_identificacao_links(empresa_id);

alter table lancamentos_identificacao_links disable row level security;
