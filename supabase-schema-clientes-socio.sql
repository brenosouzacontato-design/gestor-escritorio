-- ============================================================
-- CLIENTES — Nome do sócio (assinatura) — Gestor Escritório Contábil
-- ============================================================

-- Nome de quem assina pelo cliente no Comprovante de Faturamento (ver
-- src/pages/painel/ComprovanteFaturamentoPage.jsx) — separado de
-- "responsavel" (contato geral do cliente, nem sempre é quem assina)
-- porque esse aqui precisa ser especificamente o nome que vai impresso
-- na linha de assinatura do sócio.
alter table clientes
  add column if not exists socio_nome text;
