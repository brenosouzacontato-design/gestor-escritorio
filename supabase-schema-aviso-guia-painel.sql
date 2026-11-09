-- ============================================================
-- AVISO DE GUIA NO PAINEL — Gestor Escritório Contábil
-- Toda guia anexada (documentos confirmados de imposto/parcelamento) vira
-- uma mensagem no WhatsApp do cliente com o link curto do painel
-- (netlify/functions/guias-aviso-cron.js, a cada 5 min). A guia avisada
-- fica "entregue" na Central de Entregas (canal 'painel') e, quando o
-- cliente abre/baixa pelo painel, "aberta" — o mesmo monitoramento de
-- supabase-schema-central-entregas.sql (rode aquele antes deste).
-- Aditivo e seguro rodar mais de uma vez.
-- ============================================================

-- 1) Liga/desliga o aviso automático por empresa (Central de Entregas → Empresas)
alter table clientes
  add column if not exists aviso_guia_painel boolean not null default true;

-- 2) Quando o aviso da guia foi processado (enviado ou com falha) — evita
--    mandar a mesma guia duas vezes
alter table documentos
  add column if not exists aviso_painel_em timestamptz;

create index if not exists idx_documentos_aviso_painel on documentos(aviso_painel_em);

-- 3) Link curto do painel (/p/<codigo>), um por empresa. `url` já leva o
--    token do painel: se o token for trocado (girar_painel_token) o cron
--    grava a url nova no próximo aviso e o link antigo para de abrir.
create table if not exists painel_links_curtos (
  codigo     text primary key,
  cliente_id uuid not null unique references clientes(id) on delete cascade,
  url        text not null,
  criado_em  timestamptz not null default now()
);

-- Só as functions (service key) leem/gravam: RLS ligado e sem política.
alter table painel_links_curtos enable row level security;
