-- ============================================================
-- FILA DE TAREFAS DO ROBÔ DO ONEFLOW — Gestor Escritório Contábil
-- ============================================================
-- O gestor pede ("Relatório da folha" na tela Fechamentos ERP) e o robô do
-- servidor (deploy/robo-parcelamentos/oneflow.py) executa na tela web do
-- OneFlow o que a API dele não oferece. A tarefa vai de 'na_fila' para
-- 'processando' e termina em 'ok' (PDF no bucket "documentos") ou 'erro'.
-- 'aguardando_pessoa' = o robô pediu login/captcha pela tela remota.
--
-- Por enquanto só existe o tipo 'relatorio_folha'. Tipos novos (13º, FGTS,
-- apuração do Simples...) entram no check de "tipo" e num roteiro novo em
-- /dados/oneflow/ no servidor — ver docs/robo-oneflow.md.
--
-- Acesso: RLS ligado e SEM policy (só service role). A tela lê e grava pela
-- function netlify/functions/tarefas-robo.js, que exige o login do escritório.
-- Aditivo e seguro rodar mais de uma vez.
-- ============================================================

create table if not exists tarefas_robo (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('relatorio_folha')),
  cliente_id uuid not null references clientes(id) on delete cascade,
  competencia text not null check (competencia ~ '^(0[1-9]|1[0-2])/\d{4}$'),  -- MM/AAAA, como no FechamentosERP
  parametros jsonb not null default '{}'::jsonb,
  -- na_fila → processando → (aguardando_pessoa) → ok | erro ; cancelada = desistiu antes de o robô pegar
  status text not null default 'na_fila'
    check (status in ('na_fila', 'processando', 'aguardando_pessoa', 'ok', 'erro', 'cancelada')),
  robo_mensagem text,           -- o que o robô fez / onde parou
  robo_em timestamptz,          -- última mudança feita pelo robô
  tentativas integer not null default 0,
  arquivo_path text,            -- PDF no bucket "documentos" (tarefas-robo/<id>.pdf)
  arquivo_nome text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists tarefas_robo_fila_idx on tarefas_robo (criado_em) where status = 'na_fila';
create index if not exists tarefas_robo_cliente_idx on tarefas_robo (cliente_id, competencia, tipo, criado_em desc);

-- Uma tarefa em andamento por empresa/competência/tipo: clicar duas vezes não
-- gera dois relatórios.
create unique index if not exists tarefas_robo_uma_ativa_idx
  on tarefas_robo (tipo, cliente_id, competencia)
  where status in ('na_fila', 'processando', 'aguardando_pessoa');

alter table tarefas_robo enable row level security;  -- sem policy: só service role (function + robô)
