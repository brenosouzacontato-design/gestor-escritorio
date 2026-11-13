-- supabase-schema-painel-documentos.sql
--
-- Documentos avulsos no painel do cliente (seção "Documentos"): arquivos que
-- não são de nenhuma obrigação nem tarefa (contrato social, alvará, recibos,
-- relatórios...). Ficam na mesma tabela "documentos", marcados para o painel.
--
--   painel_visivel     aparece na seção "Documentos" do painel
--   painel_competencia "MM/AAAA" = só nessa competência; null = fixo (todos os meses)
--   painel_titulo      nome mostrado ao cliente (em branco, usa o nome do arquivo)
--
-- Rodar uma vez no SQL Editor do Supabase. Pode rodar de novo sem problema.

alter table documentos add column if not exists painel_visivel boolean not null default false;
alter table documentos add column if not exists painel_competencia text;
alter table documentos add column if not exists painel_titulo text;

create index if not exists idx_documentos_painel on documentos(cliente_id) where painel_visivel;
