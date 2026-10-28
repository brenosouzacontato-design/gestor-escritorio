-- ============================================================
-- NFS-e — conferência de "Complementar?" / "Já emitida" — Gestor Escritório Contábil
-- duplicidade_liberada: o escritório (ou o cliente no painel) conferiu que NÃO é complementar
--   nem a mesma nota (outro serviço para o mesmo paciente): a nota sai pelo valor cheio.
-- ciente_em: a nota já tinha sido emitida e o cliente marcou ciência no painel: ela sai do
--   painel dele (continua no lote do escritório, marcada).
-- Rodar uma vez no SQL Editor do Supabase. Não apaga nada.
-- ============================================================

alter table nfse_notas
  add column if not exists duplicidade_liberada boolean not null default false,
  add column if not exists ciente_em timestamptz;
