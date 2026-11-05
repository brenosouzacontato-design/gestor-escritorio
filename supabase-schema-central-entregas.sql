-- ============================================================
-- CENTRAL DE ENTREGAS — Gestor Escritório Contábil
-- Tela "Entregas" (src/pages/entregas): entrega das guias anexadas pelo
-- WhatsApp do escritório (netlify/functions/entregas-enviar.js), aviso
-- quando o cliente abre a guia pelo painel (painel-evento.js) e chave pra
-- desligar o painel de uma empresa.
-- Aditivo: só colunas novas com default; nada existente muda.
-- ============================================================

-- 1) Painel ligado/desligado e para onde mandar as guias de cada empresa
alter table clientes
  add column if not exists painel_ativo boolean not null default true,
  -- número (com DDD) ou grupo do WhatsApp (…@g.us). Vazio = usa clientes.telefone
  add column if not exists whatsapp_entrega text;

-- 2) Entrega de cada guia (documentos)
alter table documentos
  add column if not exists entregue_em timestamptz,      -- quando foi entregue (null = a entregar)
  add column if not exists entrega_canal text,           -- 'whatsapp' | 'manual'
  add column if not exists entrega_destino text,         -- número/grupo usado no envio
  add column if not exists entrega_erro text,            -- última falha de envio (null = sem erro)
  add column if not exists aberto_em timestamptz,        -- 1ª vez que o cliente abriu pelo painel
  add column if not exists aberto_ultimo_em timestamptz, -- última vez
  add column if not exists aberto_vezes integer not null default 0;

create index if not exists idx_documentos_entregue on documentos(entregue_em);

-- 3) Qual guia o cliente abriu (antes só ia a descrição)
alter table painel_eventos
  add column if not exists documento_id uuid references documentos(id) on delete set null;

-- 4) Painel desligado: o link público pergunta por aqui (AcessoPainel.jsx).
-- plpgsql de propósito: só resolve painel_cliente_id() (supabase-rls-01) na
-- hora de rodar, então o script não quebra num banco sem ele.
create or replace function public.painel_ativo()
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return coalesce((select c.painel_ativo from clientes c where c.id = painel_cliente_id()), true);
exception when undefined_function then
  return true;
end;
$$;
revoke all on function public.painel_ativo() from public;
grant execute on function public.painel_ativo() to anon, authenticated;
