-- ============================================================
-- CLIENTES — Informações complementares — Gestor Escritório Contábil
-- ============================================================

-- Campo livre pra anotações que não têm campo próprio (ex: nome fantasia
-- diferente da razão social, particularidades do contrato, observações
-- do cadastro) — editável no modal de Empresas/Clientes.
alter table clientes
  add column if not exists observacoes text;
