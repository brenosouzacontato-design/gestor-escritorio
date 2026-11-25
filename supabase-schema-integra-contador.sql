-- ============================================================
-- INTEGRA CONTADOR (SERPRO) — Gestor Escritório Contábil
-- ============================================================
-- Tela Integra Contador: recálculo de DARF (Sicalc), DAS do Simples
-- (PGDAS-D) e DAS das parcelas de parcelamentos do Simples/MEI.
-- Function: netlify/functions/integra-contador.js. Ver docs/integra-contador.md.
--
-- serpro_config: certificado A1 (e-CNPJ) do escritório, o CONTRATANTE do
--   Integra Contador, cifrado com a NFSE_CERT_KEY (mesmo cofre da NFS-e).
--   As chaves (Consumer Key/Secret) ficam só nas variáveis do Netlify.
-- integra_guias: cada guia gerada (PDF no bucket "documentos", integra/<id>.pdf).
-- integra_chamadas: registro de cada chamada ao SERPRO (o contrato é cobrado
--   por requisição): serve para conferir o consumo.
--
-- Acesso: RLS ligado e SEM policy (só service role, pela function).
-- Aditivo e seguro rodar mais de uma vez.
-- ============================================================

create table if not exists serpro_config (
  id smallint primary key default 1 check (id = 1),   -- uma linha só
  pfx_cifrado text not null,
  senha_cifrada text not null,
  cert_cnpj text not null,
  cert_titular text,
  cert_valido_ate timestamptz,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

create table if not exists integra_guias (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tipo text not null check (tipo in ('darf', 'das', 'parcela')),
  sistema text,                 -- SICALC, PGDASD, PARCSN, PARCMEI...
  referencia text,              -- período (MM/AAAA), parcela (MM/AAAA) ou receita/período do DARF
  parametros jsonb not null default '{}'::jsonb,   -- o que foi pedido
  numero_documento text,
  principal numeric(15,2),
  multa numeric(15,2),
  juros numeric(15,2),
  total numeric(15,2),
  vencimento date,              -- vencimento original (DAS)
  validade date,                -- até quando a guia pode ser paga
  arquivo_path text not null,
  documento_id uuid,            -- quando foi enviada para Documentos do cliente
  ambiente text not null default 'producao',
  criado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists integra_guias_cliente_idx on integra_guias (cliente_id, criado_em desc);
create index if not exists integra_guias_recentes_idx on integra_guias (criado_em desc);

create table if not exists integra_chamadas (
  id bigint generated always as identity primary key,
  cliente_id uuid references clientes(id) on delete set null,
  id_sistema text not null,
  id_servico text not null,
  status integer,
  ok boolean not null,
  mensagem text,
  duracao_ms integer,
  ambiente text not null default 'producao',
  criado_em timestamptz not null default now()
);
create index if not exists integra_chamadas_mes_idx on integra_chamadas (criado_em desc);

alter table serpro_config enable row level security;     -- sem policy: só service role
alter table integra_guias enable row level security;
alter table integra_chamadas enable row level security;
