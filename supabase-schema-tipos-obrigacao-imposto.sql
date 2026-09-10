-- ============================================================
-- MARCAR TIPOS DE OBRIGAÇÃO QUE SÃO IMPOSTO (pagamento de tributo)
-- Usado pela "Linha do tempo de vencimentos" do Painel do Cliente pra
-- mostrar só o que é imposto a pagar, não toda obrigação/declaração do
-- mês (Documentos, Extrato Bancário, Folha, NFS-e etc. continuam
-- aparecendo normalmente nas abas de módulo, só saem da timeline).
-- ============================================================

alter table tipos_obrigacao
  add column if not exists eh_imposto boolean not null default false;

update tipos_obrigacao set eh_imposto = true
  where nome in ('PGDAS', 'PGMEI', 'PARCELAMENTO MEI', 'PARCELAMENTO SIMPLES',
                 'PARCELAMENTO SIMPLIFICADO RFB', 'RECALCULO INSS', 'RECALCULO PGDAS',
                 'INSS Mensal');
