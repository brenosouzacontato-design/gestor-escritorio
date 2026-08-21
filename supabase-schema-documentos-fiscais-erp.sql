-- Notas fiscais (entrada/saída, NF-e/NFS-e) importadas da Omie/OneFlow —
-- alimentada pelo cron diário (netlify/functions/documentos-fiscais-cron.js)
-- e pelo botão "Sincronizar agora" na tela ERP.
create table if not exists documentos_fiscais_erp (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text not null,
  modelo text,
  tipo_movimento text check (tipo_movimento in ('entrada', 'saida')),
  numero text,
  serie text,
  cnpj_cpf_terceiro text,
  razao_social_terceiro text,
  data_emissao date,
  data_escrituracao date,
  valor_total numeric(14,2),
  situacao_documento text,
  situacao_apuracao text,
  origem text,
  tipo_emissao text,
  alerta boolean not null default false,
  erro boolean not null default false,
  dados jsonb,
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Dedup: reprocessar a mesma competência não duplica, só atualiza (upsert
-- por cliente+modelo+número+série identifica o mesmo documento sempre).
create unique index if not exists idx_documentos_fiscais_erp_dedup
  on documentos_fiscais_erp(cliente_id, modelo, numero, serie);

create index if not exists idx_documentos_fiscais_erp_competencia
  on documentos_fiscais_erp(cliente_id, competencia);

alter table documentos_fiscais_erp disable row level security;
