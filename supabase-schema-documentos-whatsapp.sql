-- ============================================================
-- BACKUP WHATSAPP → GOOGLE DRIVE — Gestor Escritório Contábil
-- Log dos arquivos enviados no grupo "Documentos" do WhatsApp e subidos
-- automaticamente pro Google Drive (ver netlify/functions/whatsapp-webhook.js
-- e netlify/functions/lib/googleDrive.js). Tabela só de histórico/consulta —
-- não tem vínculo com cliente/obrigação, é o sistema separado da tabela
-- "documentos" (que é o fluxo de upload manual + identificação por IA).
-- ============================================================

create table if not exists documentos_whatsapp (
  id uuid primary key default gen_random_uuid(),
  nome_arquivo text not null,
  mime_type text,
  remetente text,              -- número/JID de quem enviou no grupo, quando disponível
  drive_file_id text not null,
  drive_link text,
  created_at timestamptz not null default now()
);

create index if not exists idx_documentos_whatsapp_created on documentos_whatsapp(created_at desc);

-- Tabelas novas neste projeto Supabase nascem com RLS ativado por padrão
-- — desliga explicitamente, mesmo padrão do resto do projeto (ver nota em
-- supabase-schema-andamento.sql).
alter table documentos_whatsapp disable row level security;
