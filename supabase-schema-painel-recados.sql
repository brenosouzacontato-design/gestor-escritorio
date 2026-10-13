-- ============================================================
-- RECADOS POR LINHA DO PAINEL COMPARTILHADO — Gestor Escritório Contábil
-- Mensagem manual que o escritório escreve numa linha do painel do cliente
-- (guia, honorário, pendência da Situação Fiscal, obrigação/tarefa) no
-- modo de edição de PainelCompartilhadoPage.jsx. item_chave identifica a
-- linha (id da obrigação/tarefa, "hon-<id>" do honorário, ou
-- "pend-<origem>-<tributo>-<competência>" do débito).
-- ============================================================

create table if not exists painel_recados (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  item_chave text not null,
  mensagem text not null,
  atualizado_em timestamptz not null default now(),
  unique(cliente_id, item_chave)
);

-- Mesmo padrão do resto do projeto (ver nota em supabase-schema-andamento.sql).
alter table painel_recados disable row level security;
