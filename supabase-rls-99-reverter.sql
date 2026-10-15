-- ============================================================
-- RLS — ROLLBACK DE EMERGÊNCIA do passo 2
-- Ver docs/seguranca-rls.md. Volta o banco ao comportamento de antes
-- (tudo aberto pra anon key). Usar só se o app quebrar depois do passo 2 e
-- não der pra corrigir na hora; as policies do passo 1 ficam guardadas
-- (inertes) pra religar depois com supabase-rls-02-ativar.sql.
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
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;

-- Policies abertas do Storage, iguais às de supabase-schema-documentos.sql
drop policy if exists "documentos_insert" on storage.objects;
create policy "documentos_insert" on storage.objects
  for insert with check (bucket_id = 'documentos');
drop policy if exists "documentos_select" on storage.objects;
create policy "documentos_select" on storage.objects
  for select using (bucket_id = 'documentos');
drop policy if exists "documentos_delete" on storage.objects;
create policy "documentos_delete" on storage.objects
  for delete using (bucket_id = 'documentos');

commit;
