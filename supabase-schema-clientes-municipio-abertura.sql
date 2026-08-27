-- ============================================================
-- CLIENTES — Município + Data de Abertura — Gestor Escritório Contábil
-- ============================================================

-- Usados no Comprovante de Faturamento (ver
-- src/pages/painel/ComprovanteFaturamentoPage.jsx) — preenchidos
-- automaticamente pela IA quando extrai a Declaração do Simples Nacional
-- (extrair-declaracao-simples.js), só quando o documento traz essa
-- informação e o cliente ainda não tem valor preenchido (nunca sobrescreve
-- o que já estava lá).
alter table clientes
  add column if not exists municipio text,
  add column if not exists data_abertura date;
