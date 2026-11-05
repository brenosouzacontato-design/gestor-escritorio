-- ============================================================
-- SOLICITAÇÃO DE NF-e DE VENDA — Gestor Escritório Contábil
-- O cliente do escritório pede a nota de venda (produtos) pelo app
-- instalável ?pedido=<token do painel> (src/pages/pedidonfe). Ele guarda os
-- próprios destinatários (os clientes dele) e produtos para reaproveitar.
-- Cada pedido manda um resumo pelo WhatsApp (netlify/functions/nfe-solicitacao.js)
-- e aparece para o escritório em Fiscal → Pedidos de NF-e.
-- Depois de emitida, a NF (número, chave, PDF/XML) fica gravada no pedido.
--
-- Segurança (docs/seguranca-rls.md): RLS ligado, só o escritório lê/grava
-- direto; o cliente passa sempre pela function, que confere o token do
-- painel e usa a service key. Aditivo e seguro rodar mais de uma vez.
-- ============================================================

-- Clientes do cliente (quem recebe a nota)
create table if not exists nfe_destinatarios (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes(id) on delete cascade,
  documento      text,                       -- CPF ou CNPJ, só dígitos
  nome           text not null,
  ie             text,                       -- inscrição estadual ('ISENTO' quando não tiver)
  email          text,
  telefone       text,
  cep            text,
  logradouro     text,
  numero         text,
  complemento    text,
  bairro         text,
  municipio      text,
  uf             text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_nfe_destinatarios_cliente on nfe_destinatarios(cliente_id, nome);
create unique index if not exists uq_nfe_destinatarios_documento
  on nfe_destinatarios(cliente_id, documento) where documento is not null;

-- Produtos que o cliente vende
create table if not exists nfe_produtos (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references clientes(id) on delete cascade,
  descricao       text not null,
  codigo          text,                      -- código interno do cliente
  ncm             text,
  unidade         text not null default 'UN',
  valor_unitario  numeric(14,4),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists idx_nfe_produtos_cliente on nfe_produtos(cliente_id, descricao);

-- Pedidos de nota. Destinatário e itens ficam copiados no pedido (o
-- cadastro pode mudar depois sem alterar o que foi pedido).
create table if not exists nfe_solicitacoes (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references clientes(id) on delete cascade,
  destinatario_id      uuid references nfe_destinatarios(id) on delete set null,
  destinatario         jsonb not null,       -- cópia do cadastro na hora do pedido
  itens                jsonb not null,       -- [{ produto_id, descricao, codigo, ncm, unidade, quantidade, valor_unitario, valor_total }]
  valor_produtos       numeric(14,2) not null default 0,
  frete_modalidade     text not null default 'sem_frete'
                       check (frete_modalidade in ('sem_frete', 'emitente', 'destinatario', 'terceiros')),
  frete_valor          numeric(14,2) not null default 0,
  valor_total          numeric(14,2) not null default 0,
  observacao           text,
  status               text not null default 'recebida'
                       check (status in ('recebida', 'em_emissao', 'emitida', 'cancelada', 'erro')),
  status_mensagem      text,                 -- motivo do erro/cancelamento ou recado do escritório
  -- resumo pelo WhatsApp
  whatsapp_destino     text,
  whatsapp_enviado_em  timestamptz,
  whatsapp_erro        text,
  -- nota emitida (preenchido pelo escritório ou pelo robô)
  nfe_numero           text,
  nfe_chave            text,
  nfe_pdf_path         text,                 -- bucket documentos
  nfe_xml_path         text,
  emitida_em           timestamptz,
  nfe_enviada_em       timestamptz,          -- PDF/XML entregue ao cliente pelo WhatsApp
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
create index if not exists idx_nfe_solicitacoes_cliente on nfe_solicitacoes(cliente_id, criado_em desc);
create index if not exists idx_nfe_solicitacoes_status on nfe_solicitacoes(status, criado_em desc);

alter table nfe_destinatarios enable row level security;
alter table nfe_produtos enable row level security;
alter table nfe_solicitacoes enable row level security;

drop policy if exists nfe_destinatarios_escritorio on nfe_destinatarios;
drop policy if exists nfe_produtos_escritorio on nfe_produtos;
drop policy if exists nfe_solicitacoes_escritorio on nfe_solicitacoes;
do $$
declare
  cond text := 'true';  -- antes do passo 1 do RLS: qualquer login do gestor
begin
  if exists (select 1 from pg_proc where proname = 'is_escritorio') then
    cond := '(select is_escritorio())';
  end if;
  execute format('create policy nfe_destinatarios_escritorio on nfe_destinatarios for all to authenticated using (%s) with check (%s)', cond, cond);
  execute format('create policy nfe_produtos_escritorio on nfe_produtos for all to authenticated using (%s) with check (%s)', cond, cond);
  execute format('create policy nfe_solicitacoes_escritorio on nfe_solicitacoes for all to authenticated using (%s) with check (%s)', cond, cond);
end $$;
