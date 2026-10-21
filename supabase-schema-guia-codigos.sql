-- ============================================================
-- CÓDIGOS DE PAGAMENTO DA GUIA — Gestor Escritório Contábil
-- Código de barras (linha digitável) e PIX copia e cola das guias anexadas,
-- pros botões "copiar" do painel do cliente (PainelCompartilhadoPage.jsx).
-- Lidos no navegador (texto do PDF + QR code da guia) e gravados por
-- netlify/functions/painel-codigos-guia.js só depois de conferidos pelos
-- dígitos verificadores / CRC do próprio código.
-- ============================================================

alter table documentos
  add column if not exists linha_digitavel text,             -- só os dígitos (47 boleto / 48 arrecadação)
  add column if not exists pix_copia_cola text,              -- payload do QR code PIX da guia
  add column if not exists codigos_extraidos_em timestamptz; -- marca a leitura (mesmo sem achar nada) — lida uma vez só
