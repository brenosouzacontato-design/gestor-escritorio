-- ============================================================
-- OBRIGAÇÕES RECORRENTES POR MÓDULO — Gestor Escritório Contábil
-- Migration aditiva por cima de supabase-schema-andamento.sql.
--
-- Consolida "departamentos"/"tipos_obrigacao" como fonte única de verdade
-- pra classificar obrigações por módulo daqui pra frente (em vez dos 3
-- mapas hardcoded em Empresas.jsx/Obrigacoes.jsx/Overview.jsx). O checklist
-- legado (tipo texto + competencia) não é migrado nem apagado — continua
-- servindo histórico das competências anteriores a 07/2026 exatamente como
-- está. Nada aqui altera ou remove dado existente.
-- ============================================================

-- 1) PERIODICIDADE — substitui o flag "recorrente" puro por uma escolha
--    real de frequência. Nullable: só é lido quando recorrente=true.
alter table tipos_obrigacao
  add column if not exists periodicidade text
    check (periodicidade in ('mensal','trimestral','semestral','anual'));

-- 2) TAREFAS — módulo cadastrável (mesmo padrão já usado em "obrigacoes"),
--    e flag de visibilidade pro futuro portal do cliente. A coluna texto
--    "departamento" existente não é tocada — dado antigo continua valendo.
alter table tarefas
  add column if not exists departamento_id uuid references departamentos(id),
  add column if not exists visivel_cliente boolean not null default true;

create index if not exists idx_tarefas_departamento on tarefas(departamento_id);

-- 2b) Unicidade (departamento_id, nome) em tipos_obrigacao — só existia
--     "id" como chave até aqui; sem isso o seed abaixo duplicaria tipos se
--     essa migration for rodada mais de uma vez.
create unique index if not exists idx_tipos_obrigacao_dept_nome on tipos_obrigacao(departamento_id, nome);

-- 3) PORTAL DO CLIENTE — mesmo preparo em obrigações. Default true (nada
--    muda visualmente hoje, só fica disponível pra um filtro futuro).
alter table obrigacoes
  add column if not exists visivel_cliente boolean not null default true;

-- 4) DEDUPE PRÓPRIA DO MODELO NOVO — a constraint legada é
--    (cliente_id, tipo, competencia); processos com etapas usam o título
--    livre como "tipo" (ver andamentoApi.js), então precisam de uma chave
--    de unicidade própria baseada em tipo_obrigacao_id. Índice parcial:
--    não colide com a constraint legada e não se aplica a linhas antigas.
create unique index if not exists idx_obrigacoes_tipo_obrigacao_competencia_unica
  on obrigacoes(cliente_id, tipo_obrigacao_id, competencia)
  where tipo_obrigacao_id is not null;

-- 5) RENOMEAR "Societário" → "Legalização" (mesmo registro, só o nome
--    muda — nenhuma obrigação/tarefa referencia esse id hoje, então o
--    rename não quebra nada existente).
update departamentos set nome = 'Legalização' where nome = 'Societário';

-- 6) DESATIVAR "Escritório" como módulo — deixa de aparecer nas colunas
--    de Empresas.jsx (que passa a listar só departamentos ativos). Soft
--    disable, não delete — segue o padrão não-destrutivo do projeto.
update departamentos set ativo = false where nome = 'Escritório';

-- 7) SEED — tipos de obrigação recorrentes (mensal) equivalentes ao
--    checklist legado, pra quem continuar precisando dessas obrigações
--    mensais a partir de agora use o modelo novo. "Parcelamento"
--    (Escritório) não entra — módulo removido, vira tarefa avulsa se
--    precisar. prazo_dias_relativo replica o mesmo dia de vencimento já
--    usado em VENC/VENCIMENTOS (Obrigacoes.jsx / store/index.js) hoje.
do $$
declare
  v_fiscal   uuid;
  v_folha    uuid;
  v_legal    uuid;
  v_contabil uuid;
  v_tipo     uuid;
begin
  select id into v_fiscal   from departamentos where nome = 'Fiscal';
  select id into v_folha    from departamentos where nome = 'Folha';
  select id into v_legal    from departamentos where nome = 'Legalização';
  select id into v_contabil from departamentos where nome = 'Contábil';

  -- Fiscal
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_fiscal, 'PGDAS', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 20);
  end if;

  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_fiscal, 'DCTFWeb', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 15);
  end if;

  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_fiscal, 'NFS-e', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 10);
  end if;

  -- Folha
  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_folha, 'eSocial', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 7);
  end if;

  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_folha, 'Folha', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 7);
  end if;

  -- Legalização
  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_legal, 'Documentos', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 25);
  end if;

  -- Contábil
  v_tipo := null;
  insert into tipos_obrigacao (departamento_id, nome, recorrente, periodicidade)
  values (v_contabil, 'Extrato Bancário', true, 'mensal')
  on conflict (departamento_id, nome) do nothing returning id into v_tipo;
  if v_tipo is not null then
    insert into etapas_template (tipo_obrigacao_id, nome, ordem, prazo_dias_relativo) values (v_tipo, 'Concluir', 1, 10);
  end if;
end $$;
