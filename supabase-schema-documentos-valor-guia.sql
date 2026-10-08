-- ============================================================
-- VALOR DA GUIA NOS DOCUMENTOS — Gestor Escritório Contábil
-- Valor total a recolher e vencimento lidos por IA do PDF da guia anexada
-- (netlify/functions/extrair-valor-guia.js), mostrados na nova versão do
-- painel do cliente (PainelCompartilhadoPage.jsx) no lugar de "valor na
-- guia". valor_guia_extraido_em marca que o documento já foi lido (mesmo
-- quando não achou valor), pra IA não ser chamada de novo a cada acesso.
-- ============================================================

alter table documentos
  add column if not exists valor_guia numeric(14,2),
  add column if not exists vencimento_guia date,
  add column if not exists valor_guia_extraido_em timestamptz;
