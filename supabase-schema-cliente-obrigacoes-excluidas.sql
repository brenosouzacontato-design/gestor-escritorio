-- ============================================================
-- OBRIGAÇÕES — exceções por cliente — Gestor Escritório Contábil
-- ============================================================

-- Tipos de obrigação recorrente que NÃO se aplicam a um cliente
-- específico (ex: cliente sem folha de pagamento não tem Folha/eSocial;
-- cliente que não emite nota de serviço não tem NFS-e) —
-- gerarObrigacoesRecorrentesCompetencia (andamentoApi.js) passa a pular
-- esses tipos na hora de gerar a competência, em vez de criar a
-- obrigação e marcar "não aplica" manualmente depois.
create table if not exists cliente_tipos_obrigacao_excluidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo_obrigacao_id uuid not null references tipos_obrigacao(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(cliente_id, tipo_obrigacao_id)
);

alter table cliente_tipos_obrigacao_excluidos disable row level security;
