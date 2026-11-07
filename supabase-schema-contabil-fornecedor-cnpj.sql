-- ============================================================
-- MÓDULO CONTÁBIL — CNPJ/CPF na conta do fornecedor
-- No OneFlow os fornecedores têm conta individual, criada pelo Fiscal
-- (provisão da nota). O Gestor só exporta a BAIXA (pagamento no extrato),
-- e a planilha de importação aceita o CNPJ no lugar da conta contábil —
-- é assim que a baixa cai na conta certa do fornecedor no OneFlow.
-- Rodar ANTES de publicar a exportação p/ OneFlow.
-- ============================================================

alter table contas_contabeis add column if not exists cnpj text;

create index if not exists idx_contas_contabeis_cnpj on contas_contabeis(empresa_id, cnpj);

-- Preenche o CNPJ das contas de fornecedor já existentes a partir das notas
-- de entrada sincronizadas (mesmo nome = mesmo fornecedor).
update contas_contabeis c
   set cnpj = d.cnpj
  from (
    select distinct on (cliente_id, lower(trim(razao_social_terceiro)))
           cliente_id,
           lower(trim(razao_social_terceiro)) as nome,
           regexp_replace(cnpj_cpf_terceiro, '\D', '', 'g') as cnpj
      from documentos_fiscais_erp
     where tipo_movimento = 'entrada'
       and coalesce(cnpj_cpf_terceiro, '') <> ''
       and coalesce(razao_social_terceiro, '') <> ''
     order by cliente_id, lower(trim(razao_social_terceiro)), sincronizado_em desc
  ) d
 where c.empresa_id = d.cliente_id
   and lower(trim(c.nome)) = d.nome
   and c.cnpj is null;
