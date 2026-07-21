-- ============================================================
-- MÓDULO CONTÁBIL — Observação do cliente
-- Coluna pra guardar o que o cliente escreveu ao identificar um
-- lançamento pendente pela página pública de identificação
-- (?identificar=1&empresa=...), sem precisar logar no sistema.
-- ============================================================

alter table lancamentos_contabeis
  add column if not exists observacao_cliente text;
