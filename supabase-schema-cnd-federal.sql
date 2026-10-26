-- ============================================================
-- CND FEDERAL + VALIDADE DAS CERTIDÕES — Gestor Escritório Contábil
-- O envio da Situação Fiscal (Empresas → "Situação Fiscal / CND") também
-- aceita as certidões: a IA identifica se é CND federal, estadual ou
-- municipal, marca a esfera como regular/pendente e guarda o PDF pro
-- cliente baixar no painel. Estadual/municipal já tinham colunas; aqui
-- entra a federal e a data de validade das três.
-- Rodar uma vez no SQL Editor do Supabase. Não apaga nada.
-- ============================================================

alter table cnd_manual
  add column if not exists situacao_federal text check (situacao_federal in ('regular','pendente')),
  add column if not exists anexo_federal_path text,
  add column if not exists anexo_federal_nome text,
  add column if not exists validade_federal date,
  add column if not exists validade_estadual date,
  add column if not exists validade_municipal date;
