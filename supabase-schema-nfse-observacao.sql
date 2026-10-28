-- Observação do cliente na nota ainda não emitida (link "todas as notas" / painel).
-- O cliente escreve; o escritório lê na tela de emissão. Não vai para a NFS-e.
alter table nfse_notas add column if not exists observacao_cliente text not null default '';
