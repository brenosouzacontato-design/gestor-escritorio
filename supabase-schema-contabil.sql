-- ============================================================
-- MÓDULO CONTÁBIL - Gestor Escritório Contábil
-- Migration: chart of accounts, lançamentos (partida dobrada), views
-- empresa_id referencia a tabela "clientes" (é lá que o Gestor guarda as
-- empresas do escritório — ver src/pages/Empresas.jsx)
-- ============================================================

-- 1) PLANO DE CONTAS ------------------------------------------------
create table if not exists contas_contabeis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references clientes(id) on delete cascade,
  codigo text not null,                -- ex: 1.1.01.001
  nome text not null,                  -- ex: Caixa Geral
  tipo text not null check (tipo in ('ativo','passivo','patrimonio_liquido','receita','despesa','custo')),
  natureza text not null check (natureza in ('devedora','credora')),
  conta_pai_id uuid references contas_contabeis(id) on delete set null,
  nivel int not null default 1,        -- 1 = grupo sintético, maior = mais analítico
  aceita_lancamento boolean not null default true, -- false para contas só de agrupamento (sintéticas)
  grupo_dre text check (grupo_dre in (
    'receita_bruta','deducao','custo',
    'despesa_administrativa','despesa_comercial','despesa_financeira',
    'outras_receitas','outras_despesas','ir_csll'
  )),                                    -- usado só p/ contas de receita/despesa, define onde entra na DRE
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create index if not exists idx_contas_contabeis_empresa on contas_contabeis(empresa_id);
create index if not exists idx_contas_contabeis_pai on contas_contabeis(conta_pai_id);

-- 2) LANÇAMENTOS (cabeçalho) ----------------------------------------
create table if not exists lancamentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references clientes(id) on delete cascade,
  data date not null,
  historico text not null,
  numero_documento text,
  origem text not null default 'manual' check (origem in ('manual','importacao_extrato')),
  extrato_referencia text,             -- guarda id/hash da transação do extrato importado, evita duplicar
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_lancamentos_empresa_data on lancamentos_contabeis(empresa_id, data);

-- 3) PARTIDAS (linhas de débito/crédito) -----------------------------
create table if not exists partidas_contabeis (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references lancamentos_contabeis(id) on delete cascade,
  conta_id uuid not null references contas_contabeis(id),
  tipo text not null check (tipo in ('debito','credito')),
  valor numeric(14,2) not null check (valor > 0)
);

create index if not exists idx_partidas_lancamento on partidas_contabeis(lancamento_id);
create index if not exists idx_partidas_conta on partidas_contabeis(conta_id);

-- 4) VALIDAÇÃO: débito = crédito por lançamento ----------------------
create or replace function check_lancamento_balanceado()
returns trigger as $$
declare
  v_total_debito numeric(14,2);
  v_total_credito numeric(14,2);
begin
  select coalesce(sum(valor) filter (where tipo = 'debito'), 0),
         coalesce(sum(valor) filter (where tipo = 'credito'), 0)
    into v_total_debito, v_total_credito
    from partidas_contabeis
   where lancamento_id = coalesce(new.lancamento_id, old.lancamento_id);

  if v_total_debito <> v_total_credito then
    raise exception 'Lançamento % não está balanceado: débito % != crédito %',
      coalesce(new.lancamento_id, old.lancamento_id), v_total_debito, v_total_credito;
  end if;
  return new;
end;
$$ language plpgsql;

-- Validação roda depois do insert/update/delete das partidas (permite salvar as N linhas antes de checar)
drop trigger if exists trg_check_lancamento_balanceado on partidas_contabeis;
create constraint trigger trg_check_lancamento_balanceado
  after insert or update or delete on partidas_contabeis
  deferrable initially deferred
  for each row execute function check_lancamento_balanceado();

-- 5) VIEW: movimento por conta (base para Balancete e DRE) -----------
create or replace view vw_movimento_contas as
select
  l.empresa_id,
  p.conta_id,
  l.data,
  sum(case when p.tipo = 'debito' then p.valor else 0 end) as total_debito,
  sum(case when p.tipo = 'credito' then p.valor else 0 end) as total_credito
from partidas_contabeis p
join lancamentos_contabeis l on l.id = p.lancamento_id
group by l.empresa_id, p.conta_id, l.data;

-- 6) RLS --------------------------------------------------------------
-- Sem RLS, igual às demais tabelas do Gestor (clientes, tarefas, obrigacoes...):
-- o projeto não tem autenticação de usuário nem vínculo usuário<->empresa hoje,
-- então não há um "dono" pra restringir o acesso. Se auth por usuário for
-- adicionado depois, revisitar e habilitar RLS aqui junto com o resto do app.
