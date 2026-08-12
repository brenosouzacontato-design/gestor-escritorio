-- ============================================================
-- HONORÁRIOS — Gestor Escritório Contábil
-- Cobrança mensal recorrente por cliente, com lembrete automático de
-- WhatsApp (direto pro celular do cliente, não pro grupo interno) trazendo
-- a chave PIX do escritório quando o honorário vence e ainda está pendente.
-- ============================================================

-- 1) Valor padrão + dia de vencimento por cliente — usados por
-- gerarHonorariosDoMes (honorariosApi.js) pra criar a cobrança do mês sem
-- precisar redigitar valor/data pra cada cliente todo mês. Nulos = cliente
-- ainda não configurado pra cobrança automática (fica de fora da geração).
alter table clientes
  add column if not exists valor_honorario numeric(10,2),
  add column if not exists dia_vencimento_honorario int check (dia_vencimento_honorario between 1 and 28);

-- 2) Cobrança em si, uma linha por cliente por competência — mesmo modelo
-- de "upsert substitui" já usado em dados_gerenciais_simples/situacao_fiscal_rfb.
create table if not exists honorarios (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  competencia text not null,                 -- "MM/YYYY"
  valor numeric(10,2) not null,
  vencimento date not null,
  status text not null default 'pendente' check (status in ('pendente', 'pago')),
  data_pagamento date,
  lembrete_enviado_em timestamptz,            -- controla o lembrete automático: só dispara uma vez por competência
  created_at timestamptz not null default now()
);

create unique index if not exists idx_honorarios_cliente_competencia
  on honorarios(cliente_id, competencia);

-- honorarios-cron.js varre por status=pendente + vencimento=hoje +
-- lembrete_enviado_em nulo a cada execução — índice parcial cobre exatamente
-- essa consulta (mesmo padrão do idx_lembretes_pendentes em lembretes).
create index if not exists idx_honorarios_pendentes
  on honorarios(vencimento) where status = 'pendente' and lembrete_enviado_em is null;

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table honorarios disable row level security;

-- 3) Configuração da chave PIX do escritório (chave/valor genérico já
-- usado pra tokens do OneFlow) — lida por honorariosLembrete.js ao montar
-- a mensagem do lembrete.
--   chave 'honorarios_pix_chave'      -> a chave PIX em si
--   chave 'honorarios_pix_favorecido' -> nome do favorecido (aparece na mensagem)
