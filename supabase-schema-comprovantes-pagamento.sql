-- ============================================================
-- BAIXA DE PAGAMENTOS — Gestor Escritório Contábil
-- Fila de comprovantes de pagamento + auditoria da baixa das guias.
--
-- Fluxo (ver src/pages/pagamentos/PagamentosPage.jsx):
--   1. comprovante enviado no grupo "Pagamentos" do WhatsApp
--      (netlify/functions/whatsapp-webhook.js) entra em comprovantes_pagamento
--      com o que a IA leu (pagador, CNPJ, valor, data, descrição) e a empresa/
--      guia que ela conseguiu identificar (lib/comprovantePagamento.js);
--   2. se bateu empresa, tributo e valor com segurança, a baixa já é feita
--      (status 'baixado', baixa_automatica = true);
--   3. senão fica 'pendente' na tela Pagamentos: o escritório escolhe a
--      empresa, vê só as guias anexadas dela ainda sem pagamento e dá a baixa
--      (ou descarta o arquivo, com motivo).
-- Baixa manual sem comprovante (tela Pagamentos → Baixa manual, ou modo de
-- edição do painel) exige justificativa — fica em documentos.baixa_justificativa.
--
-- Segurança (docs/seguranca-rls.md): comprovantes_pagamento nasce com RLS
-- ligado e só o escritório lê/grava; o webhook usa a service key.
-- Seguro rodar mais de uma vez.
-- ============================================================

create table if not exists comprovantes_pagamento (
  id                 uuid primary key default gen_random_uuid(),
  origem             text not null default 'whatsapp' check (origem in ('whatsapp', 'upload')),
  remetente          text,                         -- quem mandou no grupo
  nome_arquivo       text not null,
  storage_path       text not null,                -- arquivo no bucket "documentos"
  tipo_mime          text,
  -- lido do comprovante pela IA
  eh_comprovante     boolean,                      -- false = a IA achou que não é comprovante de pagamento
  pagador_nome       text,
  pagador_documento  text,                         -- CNPJ/CPF do pagador/contribuinte
  valor_pago         numeric(14,2),
  data_pagamento     date,
  descricao          text,                         -- tributo / beneficiário / descrição do pagamento
  banco              text,
  observacao_ia      text,
  confianca          text,
  -- identificação
  cliente_id         uuid references clientes(id) on delete set null,
  guia_sugerida_id   uuid references documentos(id) on delete set null,
  -- resultado
  status             text not null default 'pendente' check (status in ('pendente', 'baixado', 'descartado')),
  guia_id            uuid references documentos(id) on delete set null,   -- guia que recebeu a baixa
  baixa_automatica   boolean not null default false,
  justificativa      text,                         -- obrigatória quando o valor não bate com a guia
  motivo_descarte    text,
  resolvido_por      text,                         -- e-mail de quem deu a baixa/descartou
  resolvido_em       timestamptz,
  criado_em          timestamptz not null default now()
);

create index if not exists idx_comprovantes_pagamento_status
  on comprovantes_pagamento(status, criado_em desc);

alter table comprovantes_pagamento enable row level security;

drop policy if exists comprovantes_pagamento_escritorio on comprovantes_pagamento;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    execute 'create policy comprovantes_pagamento_escritorio on comprovantes_pagamento for all to authenticated
             using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    -- antes do passo 1 do RLS: qualquer login do gestor (não há cadastro público)
    execute 'create policy comprovantes_pagamento_escritorio on comprovantes_pagamento for all to authenticated
             using (true) with check (true)';
  end if;
end $$;

-- Auditoria da baixa na própria guia (documentos já tem pago_em, valor_pago,
-- comprovante_path, comprovante_nome — supabase-schema-guia-pagamento.sql).
alter table documentos
  add column if not exists baixa_manual        boolean not null default false,  -- baixa sem comprovante
  add column if not exists baixa_justificativa text,
  add column if not exists baixa_por           text,                            -- e-mail de quem deu a baixa ('automática' = IA)
  add column if not exists baixa_registrada_em timestamptz;                     -- quando a baixa foi lançada (pago_em = data do pagamento)
