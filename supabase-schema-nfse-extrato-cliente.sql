-- Pedir ao cliente que diga quem pagou um PIX do extrato (Emitir NFS-e → Emitir pelo extrato →
-- "Precisam de você" → Pedir ao cliente). O pedido aparece no painel do cliente e no link "todas as
-- notas"; a resposta volta para a conferência do extrato já preenchida.
--   pedido_cliente_em  quando o escritório pediu (null = não pedido)
--   resposta_cliente   { nome, cpf, observacao } ou { nao_servico: true, observacao }
--   respondido_em      quando o cliente respondeu
-- Depende de supabase-schema-nfse-extrato.sql. Ver netlify/functions/lib/nfse/extrato.js.
-- Rodar no SQL Editor do Supabase. Idempotente.

alter table nfse_extrato_lancamentos add column if not exists pedido_cliente_em timestamptz;
alter table nfse_extrato_lancamentos add column if not exists resposta_cliente jsonb;
alter table nfse_extrato_lancamentos add column if not exists respondido_em timestamptz;
create index if not exists nfse_extrato_lancamentos_pedidos_idx on nfse_extrato_lancamentos (cliente_id) where pedido_cliente_em is not null;
