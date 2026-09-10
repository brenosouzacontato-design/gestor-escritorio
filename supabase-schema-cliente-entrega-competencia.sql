-- ============================================================
-- ENTREGA MANUAL POR COMPETÊNCIA (kanban de Empresas — Cards)
-- Sinalização manual "entreguei o mês desse cliente" (arrastar o card
-- entre as colunas "A entregar"/"Entregue"), independente do % de
-- obrigações concluídas — o escritório pode considerar entregue mesmo
-- com pendência aberta pro mês seguinte, ou vice-versa.
-- ============================================================

create table if not exists cliente_entrega_competencia (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  competencia text not null,
  entregue boolean not null default true,
  atualizado_em timestamptz not null default now(),
  unique(cliente_id, competencia)
);

alter table cliente_entrega_competencia disable row level security;
