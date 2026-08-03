-- ============================================================
-- ANEXOS DE DOCUMENTOS — Gestor Escritório Contábil
-- Bucket de Storage + tabela "documentos" pra guardar comprovantes/guias
-- enviados pelo escritório, com o resultado da identificação automática
-- (feita pela Netlify Function netlify/functions/identificar-documento.js)
-- e o vínculo com a etapa de obrigação ou tarefa que o documento resolve.
-- ============================================================

-- 1) BUCKET DE STORAGE ------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- storage.objects sempre tem RLS ligado (não dá pra desligar como nas
-- tabelas normais) — sem essas policies, nem a service key nem a anon key
-- conseguem subir/ler arquivo nenhum. Mesmo nível de confiança do resto do
-- app hoje (sem autenticação por usuário ainda).
-- CREATE POLICY não tem "IF NOT EXISTS" no Postgres — dropa antes pra
-- deixar o script seguro de rodar de novo.
drop policy if exists "documentos_insert" on storage.objects;
create policy "documentos_insert" on storage.objects
  for insert with check (bucket_id = 'documentos');
drop policy if exists "documentos_select" on storage.objects;
create policy "documentos_select" on storage.objects
  for select using (bucket_id = 'documentos');
drop policy if exists "documentos_delete" on storage.objects;
create policy "documentos_delete" on storage.objects
  for delete using (bucket_id = 'documentos');

-- 2) TABELA "documentos" ----------------------------------------------
-- cliente_id, obrigacao_id/etapa_obrigacao_id e tarefa_id só são
-- preenchidos depois que a IA sugere e o usuário confirma (ver
-- DocumentosPage.jsx) — todos nullable de propósito.
create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id),
  nome_arquivo text not null,
  storage_path text not null,
  tipo_mime text,
  tamanho_bytes bigint,
  tipo_documento_sugerido text,        -- ex: "Comprovante DAS", texto livre da IA
  obrigacao_id uuid references obrigacoes(id),
  etapa_obrigacao_id uuid references etapas_obrigacao(id),
  tarefa_id uuid references tarefas(id),
  confianca text check (confianca in ('alta','media','baixa')),
  observacao_ia text,
  status text not null default 'pendente_analise'
    check (status in ('pendente_analise','identificado','sem_match','confirmado')),
  confirmado_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_documentos_cliente on documentos(cliente_id);
create index if not exists idx_documentos_status on documentos(status);

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table documentos disable row level security;
