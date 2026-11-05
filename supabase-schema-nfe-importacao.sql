-- ============================================================
-- IMPORTAR CADASTROS DO EMISSOR — Gestor Escritório Contábil
-- O escritório toca "Importar do Emissor" (Fiscal → Pedidos de NF-e) e o
-- robô (deploy/robo-parcelamentos/emissor_importar.py) entra na empresa no
-- Emissor e copia os clientes e produtos de lá para o app de pedido de NF-e
-- (nfe_destinatarios e nfe_produtos, supabase-schema-nfe-solicitacoes.sql).
-- Só acrescenta: o que já existe no app não é apagado, só completa campos vazios.
-- Aditivo: só colunas novas; seguro rodar mais de uma vez.
-- ============================================================

alter table clientes
  add column if not exists emissor_importacao_status text
    check (emissor_importacao_status in ('na_fila', 'processando', 'ok', 'erro')),
  add column if not exists emissor_importacao_msg text,      -- resultado ("9 clientes e 6 produtos") ou o erro
  add column if not exists emissor_importacao_em timestamptz;

create index if not exists idx_clientes_emissor_importacao
  on clientes(emissor_importacao_status) where emissor_importacao_status = 'na_fila';
