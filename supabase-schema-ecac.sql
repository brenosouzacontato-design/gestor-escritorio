-- ============================================================
-- ROBÔ DO e-CAC — Gestor Escritório Contábil
-- O robô do servidor 24h (deploy/robo-parcelamentos/ecac.py) entra no e-CAC
-- com o certificado A1 do escritório, troca o perfil para cada empresa
-- (procuração) e:
--   1. baixa o Relatório de Situação Fiscal → mesma leitura por IA do upload
--      manual (netlify/functions/extrair-situacao-fiscal.js) → situacao_fiscal_rfb;
--   2. consulta os pagamentos (DARF/DAS) → ecac_pagamentos, e cruza com as
--      guias anexadas em `documentos`: a que bater recebe pago_em
--      (baixa_por = 'robô e-CAC').
-- Tela: Fiscal → Situação e-CAC (src/pages/ecac/EcacPage.jsx).
--
-- Segurança (docs/seguranca-rls.md): RLS ligado, só o escritório lê/grava;
-- o robô usa a service key. Seguro rodar mais de uma vez.
-- ============================================================

-- Uma linha por empresa: se o robô consulta e como foi a última consulta.
create table if not exists ecac_empresas (
  cliente_id          uuid primary key references clientes(id) on delete cascade,
  monitorar           boolean not null default true,   -- false = o robô pula a empresa
  status              text check (status in ('ok', 'erro', 'sem_procuracao', 'aguardando_captcha')),
  mensagem            text,
  ultima_consulta_em  timestamptz,
  situacao_em         timestamptz,                     -- último relatório de situação fiscal baixado
  pagamentos_em       timestamptz,                     -- última consulta de pagamentos
  atualizado_em       timestamptz not null default now()
);

-- Pagamentos achados no e-CAC (Consulta Comprovante de Pagamento).
create table if not exists ecac_pagamentos (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references clientes(id) on delete cascade,
  numero_documento   text not null,                    -- só dígitos
  tipo_documento     text,                             -- DARF, DAS, DAE...
  codigo_receita     text,
  descricao_receita  text,
  periodo_apuracao   text,
  data_arrecadacao   date,
  data_vencimento    date,
  valor_total        numeric(14,2),
  dados              jsonb,                            -- linha original da tabela do e-CAC
  guia_id            uuid references documentos(id) on delete set null,  -- guia que bateu
  como_cruzou        text check (como_cruzou in ('numero_documento', 'valor_vencimento')),
  capturado_em       timestamptz not null default now(),
  unique (cliente_id, numero_documento)
);

create index if not exists idx_ecac_pagamentos_cliente
  on ecac_pagamentos(cliente_id, data_arrecadacao desc);
create index if not exists idx_ecac_pagamentos_guia on ecac_pagamentos(guia_id);

alter table ecac_empresas enable row level security;
alter table ecac_pagamentos enable row level security;

drop policy if exists ecac_empresas_escritorio on ecac_empresas;
drop policy if exists ecac_pagamentos_escritorio on ecac_pagamentos;
do $$
declare
  cond text := 'true';  -- antes do passo 1 do RLS: qualquer login do gestor
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    cond := '(select is_escritorio())';
  end if;
  execute format('create policy ecac_empresas_escritorio on ecac_empresas for all to authenticated using (%s) with check (%s)', cond, cond);
  execute format('create policy ecac_pagamentos_escritorio on ecac_pagamentos for all to authenticated using (%s) with check (%s)', cond, cond);
end $$;
