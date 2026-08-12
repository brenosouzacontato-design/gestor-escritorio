-- ============================================================
-- HONORÁRIOS AVULSOS + FIX RLS "configuracoes" — Gestor Escritório Contábil
-- ============================================================

-- 1) "configuracoes" nasceu com RLS ativado (mesmo padrão de toda tabela
-- nova nesse projeto) e nunca foi desligado — só não dava erro porque o
-- token do OneFlow era salvo via outro caminho. Salvar a chave PIX pela
-- tela de Honorários bateu nisso ("new row violates row-level security
-- policy for table configuracoes"). Desliga, mesmo padrão do resto do app.
alter table configuracoes disable row level security;

-- 2) Serviço avulso (cobrança pontual, fora da mensalidade recorrente) —
-- mesma tabela "honorarios", diferenciada por "tipo". "descricao" só é
-- preenchida pra avulso (a mensalidade não precisa, é sempre a mesma
-- coisa: o honorário do mês).
alter table honorarios
  add column if not exists tipo text not null default 'mensal' check (tipo in ('mensal', 'avulso')),
  add column if not exists descricao text;

-- O índice único (cliente_id, competencia) impedia mais de uma cobrança
-- por cliente/mês — certo pra mensalidade (gerarHonorariosDoMes não pode
-- duplicar), errado pra avulso (o cliente pode ter vários serviços
-- pontuais no mesmo mês, ou um avulso no mesmo mês da mensalidade). Troca
-- por um índice parcial que só vale pra tipo='mensal'.
drop index if exists idx_honorarios_cliente_competencia;
create unique index if not exists idx_honorarios_cliente_competencia_mensal
  on honorarios(cliente_id, competencia) where tipo = 'mensal';
