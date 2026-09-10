-- ============================================================
-- SEÇÕES OCULTAS DO PAINEL DO CLIENTE (edição só pro administrador)
-- Lista de chaves de seção que o escritório escondeu do Resumo desse
-- cliente especificamente ('kpis','grafico','modulos','visao_geral',
-- 'impostos') — o cliente nunca vê o controle de edição, só o resultado.
-- ============================================================

alter table clientes
  add column if not exists painel_secoes_ocultas text[] not null default '{}';
