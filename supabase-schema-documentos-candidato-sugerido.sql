-- ============================================================
-- CANDIDATO SUGERIDO PELA IA — Gestor Escritório Contábil
-- A sugestão de "dar baixa em qual candidato" (etapas_obrigacao ou
-- tarefas) que a IA aponta em identificar-documento.js hoje só vive em
-- estado local do browser (itens em DocumentosPage.jsx), da sessão de
-- upload manual atual — não sobrevive a um reload nem serve pros
-- documentos que chegam via WhatsApp (ninguém com a aba aberta no
-- momento). Essas duas colunas persistem a sugestão pra alimentar a fila
-- "A revisar" (documentos com status identificado/sem_match/pendente_analise),
-- de onde o usuário confirma (ou troca) e aplica a baixa de fato.
-- Sem FK porque candidato_sugerido_id aponta pra etapas_obrigacao OU
-- tarefas dependendo do tipo (mesmo padrão polimórfico já usado em
-- obrigacao_id/etapa_obrigacao_id/tarefa_id na tabela "documentos").
-- ============================================================

alter table documentos
  add column if not exists candidato_sugerido_id uuid,
  add column if not exists candidato_sugerido_tipo text check (candidato_sugerido_tipo in ('etapa', 'tarefa'));
