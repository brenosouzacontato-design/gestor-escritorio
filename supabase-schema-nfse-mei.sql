-- NFS-e de MEI pelo Emissor Nacional (portal www.nfse.gov.br, login com CPF/CNPJ e senha).
-- MEI sem certificado A1 não usa a API da Sefin (nfse_empresas). Aqui:
--   nfse_mei_acessos  senha do portal, cifrada (AES-256-GCM, chave NFSE_CERT_KEY no Netlify e no robô)
--   nfse_mei_modelos  o que se repete em toda nota da empresa: tomador, serviço, descrição, valor sugerido
--   nfse_mei_notas    fila: o escritório pede a nota (Emitir NFS-e MEI), o robô do servidor emite no portal,
--                     guarda PDF/XML no bucket documentos (nfse-mei/) e manda no WhatsApp do cliente
-- Mesma regra das outras nfse_*: logado só lê modelos e notas; a senha ninguém lê pelo navegador;
-- escrita pela function nfse-mei e pelo robô (service role). Ver docs/nfse-mei.md.
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists nfse_mei_acessos (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  senha_cifrada text not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists nfse_mei_modelos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  tomador_nome text not null default '',
  tomador_doc text check (tomador_doc is null or tomador_doc ~ '^(\d{11}|\d{14})$'),  -- null = não identificado
  codigo_tributacao text not null check (codigo_tributacao ~ '^\d{6}$'),           -- cTribNac, ex.: 010701
  municipio_prestacao text not null default '',  -- nome do município; vazio = o que o portal já sugerir
  descricao text not null,
  valor numeric(15,2) check (valor is null or valor > 0),   -- sugestão; o valor de cada nota vai na hora
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists nfse_mei_modelos_cliente_idx on nfse_mei_modelos (cliente_id);

create table if not exists nfse_mei_notas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  modelo_id uuid references nfse_mei_modelos(id) on delete set null,
  tomador_nome text not null default '',
  tomador_doc text check (tomador_doc is null or tomador_doc ~ '^(\d{11}|\d{14})$'),
  codigo_tributacao text not null check (codigo_tributacao ~ '^\d{6}$'),
  municipio_prestacao text not null default '',
  descricao text not null,
  valor numeric(15,2) not null check (valor > 0),
  competencia date not null,
  -- na_fila → processando → (aguardando_pessoa) → emitida | erro ; cancelada = desistiu antes de emitir
  status text not null default 'na_fila'
    check (status in ('na_fila','processando','aguardando_pessoa','emitida','erro','cancelada')),
  talvez_emitida boolean not null default false,  -- travou depois do clique em "Emitir": conferir no portal
  robo_mensagem text,
  robo_em timestamptz,
  tentativas int not null default 0,
  numero text,
  chave text,
  pdf_path text,
  xml_path text,
  whatsapp_enviado_em timestamptz,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists nfse_mei_notas_cliente_idx on nfse_mei_notas (cliente_id, criado_em desc);
create index if not exists nfse_mei_notas_fila_idx on nfse_mei_notas (status) where status = 'na_fila';

alter table nfse_mei_acessos enable row level security;   -- sem policy: só service role
alter table nfse_mei_modelos enable row level security;
alter table nfse_mei_notas enable row level security;
drop policy if exists "nfse_mei_modelos_leitura_autenticado" on nfse_mei_modelos;
create policy "nfse_mei_modelos_leitura_autenticado" on nfse_mei_modelos for select to authenticated using (true);
drop policy if exists "nfse_mei_notas_leitura_autenticado" on nfse_mei_notas;
create policy "nfse_mei_notas_leitura_autenticado" on nfse_mei_notas for select to authenticated using (true);
