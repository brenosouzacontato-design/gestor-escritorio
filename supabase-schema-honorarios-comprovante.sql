-- ============================================================
-- HONORÁRIOS PAGOS POR COMPROVANTE — Gestor Escritório Contábil
-- O comprovante que chega no WhatsApp (grupos "Pagamentos" e "Documentos")
-- também pode ser o cliente pagando o honorário do escritório. A IA
-- (netlify/functions/lib/comprovantePagamento.js) aponta o honorário e, com
-- confiança alta e valor compatível, marca como pago; senão fica na tela
-- Pagamentos → A conferir, onde dá pra escolher o honorário e dar a baixa.
-- Sem este script o fluxo funciona, só não guarda o comprovante no honorário.
-- Seguro rodar mais de uma vez.
-- ============================================================

alter table honorarios
  add column if not exists valor_pago       numeric(14,2),
  add column if not exists comprovante_path text,          -- arquivo no bucket "documentos"
  add column if not exists comprovante_nome text,
  add column if not exists baixa_por        text;          -- 'automática (IA)' ou e-mail de quem deu a baixa

alter table comprovantes_pagamento
  add column if not exists honorario_id          uuid references honorarios(id) on delete set null,  -- honorário que recebeu a baixa
  add column if not exists honorario_sugerido_id uuid references honorarios(id) on delete set null;  -- o que a IA apontou

-- Recarrega o cache de schema do PostgREST (colunas novas visíveis na hora)
notify pgrst, 'reload schema';
