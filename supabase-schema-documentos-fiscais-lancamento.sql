-- Rastreia se uma nota fiscal já virou lançamento contábil — evita gerar
-- duplicado e permite mostrar "Lançado" na tela em vez do botão de novo.
alter table documentos_fiscais_erp
  add column if not exists lancamento_id uuid references lancamentos_contabeis(id);
