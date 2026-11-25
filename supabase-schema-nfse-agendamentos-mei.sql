-- Emissão agendada também para MEI (Emissor Nacional, docs/nfse-mei.md). Rodar DEPOIS de
-- supabase-schema-nfse-agendamentos.sql e supabase-schema-nfse-mei.sql.
-- Agendamento MEI (tipo 'mei'): na hora marcada o robô nfse-agendamentos-cron põe a nota na fila do robô
-- MEI (nfse_mei_notas, 'na_fila'), como o botão Emitir da tela NFS-e MEI; o robô MEI emite no portal e manda
-- o PDF no WhatsApp do cliente.
--   mei_modelo_id  o modelo MEI (no lugar de recorrente_id, que fica vazio)
--   mei_nota_id    a nota que entrou na fila do robô MEI
--   data_servico   a competência da nota MEI;  periodo  o dia 1º do mês da competência
-- Idempotente.

alter table nfse_agendamentos alter column recorrente_id drop not null;
alter table nfse_agendamentos add column if not exists mei_modelo_id uuid references nfse_mei_modelos(id) on delete cascade;
alter table nfse_agendamentos add column if not exists mei_nota_id uuid references nfse_mei_notas(id) on delete set null;

alter table nfse_agendamentos drop constraint if exists nfse_agendamentos_tipo_check;
alter table nfse_agendamentos add constraint nfse_agendamentos_tipo_check check (tipo in ('periodo','avulsa','mei'));

-- cada agendamento é de um modelo: recorrente (gestor) ou MEI
alter table nfse_agendamentos drop constraint if exists nfse_agendamentos_modelo_check;
alter table nfse_agendamentos add constraint nfse_agendamentos_modelo_check check (
  (tipo = 'mei' and mei_modelo_id is not null and recorrente_id is null)
  or (tipo <> 'mei' and recorrente_id is not null and mei_modelo_id is null));

create index if not exists nfse_agendamentos_mei_modelo_idx on nfse_agendamentos (mei_modelo_id);
