-- ============================================================
-- ANEXOS DE CND ESTADUAL/MUNICIPAL — Gestor Escritório Contábil
-- Complementa a marcação manual (Regular/Pendente) já existente em
-- cnd_manual com o PDF da própria certidão, pra guardar a prova junto
-- do status e permitir baixar tanto no modal de Empresas quanto na aba
-- CND do painel público do cliente. Mesmo bucket 'documentos' já usado
-- pelo resto do app — sem tabela/bucket novo.
-- ============================================================

alter table cnd_manual
  add column if not exists anexo_estadual_path text,
  add column if not exists anexo_estadual_nome text,
  add column if not exists anexo_municipal_path text,
  add column if not exists anexo_municipal_nome text;
