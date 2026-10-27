-- Todas as NFS-e emitidas por uma empresa, lidas do Ambiente de Dados Nacional (ADN), inclusive as
-- que não saíram do gestor. Usadas pelo link "todas as notas" do cliente (?notas=<token do painel>).
-- Ver netlify/functions/lib/nfse/adn.js e netlify/functions/nfse-emitidas.js.
-- Mesma regra das outras nfse_*: usuário logado só lê; escrita pela function (service role).
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists nfse_adn_notas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,   -- a empresa emitente
  chave_acesso text not null unique,
  nsu bigint not null,
  ambiente text not null default 'producao' check (ambiente in ('producao', 'homologacao')),
  numero_nfse text,
  competencia date,
  emitida_em timestamptz,
  tomador_nome text,
  tomador_doc text,
  valor numeric(15,2),
  valor_liquido numeric(15,2),
  descricao text,
  emitente_doc text,
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada', 'substituida')),
  xml text not null,
  criado_em timestamptz not null default now()
);
create index if not exists nfse_adn_notas_cliente_idx on nfse_adn_notas (cliente_id, emitida_em desc);

-- Até onde a leitura do ADN já foi, por empresa
create table if not exists nfse_adn_controle (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  ultimo_nsu bigint not null default 0,
  sincronizado_em timestamptz,
  ultimo_erro text
);

alter table nfse_adn_notas enable row level security;
alter table nfse_adn_controle enable row level security;
drop policy if exists "nfse_adn_notas_leitura_autenticado" on nfse_adn_notas;
create policy "nfse_adn_notas_leitura_autenticado" on nfse_adn_notas for select to authenticated using (true);
drop policy if exists "nfse_adn_controle_leitura_autenticado" on nfse_adn_controle;
create policy "nfse_adn_controle_leitura_autenticado" on nfse_adn_controle for select to authenticated using (true);
