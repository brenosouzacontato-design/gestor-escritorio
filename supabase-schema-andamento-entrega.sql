-- Marca "entregue / a entregar" — distinto de "concluído": uma obrigação ou
-- tarefa pode estar com o trabalho pronto mas ainda não entregue ao cliente.
-- Aditivo, nullable/default, não muda nada existente.
alter table tarefas    add column if not exists entregue boolean not null default false;
alter table obrigacoes add column if not exists entregue boolean not null default false;
