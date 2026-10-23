-- Início do cliente no escritório (primeiro dia do mês em que entrou).
-- O painel do cliente só mostra competências a partir dele, e a geração automática de obrigações
-- recorrentes não cria nada antes dele. Vazio = sem limite (clientes antigos).
-- Clientes novos começam no mês do cadastro. Pode rodar mais de uma vez.

alter table clientes add column if not exists inicio_escritorio date default date_trunc('month', current_date)::date;

-- painel_sessao (supabase-rls-01-preparacao.sql) passa a devolver o início, para o painel público.
drop function if exists public.painel_sessao();
create function public.painel_sessao()
returns table (
  id uuid, nome text, cnpj text, regime text, carteira text,
  municipio text, data_abertura date, socio_nome text, painel_secoes_ocultas text[], inicio_escritorio date
)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.nome, c.cnpj, c.regime::text, c.carteira::text,
         c.municipio, c.data_abertura, c.socio_nome, c.painel_secoes_ocultas, c.inicio_escritorio
    from clientes c
   where c.id = painel_cliente_id();
$$;
revoke all on function public.painel_sessao() from public;
grant execute on function public.painel_sessao() to anon, authenticated;
