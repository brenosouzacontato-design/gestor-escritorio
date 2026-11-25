-- Emissão agendada de NFS-e (Emitir NFS-e → Notas recorrentes → "Agendar").
-- Também pelo grupo Documentos do WhatsApp: "agendar nfse <empresa> <modelo> <valor> <dd/mm> <hh:mm>".
-- O escritório escolhe um modelo recorrente, o dia e a hora, o valor e a data do serviço; o robô
-- nfse-agendamentos-cron (a cada 5 minutos) emite a nota na hora marcada, com as mesmas regras da
-- emissão pela tela, e manda o PDF e o XML no WhatsApp da empresa (se marcado).
--   tipo     'periodo': é a nota da semana/mês do modelo (o período sai de "a emitir")
--            'avulsa' : nota extra com os dados do modelo (não conta como a nota do período)
--   periodo  primeiro dia do período da data do serviço (segunda-feira ou dia 1º)
--   situacao agendada → processando → emitida | erro;  cancelada (pela tela, antes de sair)
-- Ver netlify/functions/lib/nfse/agendamentos.js e as ações agendamento_* de netlify/functions/nfse.js.
-- Rodar no SQL Editor do Supabase. Idempotente.

create table if not exists nfse_agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  recorrente_id uuid not null references nfse_recorrentes(id) on delete cascade,
  ambiente text not null check (ambiente in ('homologacao','producao')),
  executar_em timestamptz not null,
  tipo text not null default 'periodo' check (tipo in ('periodo','avulsa')),
  periodo date not null,
  data_servico date not null,
  valor numeric(15,2) not null check (valor > 0),
  descricao text,                         -- vazio = a do modelo
  enviar_whatsapp boolean not null default true,
  situacao text not null default 'agendada' check (situacao in ('agendada','processando','emitida','erro','cancelada')),
  nota_id uuid references nfse_notas(id) on delete set null,
  mensagem text,                          -- resultado da emissão (ou o erro)
  envio text,                             -- resultado do envio no WhatsApp
  criado_por text,
  avisar_jid text,                        -- agendado pelo grupo do WhatsApp: o resultado é avisado lá
  criado_em timestamptz not null default now(),
  executado_em timestamptz
);
alter table nfse_agendamentos add column if not exists avisar_jid text;
create index if not exists nfse_agendamentos_fila_idx on nfse_agendamentos (executar_em) where situacao = 'agendada';
create index if not exists nfse_agendamentos_modelo_idx on nfse_agendamentos (recorrente_id);

-- Usuário logado só lê; criar, cancelar e executar passam pelas Netlify Functions (service role)
alter table nfse_agendamentos enable row level security;
drop policy if exists "nfse_agendamentos_leitura_autenticado" on nfse_agendamentos;
create policy "nfse_agendamentos_leitura_autenticado" on nfse_agendamentos for select to authenticated using (true);
