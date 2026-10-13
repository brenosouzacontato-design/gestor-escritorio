-- ============================================================
-- NOTIFICAÇÕES PUSH DO PAINEL DO CLIENTE — Gestor Escritório Contábil
-- Um aparelho/navegador do cliente que tocou em "Ativar notificações" no
-- painel compartilhado (PainelCompartilhadoPage.jsx). O escritório manda a
-- notificação pelo modo admin do painel; quem dispara de fato é
-- netlify/functions/painel-push.js, que também apaga daqui as assinaturas
-- que o navegador já invalidou.
-- ============================================================

create table if not exists painel_push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  endpoint text not null unique,             -- endereço de entrega do navegador
  p256dh text not null,                      -- chaves de criptografia da assinatura
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_painel_push_assinaturas_cliente
  on painel_push_assinaturas(cliente_id);

-- Mesmo padrão do resto do projeto (ver nota em supabase-schema-andamento.sql).
alter table painel_push_assinaturas disable row level security;
