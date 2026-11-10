-- ============================================================
-- ADMISSÃO DE FUNCIONÁRIOS — Gestor Escritório Contábil
-- O escritório gera um link (Clientes → Admissões) e manda ao candidato pelo
-- WhatsApp. O candidato abre ?admissao=<token> (src/pages/admissao), preenche
-- a ficha, fotografa os documentos e envia; recebe o resumo no WhatsApp.
-- Tudo do lado do candidato passa por netlify/functions/admissao.js (service
-- key, confere o token). Arquivos no bucket documentos, em admissoes/<id>/.
--
-- Segurança (docs/seguranca-rls.md): RLS ligado, só o escritório lê/grava
-- direto. Aditivo e seguro rodar mais de uma vez.
-- ============================================================

create table if not exists admissoes (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          uuid not null references clientes(id) on delete cascade,  -- empresa que contrata
  token               text not null unique,                                     -- vai no link do candidato
  status              text not null default 'aguardando'
                      check (status in ('aguardando', 'preenchendo', 'enviada', 'devolvida', 'concluida', 'cancelada')),
  -- preenchido pelo escritório ao gerar o link
  nome_previsto       text not null,
  telefone            text,
  cargo               text,
  salario             numeric(14,2),
  data_admissao       date,
  jornada             text,
  observacao_interna  text,
  -- preenchido pelo candidato
  dados               jsonb not null default '{}'::jsonb,   -- campos de admissaoCampos.json + dependentes[]
  documentos          jsonb not null default '[]'::jsonb,   -- [{ tipo, path, nome, mime, tamanho, em }]
  enviado_em          timestamptz,
  motivo_devolucao    text,
  -- WhatsApp
  link_enviado_em     timestamptz,
  whatsapp_enviado_em timestamptz,                          -- resumo entregue ao funcionário
  whatsapp_erro       text,
  expira_em           timestamptz not null default (now() + interval '30 days'),
  concluida_em        timestamptz,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);
create index if not exists idx_admissoes_cliente on admissoes(cliente_id, criado_em desc);
create index if not exists idx_admissoes_status on admissoes(status, criado_em desc);

alter table admissoes enable row level security;
drop policy if exists admissoes_escritorio on admissoes;
do $$
declare
  cond text := 'true';  -- antes do passo 1 do RLS: qualquer login do gestor
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    cond := '(select is_escritorio())';
  end if;
  execute format('create policy admissoes_escritorio on admissoes for all to authenticated using (%s) with check (%s)', cond, cond);
end $$;
