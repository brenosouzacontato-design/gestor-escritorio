-- ============================================================
-- ATIVIDADE DO CLIENTE NO PAINEL COMPARTILHADO — Gestor Escritório Contábil
-- Uma linha a cada vez que o cliente abre o link público do painel ou
-- baixa um arquivo dele (guia, declaração, relatório). Gravada por
-- netlify/functions/painel-evento.js, que também avisa o grupo do
-- escritório no WhatsApp; o escritório vê a atividade recente no topo da
-- nova versão do painel (PainelCompartilhadoPage.jsx, modo admin).
-- painel_visualizacoes (só aberturas) continua existindo e sendo gravada.
-- ============================================================

create table if not exists painel_eventos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo in ('visualizacao', 'download')),
  descricao text,                            -- o que foi baixado (ex: "Guia — DAS 09/2026")
  competencia text,                          -- "MM/YYYY" aberta no painel
  criado_em timestamptz not null default now()
);

create index if not exists idx_painel_eventos_cliente
  on painel_eventos(cliente_id, criado_em desc);

-- Mesmo padrão do resto do projeto (ver nota em supabase-schema-andamento.sql).
alter table painel_eventos disable row level security;
