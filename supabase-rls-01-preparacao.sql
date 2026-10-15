-- ============================================================
-- RLS — PASSO 1: PREPARAÇÃO (aditivo, sem efeito no app atual)
-- Ver docs/seguranca-rls.md.
--
-- Cria a tabela de usuários do escritório, o token do painel por cliente,
-- as funções auxiliares, as RPCs do painel e TODAS as policies. Nada disso
-- muda o comportamento de hoje: policy em tabela com RLS desligado é
-- ignorada. Quem liga o RLS é o passo 2 (supabase-rls-02-ativar.sql), que só
-- deve rodar depois do deploy do front com login + token do painel.
--
-- Seguro de rodar de novo (drop ... if exists / create or replace).
-- NÃO RODAR EM PRODUÇÃO SEM APROVAÇÃO DO DONO DO ESCRITÓRIO.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) USUÁRIOS DO ESCRITÓRIO
-- ------------------------------------------------------------
-- O login é o Supabase Auth (e-mail + senha). Ter conta no Auth NÃO basta:
-- só quem está nesta tabela é tratado como escritório. Assim, mesmo que o
-- cadastro público fique ligado por engano, um estranho que crie conta não
-- enxerga nada. O login (ComLogin.jsx) e as tabelas nfse_* são da sessão de NFS-e;
-- este script não mexe neles. O dono precisa estar aqui antes do passo 2.
create table if not exists escritorio_usuarios (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  papel     text not null default 'colaborador' check (papel in ('dono', 'colaborador')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table escritorio_usuarios enable row level security;

-- security definer: lê escritorio_usuarios sem passar pelo RLS dela (evita
-- recursão quando a própria policy de escritorio_usuarios chama a função).
create or replace function public.is_escritorio()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from escritorio_usuarios
    where user_id = auth.uid() and ativo
  );
$$;

create or replace function public.is_dono()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from escritorio_usuarios
    where user_id = auth.uid() and ativo and papel = 'dono'
  );
$$;

drop policy if exists escritorio_usuarios_ler on escritorio_usuarios;
create policy escritorio_usuarios_ler on escritorio_usuarios
  for select to authenticated using ((select is_escritorio()));
drop policy if exists escritorio_usuarios_gerir on escritorio_usuarios;
create policy escritorio_usuarios_gerir on escritorio_usuarios
  for all to authenticated using ((select is_dono())) with check ((select is_dono()));

-- ------------------------------------------------------------
-- 2) TOKEN DO PAINEL POR CLIENTE
-- ------------------------------------------------------------
-- Hoje o link é ?painel=<clientes.id>. O id não é segredo (qualquer um lê a
-- tabela clientes pela API). Passa a ser ?painel=<painel_token>: 32
-- caracteres hex aleatórios (122 bits), um por cliente, que o escritório
-- pode trocar (girar_painel_token) se um link vazar.
alter table clientes add column if not exists painel_token text;
update clientes
   set painel_token = replace(gen_random_uuid()::text, '-', '')
 where painel_token is null;
alter table clientes alter column painel_token set default replace(gen_random_uuid()::text, '-', '');
alter table clientes alter column painel_token set not null;
create unique index if not exists idx_clientes_painel_token on clientes(painel_token);

-- O front do painel manda o token no cabeçalho HTTP x-painel-token (cliente
-- Supabase separado, ver docs). O PostgREST expõe os cabeçalhos em
-- request.headers; esta função devolve o cliente dono do token ou null.
create or replace function public.painel_cliente_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select c.id
    from clientes c
   where c.painel_token = nullif(
           coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-painel-token', '')
$$;

-- Escritório troca o token de um cliente (link antigo para de funcionar).
create or replace function public.girar_painel_token(p_cliente_id uuid)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  novo text := replace(gen_random_uuid()::text, '-', '');
begin
  if not is_escritorio() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  update clientes set painel_token = novo where id = p_cliente_id;
  return novo;
end;
$$;

-- ------------------------------------------------------------
-- 3) RPCs DO PAINEL (o que o cliente faz sem login)
-- ------------------------------------------------------------
-- O cliente não lê a tabela clientes direto (ela tem colunas internas:
-- honorário, observações, sócio...). Recebe só o que as páginas públicas
-- usam hoje (PainelCompartilhadoPage, PainelClientePage,
-- ComprovanteFaturamentoPage, Relatorio/NotasFiscais/IdentificarLancamentos).
create or replace function public.painel_sessao()
returns table (
  id uuid, nome text, cnpj text, regime text, carteira text,
  municipio text, data_abertura date, socio_nome text, painel_secoes_ocultas text[]
)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.nome, c.cnpj, c.regime::text, c.carteira::text,
         c.municipio, c.data_abertura, c.socio_nome, c.painel_secoes_ocultas
    from clientes c
   where c.id = painel_cliente_id();
$$;
-- OBS: carteira não tem script no repo (coluna criada pelo painel do Supabase);
-- conferir o tipo dela e de municipio/data_abertura/socio_nome no
-- banco (passo 0) — se algum for diferente, ajustar o "returns table".

-- Assinatura de push: o upsert por endpoint precisaria de select/update
-- liberado pro anônimo na tabela inteira; a RPC grava só pro cliente do token.
create or replace function public.painel_registrar_push(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_cliente uuid := painel_cliente_id();
begin
  if v_cliente is null then
    raise exception 'token do painel inválido' using errcode = '42501';
  end if;
  insert into painel_push_assinaturas (cliente_id, endpoint, p256dh, auth, user_agent)
  values (v_cliente, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set cliente_id = excluded.cliente_id, p256dh = excluded.p256dh,
        auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;

-- Cliente responde "o que é este lançamento" (LancamentosIdentificar.jsx).
-- Só a coluna observacao_cliente, e só em lançamento da própria empresa.
create or replace function public.painel_salvar_observacao(p_lancamento_id uuid, p_observacao text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_cliente uuid := painel_cliente_id();
begin
  if v_cliente is null then
    raise exception 'token do painel inválido' using errcode = '42501';
  end if;
  update lancamentos_contabeis
     set observacao_cliente = p_observacao
   where id = p_lancamento_id and empresa_id = v_cliente;
  if not found then
    raise exception 'lançamento não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

-- Link ?doc=<id> (DocumentoCompartilhadoPage): o id do documento (uuid v4)
-- continua sendo o "segredo" do link, mas deixa de ser listável — o anônimo
-- só consegue abrir um documento cujo id já recebeu. A URL assinada do
-- arquivo sai da Netlify Function painel-arquivo (ver docs).
create or replace function public.documento_publico(p_documento_id uuid)
returns json
language sql stable security definer
set search_path = public
as $$
  select to_json(x) from (
    select d.*,
           json_build_object('nome', c.nome)    as clientes,
           json_build_object('titulo', o.titulo) as obrigacoes,
           json_build_object('nome', e.nome)    as etapas_obrigacao,
           json_build_object('titulo', t.titulo) as tarefas
      from documentos d
      left join clientes c          on c.id = d.cliente_id
      left join obrigacoes o        on o.id = d.obrigacao_id
      left join etapas_obrigacao e  on e.id = d.etapa_obrigacao_id
      left join tarefas t           on t.id = d.tarefa_id
     where d.id = p_documento_id
  ) x;
$$;

revoke all on function public.is_escritorio()                         from public;
revoke all on function public.is_dono()                               from public;
revoke all on function public.painel_cliente_id()                     from public;
revoke all on function public.girar_painel_token(uuid)                from public;
revoke all on function public.painel_sessao()                         from public;
revoke all on function public.painel_registrar_push(text, text, text, text) from public;
revoke all on function public.painel_salvar_observacao(uuid, text)    from public;
revoke all on function public.documento_publico(uuid)                 from public;

grant execute on function public.is_escritorio()                      to anon, authenticated;
-- O Supabase dá execute direto pro anon em funções novas; tira das que são só do escritório.
revoke execute on function public.is_dono()               from anon;
revoke execute on function public.girar_painel_token(uuid) from anon;
grant execute on function public.is_dono()                            to authenticated;
grant execute on function public.painel_cliente_id()                  to anon, authenticated;
grant execute on function public.girar_painel_token(uuid)             to authenticated;
grant execute on function public.painel_sessao()                      to anon, authenticated;
grant execute on function public.painel_registrar_push(text, text, text, text) to anon, authenticated;
grant execute on function public.painel_salvar_observacao(uuid, text) to anon, authenticated;
grant execute on function public.documento_publico(uuid)              to anon, authenticated;

-- ------------------------------------------------------------
-- 4) POLICIES DO ESCRITÓRIO — acesso total pra quem é is_escritorio()
-- ------------------------------------------------------------
-- Uma policy "for all" por tabela. (select is_escritorio()) entre parênteses
-- faz o Postgres avaliar uma vez por consulta, não uma vez por linha.
do $$
declare
  t text;
  tabelas text[] := array[
    'clientes', 'tarefas', 'tarefa_comentarios', 'fechamentos_erp', 'configuracoes', 'prospectos',
    'obrigacoes', 'departamentos', 'tipos_obrigacao', 'etapas_template', 'etapas_obrigacao',
    'historico_obrigacao', 'cliente_entrega_competencia', 'cliente_tipos_obrigacao_excluidos',
    'cnd_manual', 'contas_contabeis', 'lancamentos_contabeis', 'partidas_contabeis',
    'regras_classificacao', 'lancamentos_identificacao_links', 'dados_gerenciais_simples',
    'documentos', 'documentos_fiscais_erp', 'documentos_whatsapp', 'honorarios', 'lembretes',
    'painel_eventos', 'painel_push_assinaturas', 'painel_recados', 'painel_visualizacoes',
    'parcelamentos', 'parcelamento_parcelas', 'situacao_fiscal_rfb'
  ];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then
      raise notice 'tabela % não existe — pulando', t;
      continue;
    end if;
    execute format('drop policy if exists escritorio_total on public.%I', t);
    execute format(
      'create policy escritorio_total on public.%I for all to authenticated
         using ((select is_escritorio())) with check ((select is_escritorio()))', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5) POLICIES DO PAINEL — anônimo com x-painel-token válido, só leitura,
--    só as linhas do cliente do token
-- ------------------------------------------------------------
do $$
declare
  t text;
  -- tabela -> coluna que aponta pro cliente
  por_cliente text[][] := array[
    ['obrigacoes',                      'cliente_id'],
    ['tarefas',                         'cliente_id'],
    ['documentos',                      'cliente_id'],
    ['dados_gerenciais_simples',        'cliente_id'],
    ['situacao_fiscal_rfb',             'cliente_id'],
    ['cnd_manual',                      'cliente_id'],
    ['documentos_fiscais_erp',          'cliente_id'],
    ['honorarios',                      'cliente_id'],
    ['painel_recados',                  'cliente_id'],
    ['lancamentos_contabeis',           'empresa_id'],
    ['contas_contabeis',                'empresa_id'],
    ['lancamentos_identificacao_links', 'empresa_id']
  ];
  i int;
begin
  for i in 1 .. array_length(por_cliente, 1) loop
    t := por_cliente[i][1];
    if to_regclass('public.' || t) is null then
      raise notice 'tabela % não existe — pulando', t;
      continue;
    end if;
    execute format('drop policy if exists painel_ler on public.%I', t);
    execute format(
      'create policy painel_ler on public.%I for select to anon
         using (%I = (select painel_cliente_id()))', t, por_cliente[i][2]);
  end loop;
end $$;

-- Tabelas sem coluna de cliente: libera via pai.
drop policy if exists painel_ler on partidas_contabeis;
create policy painel_ler on partidas_contabeis for select to anon
  using (exists (select 1 from lancamentos_contabeis l
                  where l.id = partidas_contabeis.lancamento_id
                    and l.empresa_id = (select painel_cliente_id())));

drop policy if exists painel_ler on etapas_obrigacao;
create policy painel_ler on etapas_obrigacao for select to anon
  using (exists (select 1 from obrigacoes o
                  where o.id = etapas_obrigacao.obrigacao_id
                    and o.cliente_id = (select painel_cliente_id())));

-- Tabelas de referência (nomes de departamento, tipo de obrigação): sem
-- dado de cliente, mas só abrem com token válido.
drop policy if exists painel_ler on departamentos;
create policy painel_ler on departamentos for select to anon
  using ((select painel_cliente_id()) is not null);
drop policy if exists painel_ler on tipos_obrigacao;
create policy painel_ler on tipos_obrigacao for select to anon
  using ((select painel_cliente_id()) is not null);

-- configuracoes guarda os tokens do OneFlow (of_user_token, of_refresh_token,
-- of_escritorio_token): o painel só pode ler a chave PIX.
drop policy if exists painel_ler on configuracoes;
create policy painel_ler on configuracoes for select to anon
  using ((select painel_cliente_id()) is not null
         and chave in ('honorarios_pix_chave', 'honorarios_pix_favorecido'));

-- Log de visita: anônimo só insere, e só pro próprio cliente.
drop policy if exists painel_inserir on painel_visualizacoes;
create policy painel_inserir on painel_visualizacoes for insert to anon
  with check (cliente_id = (select painel_cliente_id()));

-- ------------------------------------------------------------
-- 6) VIEW vw_movimento_contas passa a respeitar o RLS de quem consulta
-- ------------------------------------------------------------
-- Sem isso a view roda com os direitos do dono (postgres) e devolve o
-- movimento de TODAS as empresas mesmo com RLS ligado nas tabelas.
alter view vw_movimento_contas set (security_invoker = true);

-- ------------------------------------------------------------
-- 7) STORAGE (bucket "documentos") — policies novas, ainda não exclusivas
-- ------------------------------------------------------------
-- storage.objects já tem RLS ligado. As policies abertas de hoje
-- (documentos_insert/select/delete, sem filtro de papel) são removidas só no
-- passo 2; aqui só se cria a versão do escritório. O cliente do painel não
-- acessa o Storage direto: as URLs assinadas saem da Netlify Function
-- painel-arquivo (service key), depois de conferir token e dono do arquivo.
drop policy if exists documentos_escritorio on storage.objects;
create policy documentos_escritorio on storage.objects
  for all to authenticated
  using (bucket_id = 'documentos' and (select public.is_escritorio()))
  with check (bucket_id = 'documentos' and (select public.is_escritorio()));

commit;

-- ------------------------------------------------------------
-- DEPOIS DE RODAR: cadastrar os usuários do escritório
-- ------------------------------------------------------------
-- 1. Authentication > Users > "Invite user" (ou "Add user") pra cada pessoa.
-- 2. Authentication > Providers/Sign In: desligar "Allow new users to sign up".
-- 3. Vincular cada um (trocar os e-mails):
--
-- insert into escritorio_usuarios (user_id, nome, papel)
-- select id, 'NOME DO DONO', 'dono' from auth.users where email = 'EMAIL_DO_DONO'
-- on conflict (user_id) do nothing;
--
-- insert into escritorio_usuarios (user_id, nome)
-- select id, 'NOME', 'colaborador' from auth.users where email = 'EMAIL'
-- on conflict (user_id) do nothing;
