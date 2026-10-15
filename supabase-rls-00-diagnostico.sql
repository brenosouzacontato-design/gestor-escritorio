-- ============================================================
-- RLS — PASSO 0: DIAGNÓSTICO (só leitura, não altera nada)
-- Ver docs/seguranca-rls.md. Rodar no SQL Editor do Supabase e guardar o
-- resultado: algumas tabelas (obrigacoes, parcelamentos,
-- parcelamento_parcelas, prospectos, tarefa_comentarios) foram criadas
-- direto no painel, sem script no repo, então o estado real só se vê aqui.
-- ============================================================

-- 1) Todas as tabelas/views do schema public e se o RLS está ligado
select c.relname                         as tabela,
       case c.relkind when 'r' then 'tabela' when 'v' then 'view' when 'm' then 'mat. view' end as tipo,
       c.relrowsecurity                  as rls_ligado,
       c.relforcerowsecurity             as rls_forcado,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as qtd_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
order by tipo, tabela;

-- 2) Policies que já existem (public + storage)
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- 3) Views: security_invoker ligado? (sem isso a view ignora o RLS das tabelas)
select c.relname as view, c.reloptions
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v';

-- 4) Buckets do Storage
select id, name, public from storage.buckets;

-- 5) Funções SQL do schema public (pra não colidir nomes)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by 1;

-- 6) Usuários já cadastrados no Supabase Auth (deve estar vazio hoje)
select id, email, created_at, last_sign_in_at from auth.users order by created_at;
