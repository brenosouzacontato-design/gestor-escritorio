-- ============================================================
-- DOCUMENTOS — importar extrato bancário pelo grupo do WhatsApp — Gestor Escritório Contábil
-- Extrato enviado no grupo "Documentos": o robô reconhece, identifica a
-- empresa e pergunta "importar para a contabilidade? sim / não". Com "sim",
-- netlify/functions/importar-extrato-background.mjs importa o extrato,
-- gera os lançamentos (padrão OneFlow) e responde com a DRE do período.
-- Fluxo em netlify/functions/whatsapp-webhook.js + lib/extratoWhatsapp.js.
--
-- Rodar DEPOIS de supabase-schema-documentos-decisao-whatsapp.sql.
-- Aditivo e seguro rodar mais de uma vez.
-- ============================================================

-- banco, titular e período lidos do extrato pela IA
alter table documentos add column if not exists whatsapp_extrato jsonb;

-- novos estados da pergunta: aguardando_extrato | extrato_importando | extrato_importado
alter table documentos drop constraint if exists documentos_whatsapp_decisao_check;
alter table documentos add constraint documentos_whatsapp_decisao_check
  check (whatsapp_decisao in ('aguardando', 'tarefa', 'arquivado',
                              'aguardando_extrato', 'extrato_importando', 'extrato_importado'));

create index if not exists idx_documentos_whatsapp_aguardando_extrato
  on documentos(created_at desc) where whatsapp_decisao = 'aguardando_extrato';
