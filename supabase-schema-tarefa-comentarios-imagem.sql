-- Permite colar (Ctrl+V) uma imagem direto no chat de uma tarefa —
-- guarda o caminho no Storage (bucket "documentos", já usado pelo resto
-- do app) e o nome original, pra exibir/baixar depois.
alter table tarefa_comentarios
  add column if not exists imagem_path text,
  add column if not exists imagem_nome text;
