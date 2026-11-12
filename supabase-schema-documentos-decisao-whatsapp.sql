-- ============================================================
-- DOCUMENTOS — tarefa ou arquivo pelo grupo do WhatsApp — Gestor Escritório Contábil
-- Documento enviado no grupo "Documentos" que a IA não identifica: o robô
-- pergunta no grupo "1 = criar tarefa / 2 = deixar arquivado"
-- (netlify/functions/whatsapp-webhook.js + lib/decisaoDocumento.js).
-- Estas colunas guardam a pergunta pendente e o que foi escolhido.
-- Aditivo e seguro rodar mais de uma vez.
-- ============================================================

alter table documentos add column if not exists whatsapp_pergunta_id text;   -- id da mensagem do robô com a pergunta
alter table documentos add column if not exists whatsapp_decisao text;       -- aguardando | tarefa | arquivado
alter table documentos add column if not exists whatsapp_decidido_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documentos_whatsapp_decisao_check') then
    alter table documentos add constraint documentos_whatsapp_decisao_check
      check (whatsapp_decisao in ('aguardando', 'tarefa', 'arquivado'));
  end if;
end $$;

create index if not exists idx_documentos_whatsapp_aguardando
  on documentos(created_at desc) where whatsapp_decisao = 'aguardando';
