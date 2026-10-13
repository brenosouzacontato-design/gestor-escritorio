-- ============================================================
-- STATUS GERAL "AGUARDANDO CLIENTE" (kanban de Empresas — Cards/Lista)
-- Terceiro status da sinalização manual por competência, ao lado de
-- "A entregar" e "Entregue" (supabase-schema-cliente-entrega-competencia.sql):
-- o mês daquele cliente está parado esperando algo dele. Vale só quando
-- entregue = false.
-- ============================================================

alter table cliente_entrega_competencia
  add column if not exists aguardando_cliente boolean not null default false;
