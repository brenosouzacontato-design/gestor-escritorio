-- ============================================================
-- HONORÁRIOS — serviço avulso pra NÃO CLIENTE — Gestor Escritório Contábil
-- ============================================================

-- Serviço avulso pontual pra alguém que ainda não é cliente cadastrado
-- (ex: abertura de empresa nova, consultoria avulsa) — cliente_id passa a
-- aceitar null; quando null, nome_avulso guarda o nome de quem tá sendo
-- cobrado direto no honorário (sem linha em "clientes" pra referenciar) e
-- telefone_avulso é opcional, só usado se quiser mandar o lembrete de
-- WhatsApp (mesmo formato validado por lib/telefone.js).
alter table honorarios
  alter column cliente_id drop not null,
  add column if not exists nome_avulso text,
  add column if not exists telefone_avulso text,
  add constraint honorarios_cliente_ou_avulso check (cliente_id is not null or nome_avulso is not null);
