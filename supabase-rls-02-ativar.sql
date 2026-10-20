-- ============================================================
-- RLS — PASSO 2: LIGAR O RLS (aqui o acesso anônimo é cortado)
-- Ver docs/seguranca-rls.md.
--
-- Pré-requisitos (TODOS):
--   [ ] supabase-rls-01-preparacao.sql rodado
--   [ ] usuários do escritório criados no Auth e vinculados em escritorio_usuarios
--   [ ] cadastro público desligado no Supabase Auth
--   [ ] front com tela de login + painel com x-painel-token publicado no Netlify
--   [ ] Netlify Function painel-arquivo publicada
--   [ ] links novos do painel (com painel_token) reenviados aos clientes
--
-- Rollback: supabase-rls-99-reverter.sql (volta ao estado de hoje).
-- NÃO RODAR EM PRODUÇÃO SEM APROVAÇÃO DO DONO DO ESCRITÓRIO.
-- ============================================================

begin;

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
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Storage: remove as policies abertas (qualquer um com a anon key lia,
-- subia e apagava arquivos). Fica só documentos_escritorio (passo 1).
drop policy if exists "documentos_insert" on storage.objects;
drop policy if exists "documentos_select" on storage.objects;
drop policy if exists "documentos_delete" on storage.objects;

commit;

-- ------------------------------------------------------------
-- CONFERÊNCIA (rodar logo depois)
-- ------------------------------------------------------------
-- Nenhuma tabela do public deve aparecer aqui:
select c.relname as tabela_sem_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
