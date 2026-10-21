-- ============================================================
-- LINK DA CARTEIRA — Gestor Escritório Contábil
-- Um link por carteira (?carteira=<token>) pra pessoa responsável pela
-- carteira (BRENO, Eloiza, Nelson/Breno...) abrir o painel de cada empresa
-- dela sem login e mandar o link de cada uma pro cliente
-- (src/pages/painel/PainelCarteiraPage.jsx). Gerado em Painéis → Por carteira.
--
-- Segurança (ver docs/seguranca-rls.md):
--   - carteira_links já nasce com RLS ligado: o navegador anônimo NÃO lê os
--     tokens. Só quem está logado no gestor lê/gera; quando o passo 1 do RLS
--     (supabase-rls-01-preparacao.sql) já rodou, só quem é do escritório
--     (is_escritorio()). Rodar este script de novo depois do passo 1 troca a
--     policy pra is_escritorio().
--   - a página pública só recebe a lista das empresas da carteira pela RPC
--     carteira_painel(token): nome, CNPJ, regime e a chave do painel de cada
--     uma (o painel_token, depois do passo 1; antes dele, o id, igual aos
--     links de hoje). Quem tem o link da carteira vê o painel de todas as
--     empresas dela — trate o link como senha; "Gerar novo link" invalida o
--     anterior.
-- Seguro rodar mais de uma vez.
-- ============================================================

create table if not exists carteira_links (
  carteira      text primary key,          -- mesmo texto de clientes.carteira
  token         text not null unique,      -- 32 caracteres hex aleatórios
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table carteira_links enable row level security;

drop policy if exists carteira_links_escritorio on carteira_links;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    execute 'create policy carteira_links_escritorio on carteira_links for all to authenticated
             using ((select is_escritorio())) with check ((select is_escritorio()))';
  else
    -- antes do passo 1 do RLS: qualquer login do gestor (não há cadastro público)
    execute 'create policy carteira_links_escritorio on carteira_links for all to authenticated
             using (true) with check (true)';
  end if;
end $$;

-- Empresas ativas da carteira dona do token. to_jsonb(c) em vez de c.coluna
-- pra funcionar antes e depois do passo 1 (painel_token só existe depois dele).
create or replace function public.carteira_painel(p_token text)
returns table (id uuid, nome text, cnpj text, regime text, carteira text, chave text)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.nome, c.cnpj, c.regime::text, l.carteira,
         coalesce(nullif(to_jsonb(c) ->> 'painel_token', ''), c.id::text) as chave
    from carteira_links l
    join clientes c on c.carteira::text = l.carteira
   where l.token = p_token
     and length(coalesce(p_token, '')) >= 24
     and coalesce((to_jsonb(c) ->> 'ativo')::boolean, true)
   order by c.nome;
$$;

revoke all on function public.carteira_painel(text) from public;
grant execute on function public.carteira_painel(text) to anon, authenticated;
