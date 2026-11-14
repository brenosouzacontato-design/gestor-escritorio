-- ============================================================
-- DOCUMENTOS — menu de processamento e NFS-e pelo grupo do WhatsApp — Gestor Escritório Contábil
--
-- 1) Todo arquivo enviado no grupo "Documentos" recebe um menu numerado com o
--    que fazer, conforme o tipo (netlify/functions/lib/processamentoDocumento.js):
--      Declaração do Simples → carregar no painel do cliente
--      CND / Situação Fiscal → anexar ao painel do cliente
--      Boletos e guias       → anexar e dar baixa na obrigação ou tarefa
--      Guia de parcelamento  → cadastrar/atualizar o parcelamento
--      qualquer documento    → anexar ao painel, criar tarefa ou só arquivar
--    O grupo responde com o número; o processamento roda em
--    netlify/functions/documento-processar-background.mjs.
--
-- 2) Comando "nfse <empresa> <tomador> <valor>" no mesmo grupo: NFS-e para
--    tomador já cadastrado (Emitir NFS-e → Clientes ou Notas recorrentes).
--    O robô manda a prévia e só emite depois do "sim"
--    (netlify/functions/lib/nfseWhatsapp.js + nfse-whatsapp-background.js).
--
-- Rodar DEPOIS de supabase-schema-documentos-decisao-whatsapp.sql,
-- supabase-schema-documentos-extrato-whatsapp.sql, supabase-schema-nfse.sql e
-- supabase-schema-nfse-tomadores.sql. Aditivo e seguro rodar mais de uma vez.
-- ============================================================

-- opções oferecidas no menu do documento: [{ n, acao, rotulo, alvo?, fixo? }]
alter table documentos add column if not exists whatsapp_opcoes jsonb;

-- novos estados: processando (background rodando) | processado
alter table documentos drop constraint if exists documentos_whatsapp_decisao_check;
alter table documentos add constraint documentos_whatsapp_decisao_check
  check (whatsapp_decisao in ('aguardando', 'tarefa', 'arquivado', 'processando', 'processado',
                              'aguardando_extrato', 'extrato_importando', 'extrato_importado'));

-- pedidos de NFS-e feitos no grupo, esperando o "sim" (ou já tratados)
create table if not exists nfse_whatsapp_pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,  -- empresa emissora
  dados jsonb not null,                -- tomador, valor, data, descrição, semana... (o que vai na nota)
  texto_original text not null default '',
  remetente text,
  remote_jid text,                     -- grupo onde foi pedido (a resposta volta pra lá)
  pergunta_id text,                    -- id da mensagem da prévia (resposta citando ela)
  estado text not null default 'aguardando'
    check (estado in ('aguardando', 'emitindo', 'emitida', 'cancelado', 'erro')),
  nota_id uuid references nfse_notas(id) on delete set null,
  mensagem text,                       -- erro/rejeição, quando houver
  criado_em timestamptz not null default now(),
  decidido_em timestamptz
);
create index if not exists nfse_whatsapp_pedidos_aguardando_idx
  on nfse_whatsapp_pedidos (criado_em desc) where estado = 'aguardando';
create index if not exists nfse_whatsapp_pedidos_pergunta_idx on nfse_whatsapp_pedidos (pergunta_id);

-- Mesma regra das outras nfse_*: usuário logado só lê; escrita pelas functions (service role).
alter table nfse_whatsapp_pedidos enable row level security;
drop policy if exists "nfse_whatsapp_pedidos_leitura_autenticado" on nfse_whatsapp_pedidos;
create policy "nfse_whatsapp_pedidos_leitura_autenticado" on nfse_whatsapp_pedidos for select to authenticated using (true);
