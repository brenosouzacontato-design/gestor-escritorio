-- ============================================================
-- CENTRAL DE ENTREGAS — "viu no painel"
-- Quando o cliente abre o painel, as guias já entregues a ele ganham
-- visto_em (netlify/functions/painel-evento.js); a Central de Entregas
-- mostra "Viu no painel" entre "Entregue" e "Aberta pelo cliente" (baixou a
-- guia ou copiou o PIX/código de barras). Rode depois de
-- supabase-schema-central-entregas.sql. Aditivo e seguro rodar de novo.
-- ============================================================

alter table documentos
  add column if not exists visto_em timestamptz;  -- 1ª vez que o cliente abriu o painel depois da entrega
