-- Notas recorrentes semanais (Emitir NFS-e → Notas recorrentes). Ex.: ponto de coleta que emite toda
-- semana para a Shopee: mesmo tomador (CNPJ), mesma descrição e serviço; só o valor muda.
-- A tabela nfse_recorrentes (supabase-schema-nfse.sql) nasceu para nota mensal com CPF e valor fixo
-- e nunca foi usada; aqui ela passa a aceitar:
--   cpf            CPF (11 dígitos) ou CNPJ (14) do tomador
--   valor          opcional (sugestão; o valor de cada semana é digitado na hora de emitir)
--   periodicidade  'mensal' | 'semanal'   (semana de segunda a domingo)
--   inicio         segunda-feira da primeira semana a emitir
--   puladas        semanas sem serviço (segunda-feira de cada uma), saem de "a emitir"
-- Ver netlify/functions/lib/nfse/recorrentes.js e as ações recorrente_* de netlify/functions/nfse.js.
-- Rodar no SQL Editor do Supabase. Idempotente.

alter table nfse_recorrentes drop constraint if exists nfse_recorrentes_cpf_check;
alter table nfse_recorrentes add constraint nfse_recorrentes_cpf_check check (cpf ~ '^(\d{11}|\d{14})$');
alter table nfse_recorrentes alter column valor drop not null;
alter table nfse_recorrentes drop constraint if exists nfse_recorrentes_valor_check;
alter table nfse_recorrentes add constraint nfse_recorrentes_valor_check check (valor is null or valor > 0);
alter table nfse_recorrentes alter column dia_mes drop not null;
alter table nfse_recorrentes add column if not exists periodicidade text not null default 'mensal';
alter table nfse_recorrentes drop constraint if exists nfse_recorrentes_periodicidade_check;
alter table nfse_recorrentes add constraint nfse_recorrentes_periodicidade_check check (periodicidade in ('mensal', 'semanal'));
alter table nfse_recorrentes add column if not exists inicio date;
alter table nfse_recorrentes add column if not exists puladas jsonb not null default '[]'::jsonb;
create index if not exists nfse_notas_recorrente_idx on nfse_notas (recorrente_id) where recorrente_id is not null;
