-- Módulo de emissão de NFS-e (Sefin Nacional). Ver docs/nfse-emissao.md.
--
-- Segurança:
--   * RLS ligado em todas as tabelas nfse_*.
--   * Usuário autenticado (login do gestor) só LÊ. Toda escrita passa pelas Netlify Functions
--     (service role), que aplicam a máquina de estados, a reserva de número e a duplicidade.
--   * nfse_certificados não tem política nenhuma: nem o navegador logado consegue ler.
--     O .pfx e a senha ficam cifrados (AES-256-GCM) com a chave NFSE_CERT_KEY do Netlify.
--
-- Rodar no SQL Editor do Supabase. Idempotente.

-- Configuração de emissão por empresa (cliente do gestor)
create table if not exists nfse_empresas (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao','producao')),
  serie_dps text not null default '900' check (serie_dps ~ '^\d{1,5}$'),
  codigo_municipio text not null check (codigo_municipio ~ '^\d{7}$'),
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  regra_competencia text not null default 'mes_do_atendimento' check (regra_competencia in ('mes_do_atendimento','mes_da_emissao')),
  servico_padrao jsonb not null default '{}'::jsonb,       -- { cTribNac, tribISSQN, tpRetISSQN }
  campos_obrigatorios jsonb not null default '["nome","cpf","data","valor","descricao","endereco"]'::jsonb,
  gabarito_xml text not null,                              -- bloco <DPS> de uma NFS-e já emitida
  whatsapp_origem text,                                    -- grupo/número do WhatsApp que pede notas desta empresa
  cert_titular text,                                       -- metadados do certificado (o arquivo fica em nfse_certificados)
  cert_cnpj text,
  cert_valido_ate timestamptz,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nfse_certificados (
  cliente_id uuid primary key references clientes(id) on delete cascade,
  pfx_cifrado text not null,     -- base64(iv | tag | dados), AES-256-GCM
  senha_cifrada text not null,
  enviado_em timestamptz not null default now()
);

create table if not exists nfse_lotes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  ambiente text not null check (ambiente in ('homologacao','producao')),
  origem text not null check (origem in ('colado','planilha','whatsapp','recorrente','migracao')),
  descricao text not null default '',
  criado_em timestamptz not null default now()
);

create table if not exists nfse_recorrentes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  nome text not null,
  cpf text not null check (cpf ~ '^\d{11}$'),
  endereco text not null default '',
  cep text not null default '',
  descricao text not null,
  valor numeric(15,2) not null check (valor > 0),
  dia_mes int not null check (dia_mes between 1 and 28),
  competencia text not null default 'mes_atual' check (competencia in ('mes_atual','mes_anterior')),
  ativo boolean not null default true,
  ultima_geracao date,
  criado_em timestamptz not null default now()
);

create table if not exists nfse_notas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references nfse_lotes(id) on delete cascade,
  cliente_id uuid not null references clientes(id) on delete cascade,
  ambiente text not null check (ambiente in ('homologacao','producao')),
  -- importada → validada → numero_reservado → enviada → autorizada | rejeitada | indeterminada
  estado text not null default 'importada'
    check (estado in ('importada','validada','numero_reservado','enviada','autorizada','rejeitada','indeterminada')),
  status_validacao text not null default 'pendente' check (status_validacao in ('pronto','pendente','invalido')),
  pendencias jsonb not null default '[]'::jsonb,
  erros jsonb not null default '[]'::jsonb,
  avisos jsonb not null default '[]'::jsonb,
  nome text not null default '',
  cpf text not null default '',
  endereco text not null default '',
  cep text not null default '',
  data date,
  competencia date,                      -- vazio = regra da empresa
  valor numeric(15,2),
  descricao text not null default '',
  autor text not null default '',
  data_mensagem text not null default '',
  origem text not null default '',
  texto_original text not null default '',
  recorrente_id uuid references nfse_recorrentes(id) on delete set null,
  serie text,
  n_dps bigint,
  id_dps text,
  chave_acesso text,
  numero_nfse text,
  mensagem_sefin text,
  xml_enviado text,                      -- DPS assinada (reaproveitada em qualquer reenvio)
  xml_retorno text,                      -- NFS-e devolvida pela Sefin
  copiada_para uuid references nfse_notas(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (cliente_id, ambiente, serie, n_dps)
);
create index if not exists nfse_notas_lote_idx on nfse_notas (lote_id);
create index if not exists nfse_notas_dup_idx on nfse_notas (cliente_id, cpf, data, valor);

-- Numeração da DPS por empresa + ambiente + série. Só avança.
create table if not exists nfse_sequencias (
  cliente_id uuid not null references clientes(id) on delete cascade,
  ambiente text not null check (ambiente in ('homologacao','producao')),
  serie text not null,
  ultimo_numero bigint not null,
  primary key (cliente_id, ambiente, serie)
);

create table if not exists nfse_eventos (
  id bigserial primary key,
  nota_id uuid not null references nfse_notas(id) on delete cascade,
  estado_de text,
  estado_para text not null,
  detalhe text not null default '',
  usuario text,
  em timestamptz not null default now()
);
create index if not exists nfse_eventos_nota_idx on nfse_eventos (nota_id);

-- Reserva atômica do próximo nDPS. Grava o número na nota ANTES de qualquer chamada à Sefin.
-- Se a nota já tem número, devolve o mesmo (nunca reserva duas vezes).
create or replace function nfse_reservar_numero(p_nota uuid, p_usuario text default null)
returns bigint language plpgsql as $$
declare
  v_nota nfse_notas%rowtype;
  v_serie text;
  v_numero bigint;
begin
  select * into v_nota from nfse_notas where id = p_nota for update;
  if not found then raise exception 'Nota % não encontrada', p_nota; end if;
  if v_nota.n_dps is not null then return v_nota.n_dps; end if;
  if v_nota.estado <> 'validada' then
    raise exception 'Nota em estado % não pode reservar número (precisa estar validada)', v_nota.estado;
  end if;
  select serie_dps into v_serie from nfse_empresas where cliente_id = v_nota.cliente_id;
  if v_serie is null then raise exception 'Empresa sem configuração de NFS-e'; end if;

  insert into nfse_sequencias (cliente_id, ambiente, serie, ultimo_numero)
  values (v_nota.cliente_id, v_nota.ambiente, v_serie, 1)
  on conflict (cliente_id, ambiente, serie) do update set ultimo_numero = nfse_sequencias.ultimo_numero + 1
  returning ultimo_numero into v_numero;

  update nfse_notas set estado = 'numero_reservado', serie = v_serie, n_dps = v_numero, atualizado_em = now()
  where id = p_nota;
  insert into nfse_eventos (nota_id, estado_de, estado_para, detalhe, usuario)
  values (p_nota, 'validada', 'numero_reservado', format('série %s nº %s', v_serie, v_numero), p_usuario);
  return v_numero;
end $$;

-- Só as functions (service role) podem reservar número
revoke all on function nfse_reservar_numero(uuid, text) from public, anon, authenticated;
grant execute on function nfse_reservar_numero(uuid, text) to service_role;

-- RLS
alter table nfse_empresas enable row level security;
alter table nfse_certificados enable row level security;
alter table nfse_lotes enable row level security;
alter table nfse_recorrentes enable row level security;
alter table nfse_notas enable row level security;
alter table nfse_sequencias enable row level security;
alter table nfse_eventos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['nfse_empresas','nfse_lotes','nfse_recorrentes','nfse_notas','nfse_sequencias','nfse_eventos'] loop
    execute format('drop policy if exists "%s_leitura_autenticado" on %I', t, t);
    execute format('create policy "%s_leitura_autenticado" on %I for select to authenticated using (true)', t, t);
  end loop;
end $$;
-- nfse_certificados: propositalmente SEM política (só service role).
