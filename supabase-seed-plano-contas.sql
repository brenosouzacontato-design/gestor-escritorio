-- ============================================================
-- SEED DE EXEMPLO do plano de contas
-- Você já tem o plano de contas completo do OneFlow (743 contas) usado
-- no Conciliador. Não precisa digitar tudo de novo aqui: exporte esse
-- plano em JSON e rode o script scripts/import-plano-contas.js
-- para popular a tabela contas_contabeis automaticamente, empresa por empresa.
--
-- As linhas abaixo são só um exemplo mínimo pra você testar a tela
-- antes de importar o plano completo.
-- ============================================================

-- Troque :empresa_id pelo uuid real da empresa (linha de "clientes") de teste
-- (select id from clientes where nome = 'NOME DA EMPRESA')

insert into contas_contabeis (empresa_id, codigo, nome, tipo, natureza, nivel, aceita_lancamento, grupo_dre) values
(:'empresa_id', '1',       'ATIVO',                         'ativo',    'devedora', 1, false, null),
(:'empresa_id', '1.1',     'ATIVO CIRCULANTE',              'ativo',    'devedora', 2, false, null),
(:'empresa_id', '1.1.01',  'Caixa Geral',                   'ativo',    'devedora', 3, true,  null),
(:'empresa_id', '1.1.02',  'Banco Conta Movimento',         'ativo',    'devedora', 3, true,  null),
(:'empresa_id', '2',       'PASSIVO',                       'passivo',  'credora',  1, false, null),
(:'empresa_id', '2.1',     'PASSIVO CIRCULANTE',            'passivo',  'credora',  2, false, null),
(:'empresa_id', '2.1.01',  'Fornecedores',                  'passivo',  'credora',  3, true,  null),
(:'empresa_id', '2.1.02',  'Impostos a Recolher',           'passivo',  'credora',  3, true,  null),
(:'empresa_id', '3',       'PATRIMÔNIO LÍQUIDO',            'patrimonio_liquido', 'credora', 1, false, null),
(:'empresa_id', '3.1.01',  'Capital Social',                'patrimonio_liquido', 'credora', 3, true, null),
(:'empresa_id', '4',       'RECEITAS',                      'receita',  'credora',  1, false, null),
(:'empresa_id', '4.1.01',  'Receita de Vendas de Serviços', 'receita',  'credora',  3, true,  'receita_bruta'),
(:'empresa_id', '4.1.02',  'Simples Nacional a Recolher (DAS)', 'despesa', 'devedora', 3, true, 'deducao'),
(:'empresa_id', '5',       'CUSTOS',                        'custo',    'devedora', 1, false, null),
(:'empresa_id', '5.1.01',  'Custo dos Serviços Prestados',  'custo',    'devedora', 3, true,  'custo'),
(:'empresa_id', '6',       'DESPESAS',                      'despesa',  'devedora', 1, false, null),
(:'empresa_id', '6.1.01',  'Despesas com Pessoal',          'despesa',  'devedora', 3, true,  'despesa_administrativa'),
(:'empresa_id', '6.1.02',  'Despesas Bancárias',            'despesa',  'devedora', 3, true,  'despesa_financeira'),
(:'empresa_id', '6.1.03',  'Despesas Comerciais',           'despesa',  'devedora', 3, true,  'despesa_comercial');
