-- Lançamentos do extrato bancário usados na emissão de NFS-e (Emitir NFS-e → Emitir pelo extrato).
-- Cada crédito do extrato fica guardado com o que foi feito com ele, para nada se perder:
--   pendente     ainda não tratado (aparece em "Pendentes de extratos anteriores")
--   em_lote      virou nota (lote_id)
--   ja_tem_nota  já havia nota para esse PIX
--   ignorado     não é nota (motivo: transferência entre contas, reembolso, rendimento...)
-- O mesmo extrato enviado de novo não duplica (chave: data | descrição | valor | ordem no dia).
-- Ver netlify/functions/lib/nfse/extrato.js e a ação extrato_* de netlify/functions/nfse.js.
-- Mesma regra das outras nfse_*: usuário logado só lê; escrita pela function (service role).
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists nfse_extrato_lancamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  chave text not null,
  data date not null,                 -- data do lançamento no extrato
  data_pix date,                      -- data do PIX (o Itaú mostra no fim da descrição)
  descricao text not null,
  valor numeric(15,2) not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'em_lote', 'ja_tem_nota', 'ignorado')),
  motivo text,
  lote_id uuid references nfse_lotes(id) on delete set null,
  nome text,                          -- quem pagou (o que saiu na nota)
  cpf text,
  arquivo text,
  criado_em timestamptz not null default now(),
  tratado_em timestamptz,
  unique (cliente_id, chave)
);
create index if not exists nfse_extrato_lancamentos_pendentes_idx on nfse_extrato_lancamentos (cliente_id, situacao, data);

alter table nfse_extrato_lancamentos enable row level security;
drop policy if exists "nfse_extrato_lancamentos_leitura_autenticado" on nfse_extrato_lancamentos;
create policy "nfse_extrato_lancamentos_leitura_autenticado" on nfse_extrato_lancamentos for select to authenticated using (true);
