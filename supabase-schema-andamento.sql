-- ============================================================
-- ANDAMENTO DE OBRIGAÇÕES — Gestor Escritório Contábil
-- Migration aditiva: departamentos/tipos/etapas cadastráveis por cima da
-- tabela "obrigacoes" já existente (checklist mensal simples, usada hoje
-- em src/pages/Empresas.jsx, Overview.jsx, Clientes.jsx e src/store/index.js).
--
-- Não altera nenhuma coluna existente de "obrigacoes" — só adiciona colunas
-- novas e nullable. O fluxo mensal legado (PGDAS, DCTFWeb, eSocial, NFS-e...)
-- continua funcionando sem nenhuma mudança de código. O comportamento novo
-- (timeline com etapas) só se aplica a obrigações criadas com
-- tipo_obrigacao_id preenchido.
--
-- "obrigacoes" e a coluna "tarefas.kanban_status" não têm .sql commitado no
-- repo (foram criadas direto no Supabase antes deste módulo) — as FKs abaixo
-- assumem os nomes de coluna já usados no código (cliente_id, tarefas.id).
-- ============================================================

-- 1) DEPARTAMENTOS (cadastráveis) -----------------------------------
create table if not exists departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  icone text,                          -- emoji, ex: 🧾
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) TIPOS DE OBRIGAÇÃO (template reutilizável) ----------------------
create table if not exists tipos_obrigacao (
  id uuid primary key default gen_random_uuid(),
  departamento_id uuid references departamentos(id),
  nome text not null,                  -- ex: "Rescisão Trabalhista"
  descricao text,
  recorrente boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_tipos_obrigacao_departamento on tipos_obrigacao(departamento_id);

-- 3) ETAPAS DO TEMPLATE (ordem fixa por tipo de obrigação) -----------
create table if not exists etapas_template (
  id uuid primary key default gen_random_uuid(),
  tipo_obrigacao_id uuid not null references tipos_obrigacao(id) on delete cascade,
  nome text not null,
  ordem int not null,
  prazo_dias_relativo int,             -- dias a partir do início, calcula data_prevista
  created_at timestamptz not null default now()
);

create index if not exists idx_etapas_template_tipo on etapas_template(tipo_obrigacao_id, ordem);

-- 4) EXTENSÃO DA TABELA "obrigacoes" JÁ EXISTENTE ---------------------
-- Todas as colunas novas são nullable — nenhum dado/fluxo existente muda.
alter table obrigacoes
  add column if not exists tipo_obrigacao_id uuid references tipos_obrigacao(id),
  add column if not exists departamento_id uuid references departamentos(id),
  add column if not exists titulo text,
  add column if not exists responsavel text,
  add column if not exists task_id uuid references tarefas(id),
  add column if not exists data_inicio date,
  add column if not exists data_conclusao date;

create index if not exists idx_obrigacoes_departamento_status on obrigacoes(departamento_id, status);

-- "tipo" tem uma CHECK constraint em produção (não documentada em nenhum
-- .sql do repo) que trava os valores no enum legado do checklist mensal
-- (PGDAS, DCTFWeb, eSocial...). Processos com etapas usam o título como
-- "tipo" (só pra satisfazer o NOT NULL, ver andamentoApi.js), então precisa
-- abrir essa constraint pra texto livre. Não afeta nenhuma linha existente
-- (constraint só valida na escrita, dado já gravado não é revalidado).
alter table obrigacoes drop constraint if exists obrigacoes_tipo_check;

-- 5) ETAPAS DE UMA OBRIGAÇÃO ESPECÍFICA -------------------------------
create table if not exists etapas_obrigacao (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid not null references obrigacoes(id) on delete cascade,
  etapas_template_id uuid references etapas_template(id),
  nome text not null,                  -- snapshot do template no momento da criação
  ordem int not null,
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluido','atrasado')),
  data_prevista date,
  data_conclusao date,
  responsavel text,
  created_at timestamptz not null default now()
);

create index if not exists idx_etapas_obrigacao_obrigacao on etapas_obrigacao(obrigacao_id, ordem);

-- 6) HISTÓRICO/LOG DE EVENTOS POR OBRIGAÇÃO ---------------------------
create table if not exists historico_obrigacao (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid not null references obrigacoes(id) on delete cascade,
  etapa_obrigacao_id uuid references etapas_obrigacao(id),
  descricao text not null,             -- ex: "Documentação concluída"
  observacao text,                     -- ex: "CCT e ficha de registro anexadas"
  autor text,
  created_at timestamptz not null default now()
);

create index if not exists idx_historico_obrigacao_obrigacao on historico_obrigacao(obrigacao_id, created_at);

-- Sem RLS — mesmo padrão do resto do projeto (sem auth por usuário hoje;
-- ver nota em supabase-schema-contabil.sql). Tabelas novas neste projeto
-- Supabase nascem com RLS ativado por padrão, então desliga explicitamente
-- (senão a anon key do app nem consegue ler/escrever).
alter table departamentos       disable row level security;
alter table tipos_obrigacao     disable row level security;
alter table etapas_template     disable row level security;
alter table etapas_obrigacao    disable row level security;
alter table historico_obrigacao disable row level security;

-- ============================================================
-- SEED — departamentos + 2 tipos de obrigação de exemplo com etapas
-- Nomes dos departamentos batem com o que já está hardcoded em
-- Empresas.jsx (DEPTS_DEFAULT), pra não mudar nada visualmente.
-- ============================================================

insert into departamentos (nome, icone, ordem) values
  ('Fiscal',     '🧾', 1),
  ('Folha',      '👥', 2),
  ('Societário', '💼', 3),
  ('Contábil',   '🧮', 4),
  ('Escritório', '🏠', 5)
on conflict (nome) do nothing;

do $$
declare
  v_dept_folha uuid;
  v_dept_fiscal uuid;
  v_tipo_rescisao uuid;
  v_tipo_efd uuid;
begin
  select id into v_dept_folha  from departamentos where nome = 'Folha';
  select id into v_dept_fiscal from departamentos where nome = 'Fiscal';

  insert into tipos_obrigacao (departamento_id, nome, descricao, recorrente)
  values (v_dept_folha, 'Rescisão Trabalhista', 'Processo completo de rescisão, do pedido até a entrega dos documentos.', false)
  returning id into v_tipo_rescisao;

  insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values
    (v_tipo_rescisao, 'Solicitação',        1, 0),
    (v_tipo_rescisao, 'Documentação',       2, 2),
    (v_tipo_rescisao, 'Cálculo/eSocial',    3, 5),
    (v_tipo_rescisao, 'Homologação',        4, 8),
    (v_tipo_rescisao, 'Entrega',            5, 10);

  insert into tipos_obrigacao (departamento_id, nome, descricao, recorrente)
  values (v_dept_fiscal, 'EFD-Contribuições', 'Apuração e transmissão da EFD-Contribuições.', true)
  returning id into v_tipo_efd;

  insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values
    (v_tipo_efd, 'Apuração',       1, 0),
    (v_tipo_efd, 'Geração TXT',    2, 3),
    (v_tipo_efd, 'Validação',      3, 5),
    (v_tipo_efd, 'Transmissão',    4, 7);
end $$;
