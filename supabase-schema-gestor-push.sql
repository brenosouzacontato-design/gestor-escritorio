-- ============================================================
-- NOTIFICAÇÕES PUSH DO APP DO ESCRITÓRIO — Gestor Escritório Contábil
-- Um aparelho/navegador da equipe que tocou em "Ativar avisos neste
-- aparelho" (tela Tarefas). Os lembretes com hora marcada
-- (lembretes-cron.js) chegam como notificação nesses aparelhos, além do
-- WhatsApp do grupo. Quem grava e lê é só o servidor
-- (netlify/functions/gestor-push.js e lib/gestorPush.js, com a chave de
-- serviço), por isso a RLS fica ligada e sem nenhuma política.
-- ============================================================

create table if not exists gestor_push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,             -- endereço de entrega do navegador
  p256dh text not null,                      -- chaves de criptografia da assinatura
  auth text not null,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_gestor_push_assinaturas_user
  on gestor_push_assinaturas(user_id);

alter table gestor_push_assinaturas enable row level security;
