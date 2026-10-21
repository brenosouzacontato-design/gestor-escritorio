-- ============================================================
-- APARELHO NOS EVENTOS DO PAINEL — Gestor Escritório Contábil
-- Pro relatório de acessos do painel (Painéis → Relatório de acessos,
-- RelatorioAcessosPainel.jsx): cada abertura/download passa a guardar
--   - aparelho_id: identificador anônimo que o próprio navegador do cliente
--     gera e guarda na primeira visita (src/pages/painel/aparelho.js). O mesmo
--     celular manda sempre o mesmo id — não identifica a pessoa;
--   - user_agent: o que o navegador informa (vira "iPhone · Safari" na tela);
--   - origem: 'escritorio' quando quem abriu o link é um navegador com o
--     login do gestor (teste do escritório) — não conta como visita do
--     cliente nem gera aviso no WhatsApp.
-- Seguro rodar mais de uma vez. Enquanto não rodar, o painel continua
-- gravando os eventos sem essas colunas (netlify/functions/painel-evento.js).
-- ============================================================

alter table painel_eventos add column if not exists aparelho_id text;
alter table painel_eventos add column if not exists user_agent text;
alter table painel_eventos add column if not exists origem text not null default 'cliente';

alter table painel_eventos drop constraint if exists painel_eventos_origem_check;
alter table painel_eventos add constraint painel_eventos_origem_check
  check (origem in ('cliente', 'escritorio'));

create index if not exists idx_painel_eventos_criado
  on painel_eventos(criado_em desc);

alter table painel_visualizacoes add column if not exists aparelho_id text;
