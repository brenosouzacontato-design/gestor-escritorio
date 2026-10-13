-- ============================================================
-- RESPONSÁVEL DA TAREFA — Gestor Escritório Contábil
-- "Atribuir a" (Empresas.jsx / modaisObrigacao.jsx): nome livre de quem
-- cuida da tarefa/obrigação. O valor "Cliente" (src/lib/responsavel.js)
-- marca o item como pendência do próprio cliente — enquanto estiver
-- pendente, ele aparece no painel compartilhado em "Suas tarefas".
-- obrigacoes.responsavel já existe (supabase-schema-andamento.sql); aqui
-- só falta a coluna equivalente em tarefas.
-- ============================================================

alter table tarefas
  add column if not exists responsavel text;
