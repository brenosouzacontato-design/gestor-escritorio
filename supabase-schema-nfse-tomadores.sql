-- Cadastro de clientes do prestador (tomadores das NFS-e). Ver docs/nfse-emissao.md.
-- Mesma regra das outras nfse_*: usuário logado só lê; escrita pela function nfse (service role).
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists nfse_tomadores (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,   -- o prestador (empresa do gestor)
  nome text not null,
  cpf text check (cpf is null or cpf ~ '^\d{11}$'),
  apelidos jsonb not null default '[]'::jsonb,   -- outros nomes pelos quais é citado ("José Ricardo", "Mãe do João")
  endereco text not null default '',
  cep text not null default '',
  email text not null default '',
  telefone text not null default '',
  descricao_padrao text not null default '',     -- descrição do serviço quando a mensagem não traz
  valor_padrao numeric(15,2),
  observacao text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists nfse_tomadores_cpf_idx on nfse_tomadores (cliente_id, cpf) where cpf is not null;
create index if not exists nfse_tomadores_cliente_idx on nfse_tomadores (cliente_id);

-- Descrição do serviço da empresa, usada quando nem a mensagem nem o cadastro do cliente trazem
alter table nfse_empresas add column if not exists descricao_padrao text not null default '';

alter table nfse_tomadores enable row level security;
drop policy if exists "nfse_tomadores_leitura_autenticado" on nfse_tomadores;
create policy "nfse_tomadores_leitura_autenticado" on nfse_tomadores for select to authenticated using (true);
