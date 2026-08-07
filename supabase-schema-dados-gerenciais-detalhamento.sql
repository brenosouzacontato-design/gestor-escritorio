-- ============================================================
-- RECEITA POR TIPO (Normal/ST/Monofásico) — Gestor Escritório Contábil
-- Coluna nova em dados_gerenciais_simples pra guardar a receita segregada
-- por tipo quando a Declaração do Simples trouxer essa quebra (empresas
-- com Substituição Tributária ou tributação monofásica) — extraído por IA
-- em netlify/functions/extrair-declaracao-simples.js. Alimenta o painel
-- consolidado do cliente (src/pages/painel/PainelClientePage.jsx).
-- ============================================================

alter table dados_gerenciais_simples
  add column if not exists receita_por_tipo jsonb; -- [{tipo: 'normal'|'st'|'monofasico', valor: number}], null quando a declaração não segrega
