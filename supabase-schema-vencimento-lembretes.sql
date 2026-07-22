-- ============================================================
-- VENCIMENTO EXPLÍCITO + LEMBRETES POR TIPO — Gestor Escritório Contábil
-- Migration aditiva por cima de supabase-schema-andamento-recorrencia.sql.
--
-- Hoje o vencimento de uma obrigação recorrente simples (uma etapa
-- "Concluir") é só "N dias a partir do início da competência" — não deixa
-- claro se vence no mês da competência ou no seguinte. Isso adiciona um
-- jeito explícito (mês + dia) só pro caso simples; processos com múltiplas
-- etapas (ex: Rescisão Trabalhista) continuam usando
-- etapas_template.prazo_dias_relativo exatamente como já funciona — não é
-- tocado aqui.
-- ============================================================

alter table tipos_obrigacao
  add column if not exists mes_vencimento text check (mes_vencimento in ('mesmo','seguinte')) default 'mesmo',
  add column if not exists dia_vencimento int check (dia_vencimento between 1 and 31),
  add column if not exists dias_lembrete int check (dias_lembrete >= 0);

-- Backfill dos 7 tipos recorrentes seedados na migration anterior — todos
-- nascem "mês seguinte", preservando o comportamento que já existia (o
-- cálculo antigo em Obrigacoes.jsx/store/index.js, new Date(ano, mes,
-- VENC[tipo]), já era efetivamente "dia VENC do mês seguinte à
-- competência" por causa do índice 0-based de mês do JS Date). Lembrete
-- default de 3 dias, ajustável depois pela UI ("Personalizar etapas").
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 20, dias_lembrete = 3 where nome = 'PGDAS';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 15, dias_lembrete = 3 where nome = 'DCTFWeb';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 10, dias_lembrete = 3 where nome = 'NFS-e';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 7,  dias_lembrete = 3 where nome = 'eSocial';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 7,  dias_lembrete = 3 where nome = 'Folha';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 25, dias_lembrete = 3 where nome = 'Documentos';
update tipos_obrigacao set mes_vencimento = 'seguinte', dia_vencimento = 10, dias_lembrete = 3 where nome = 'Extrato Bancário';
