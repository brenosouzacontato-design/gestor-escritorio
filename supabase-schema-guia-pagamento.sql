-- ============================================================
-- PAGAMENTO DA GUIA — Gestor Escritório Contábil
-- Status "paga" das guias de imposto anexadas (documentos ligados a uma
-- obrigação). Preenchido automaticamente quando um comprovante de pagamento
-- chega no grupo "Documentos" do WhatsApp e a IA identifica a guia
-- (netlify/functions/lib/comprovantePagamento.js), ou na mão pelo modo de
-- edição do painel (PainelCompartilhadoPage.jsx). O painel do cliente mostra
-- a guia como paga e oferece o comprovante pra download.
-- ============================================================

alter table documentos
  add column if not exists pago_em timestamptz,        -- quando foi pago (data do comprovante) — null = em aberto
  add column if not exists valor_pago numeric(14,2),   -- valor lido do comprovante
  add column if not exists comprovante_path text,      -- arquivo do comprovante no bucket "documentos"
  add column if not exists comprovante_nome text;
