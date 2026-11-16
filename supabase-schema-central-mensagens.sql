-- ============================================================
-- CENTRAL DE MENSAGENS — Gestor Escritório Contábil
-- Mensagens padronizadas para os clientes (WhatsApp), com aprovação.
--
--   mensagens_modelos: textos reutilizáveis com variáveis ({nome}, {valor},
--     {pix_chave}...). Já nascem os modelos padrão (chave preenchida), que o
--     escritório pode editar; "Restaurar padrão" na tela volta o texto
--     original (src/lib/mensagens.js). O modelo 'cobranca_honorario' é o
--     texto da cobrança automática de honorários.
--   mensagens_fila: cada mensagem a enviar, uma por cliente.
--     aguardando_aprovacao -> aprovada -> enviando -> enviada | erro
--                          -> descartada
--     Toda mensagem programada (agendada na central ou criada pelo cron de
--     honorários) nasce aguardando aprovação; só sai depois de aprovada na
--     tela Mensagens. Aprovada com agendada_para no futuro sai nesse horário
--     (netlify/functions/mensagens-cron.js).
--
-- Segurança: RLS ligado, só o escritório lê/grava; as functions usam a
-- service key. Seguro rodar mais de uma vez.
-- ============================================================

create table if not exists mensagens_modelos (
  id          uuid primary key default gen_random_uuid(),
  chave       text unique,                  -- modelos padrão; null = criado pelo escritório
  categoria   text not null default 'Avisos',
  nome        text not null,
  texto       text not null,
  ativo       boolean not null default true,
  ordem       int not null default 100,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists mensagens_fila (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid references clientes(id) on delete set null,
  honorario_id  uuid references honorarios(id) on delete set null,   -- cobrança de honorário
  modelo_id     uuid references mensagens_modelos(id) on delete set null,
  destino_nome  text,
  telefone      text,                      -- 55 + DDD + celular (null = sem celular válido)
  texto         text not null,
  origem        text not null default 'central' check (origem in ('central', 'honorarios-cron')),
  status        text not null default 'aguardando_aprovacao'
                check (status in ('aguardando_aprovacao', 'aprovada', 'enviando', 'enviada', 'erro', 'descartada')),
  agendada_para timestamptz,               -- null = assim que aprovada
  lote          uuid,                      -- mensagens criadas juntas (mesmo envio da central)
  criado_por    text,
  aprovado_por  text,
  aprovado_em   timestamptz,
  enviado_em    timestamptz,
  erro          text,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_mensagens_fila_status on mensagens_fila(status, agendada_para);
create index if not exists idx_mensagens_fila_honorario on mensagens_fila(honorario_id) where honorario_id is not null;

insert into mensagens_modelos (chave, categoria, nome, texto, ordem) values
  ('cobranca_honorario', 'Honorários', 'Cobrança de honorário vencido', '🧾 *Lembrete de honorário contábil*
Olá, {nome}! O {referencia} no valor de {valor} venceu em {vencimento}.

💳 Chave PIX: {pix_chave}
👤 {pix_favorecido}

Se já pagou, pode desconsiderar. Qualquer dúvida, é só chamar por aqui.', 1),
  ('honorario_a_vencer', 'Honorários', 'Honorário vence em breve', 'Olá, {nome}! Passando para lembrar que o {referencia}, no valor de {valor}, vence em {vencimento}.

💳 Chave PIX: {pix_chave}
👤 {pix_favorecido}

Obrigado!', 2),
  ('reajuste_honorario', 'Honorários', 'Aviso de reajuste de honorários', 'Olá, {nome}! Informamos que, a partir da próxima competência, os honorários contábeis serão reajustados conforme o contrato. Qualquer dúvida, estamos à disposição.', 3),
  ('documentos_mes', 'Documentos', 'Pedido de documentos do mês', 'Olá, {nome}! Para fecharmos a competência {competencia}, precisamos dos documentos do mês: extratos bancários, notas fiscais de entrada e saída e comprovantes de despesas. Pode mandar por aqui mesmo. Obrigado!', 4),
  ('guias_disponiveis', 'Impostos', 'Guias do mês disponíveis', 'Olá, {nome}! As guias da competência {competencia} já estão disponíveis no seu painel. Confira os valores e vencimentos e, depois de pagar, mande o comprovante por aqui.', 5),
  ('lembrete_das', 'Impostos', 'Lembrete de vencimento do DAS', 'Olá, {nome}! Lembrete: o DAS da competência {competencia} vence no dia 20. Se já pagou, pode desconsiderar e, se puder, mande o comprovante por aqui.', 6),
  ('recesso', 'Avisos', 'Aviso de recesso do escritório', 'Olá, {nome}! Informamos que o escritório estará em recesso nos próximos dias. Os atendimentos voltam ao normal no próximo dia útil. Em caso de urgência, deixe sua mensagem por aqui.', 7),
  ('boas_vindas', 'Avisos', 'Boas-vindas ao cliente', 'Olá, {socio}! Seja bem-vindo(a) ao nosso escritório. Por este número você fala direto com a equipe: pode mandar documentos, tirar dúvidas e receber suas guias. Conte com a gente!', 8)
on conflict (chave) do nothing;

alter table mensagens_modelos enable row level security;
alter table mensagens_fila enable row level security;
drop policy if exists mensagens_modelos_escritorio on mensagens_modelos;
drop policy if exists mensagens_fila_escritorio on mensagens_fila;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    execute 'create policy mensagens_modelos_escritorio on mensagens_modelos for all to authenticated
             using ((select is_escritorio())) with check ((select is_escritorio()))';
    execute 'create policy mensagens_fila_escritorio on mensagens_fila for all to authenticated
             using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    execute 'create policy mensagens_modelos_escritorio on mensagens_modelos for all to authenticated using (true) with check (true)';
    execute 'create policy mensagens_fila_escritorio on mensagens_fila for all to authenticated using (true) with check (true)';
  end if;
end $$;

notify pgrst, 'reload schema';
