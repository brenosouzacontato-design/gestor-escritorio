-- ============================================================
-- ROBÔ DE EMISSÃO DA NF-e DE VENDA — Gestor Escritório Contábil
-- Fila do robô do Emissor (deploy/robo-parcelamentos/emissor.py) dentro dos
-- pedidos de NF-e (supabase-schema-nfe-solicitacoes.sql). O escritório
-- confere o pedido e toca "Emitir pelo robô" (Fiscal → Pedidos de NF-e):
-- robo_status = 'na_fila'. O robô pega, preenche e transmite no Emissor,
-- grava a nota (nfe_numero, nfe_chave, PDF/XML no bucket documentos) e manda
-- o PDF/XML ao cliente pelo WhatsApp.
-- Aditivo: só colunas novas; seguro rodar mais de uma vez.
-- ============================================================

alter table nfe_solicitacoes
  add column if not exists robo_status text
    check (robo_status in ('na_fila', 'processando', 'aguardando_pessoa', 'ok', 'erro')),
  add column if not exists robo_mensagem text,       -- o que o robô fez/onde parou
  add column if not exists robo_em timestamptz,      -- última mudança do robô
  add column if not exists robo_tentativas integer not null default 0;

create index if not exists idx_nfe_solicitacoes_robo on nfe_solicitacoes(robo_status) where robo_status is not null;
