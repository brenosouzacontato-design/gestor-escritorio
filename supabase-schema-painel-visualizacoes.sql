-- ============================================================
-- LOG DE VISUALIZAÇÃO DO PAINEL COMPARTILHADO — Gestor Escritório Contábil
-- Uma linha a cada vez que o cliente abre o link público do painel
-- (?painel=<id> — ver main.jsx/registrarVisualizacaoPainel em painelApi.js).
-- O escritório vê a última visualização no topo da nova versão do painel
-- (PainelCompartilhadoPage.jsx, modo admin).
-- ============================================================

create table if not exists painel_visualizacoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text,                          -- "MM/YYYY" do link aberto
  versao text,                               -- 'nova' | 'completa'
  user_agent text,
  visualizado_em timestamptz not null default now()
);

create index if not exists idx_painel_visualizacoes_cliente
  on painel_visualizacoes(cliente_id, visualizado_em desc);

-- Mesmo padrão do resto do projeto (ver nota em supabase-schema-andamento.sql).
alter table painel_visualizacoes disable row level security;
