-- ============================================================
-- MÓDULO CONTÁBIL — Conciliação de extrato
-- Adiciona rastreio de conciliação e evita duplicar transações
-- reimportadas do mesmo extrato.
-- ============================================================

-- 1) Status de conciliação -------------------------------------------
-- Lançamentos manuais já nascem classificados (true). Lançamentos vindos
-- de importação de extrato nascem false quando caem em "Valores a
-- Identificar" (sem conta escolhida no momento da importação).
alter table lancamentos_contabeis
  add column if not exists conciliado boolean not null default true;

create index if not exists idx_lancamentos_conciliado
  on lancamentos_contabeis(empresa_id, conciliado);

-- 2) Evita duplicar a mesma transação em reimportações ----------------
-- extrato_referencia já existia na tabela (era só nunca preenchida).
-- Esse índice único garante que reimportar o mesmo PDF (ou um período
-- sobreposto) não gere lançamentos repetidos.
-- Sem WHERE (não-parcial): o ON CONFLICT do PostgREST só infere índices
-- únicos "cheios" — um índice parcial não é reconhecido e dá erro
-- "no unique or exclusion constraint matching". NULL não conflita com
-- NULL em índice único, então lançamentos manuais (extrato_referencia
-- nulo) continuam sem restrição nenhuma entre si.
create unique index if not exists idx_lancamentos_extrato_ref
  on lancamentos_contabeis(empresa_id, extrato_referencia);
