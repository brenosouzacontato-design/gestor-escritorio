-- NFS-e: estado "cancelada" (cancelamento feito no portal nacional, registrado no gestor).
-- A nota cancelada sai do painel do cliente, dos totais do lote e da trava de duplicidade.
-- Pode rodar mais de uma vez.

alter table nfse_notas drop constraint if exists nfse_notas_estado_check;
alter table nfse_notas add constraint nfse_notas_estado_check
  check (estado in ('importada','validada','numero_reservado','enviada','autorizada','rejeitada','indeterminada','cancelada'));
