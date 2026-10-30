-- ============================================================
-- PARCELAMENTOS — cadastro pela guia — Gestor Escritório Contábil
--
-- Fluxo (ver src/pages/parcelamentos/ParcelamentosPage.jsx):
--   1. o escritório arrasta guias de parcelamento (PDF) na tela;
--   2. o navegador lê cada guia (leitorGuiaParcelamento.js): CPF/CNPJ,
--      origem (PARCMEI da Receita ou SISPAR da PGFN), conta, parcela X/Y,
--      valor, vencimento e linha digitável;
--   3. a empresa é achada pelo CNPJ (ou por um parcelamento já cadastrado
--      com o mesmo documento); o parcelamento é criado/atualizado sozinho e
--      a guia vira um registro em `documentos` (bucket "documentos"),
--      ligada ao parcelamento.
--   4. (próxima etapa) o robô do servidor lê `parcelamentos` com
--      busca_automatica = true, emite a guia do mês e grava o resultado
--      em ultima_busca_*.
--
-- A tabela `parcelamentos` já existia (tela antiga, sem rota no menu): aqui
-- só se acrescentam colunas — nada é apagado. Seguro rodar mais de uma vez.
-- ============================================================

create table if not exists parcelamentos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid references clientes(id) on delete cascade,
  tipo             text,
  descricao        text,
  numero_processo  text,
  total_parcelas   integer,
  parcela_atual    integer,
  valor_parcela    numeric(14,2),
  vencimento_dia   integer,
  data_inicio      date,
  status           text not null default 'ativo',
  observacao       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- guias de PGFN não informam o total de parcelas: as colunas antigas não
-- podem mais ser obrigatórias
do $$
declare c text;
begin
  foreach c in array array['tipo', 'total_parcelas', 'parcela_atual', 'vencimento_dia'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'parcelamentos'
                 and column_name = c and is_nullable = 'NO') then
      execute format('alter table parcelamentos alter column %I drop not null', c);
    end if;
  end loop;
end $$;

alter table parcelamentos
  add column if not exists origem             text,              -- 'PARCMEI' | 'PGFN' | null (cadastro manual antigo)
  add column if not exists conta              text,              -- nº do PARCMEI (1, 2…) ou conta SISPAR (014305206)
  add column if not exists documento_devedor  text,              -- só dígitos: o CPF/CNPJ usado pra emitir a guia
  add column if not exists nome_devedor       text,              -- como vem na guia
  add column if not exists ultima_guia_vencimento date,
  add column if not exists busca_automatica   boolean not null default true,
  add column if not exists ultima_busca_em    timestamptz,       -- robô do servidor (próxima etapa)
  add column if not exists ultima_busca_status text,             -- 'ok' | 'erro' | 'nao_permite_emissao' | 'aguardando_captcha'
  add column if not exists ultima_busca_msg   text;

-- um parcelamento por (origem, devedor, conta)
create unique index if not exists idx_parcelamentos_origem_devedor_conta
  on parcelamentos(origem, documento_devedor, conta)
  where origem is not null;

create index if not exists idx_parcelamentos_cliente on parcelamentos(cliente_id);

-- A guia é um documento como os outros (painel, baixa de pagamento) —
-- só ganha o vínculo com o parcelamento.
alter table documentos
  add column if not exists parcelamento_id uuid references parcelamentos(id) on delete set null,
  add column if not exists parcela_numero  integer;

create index if not exists idx_documentos_parcelamento on documentos(parcelamento_id);
create index if not exists idx_documentos_linha_digitavel on documentos(linha_digitavel);

-- RLS: em produção `parcelamentos` já estava com RLS ligado e sem nenhuma
-- policy (ninguém lia nem gravava). Mesma regra de comprovantes_pagamento
-- antes do passo 1 do RLS (docs/seguranca-rls.md): só usuário logado.
-- Depois do passo 1, supabase-rls-01 troca por is_escritorio().
alter table parcelamentos enable row level security;
drop policy if exists escritorio_total on parcelamentos;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    execute 'create policy escritorio_total on parcelamentos for all to authenticated
             using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    execute 'create policy escritorio_total on parcelamentos for all to authenticated
             using (true) with check (true)';
  end if;
end $$;
