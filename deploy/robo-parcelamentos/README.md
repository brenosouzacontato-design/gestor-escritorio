# Robô de guias de parcelamento (servidor 24h)

Busca sozinho, todo mês, as guias dos parcelamentos **PGFN** cadastrados no gestor
(tela Financeiro → Parcelamentos, com "buscar automaticamente" marcado), grava no gestor
e manda o PDF no WhatsApp. Roda no mesmo servidor da Evolution API (`deploy/whatsapp`).

## Como funciona

1. Nos dias de `DIAS_EXECUCAO` (padrão 20 e 25, às 09:00; fim de semana passa pra segunda),
   o robô lê os parcelamentos PGFN ativos que ainda não têm guia com vencimento no mês.
2. Avisa no WhatsApp: *"N guias pra buscar… abra o link e toque em I am human"*.
3. Para cada um, abre o SISPAR público (o "DARF prestação" do Regularize — não precisa de
   login gov.br), preenche CPF/CNPJ e conta e **espera o captcha**. Você abre o link no
   celular (tela remota, com usuário e senha), toca no captcha e o robô segue sozinho.
   Se ninguém resolver em `MINUTOS_CAPTCHA` (30), ele pula e avisa. Lembrete a cada 10 min.
4. Emite a parcela em aberto mais antiga, confere se o PDF é do devedor/conta certos,
   grava em `documentos` (ligada ao parcelamento e à obrigação do mês, se houver), atualiza
   parcela X/Y, valor e status no gestor e manda o PDF no WhatsApp.
5. "Situação do parcelamento não permite emissão" vira alerta na tela do gestor.
6. No fim, resumo no WhatsApp — incluindo os PARCMEI sem guia do mês (ainda manuais).

Telegram é opcional: preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no `.env`.

## Instalar (no servidor, como root)

Do computador, copie esta pasta e o instalador da Evolution atualizado:

```
scp -r deploy/robo-parcelamentos root@IP-DO-SERVIDOR:
scp deploy/whatsapp/instalar.sh root@IP-DO-SERVIDOR:/opt/gestor-whatsapp/instalar.sh
ssh root@IP-DO-SERVIDOR
bash robo-parcelamentos/instalar.sh
```

Ele pede a `SUPABASE_SERVICE_KEY` (a mesma do Netlify) e o WhatsApp que recebe os avisos,
gera a senha da tela remota, publica a tela em `https://SEU-DOMINIO/robo/` pelo Caddy da
Evolution e manda uma mensagem de teste.

## Comandos

```
cd /opt/gestor-robo
docker compose exec robo python robo.py rodar            # roda agora
docker compose exec robo python robo.py rodar --forcar   # inclui quem já tem guia do mês
docker compose exec robo python robo.py testar-aviso     # testa WhatsApp/Telegram
docker compose logs -f robo                              # acompanha
```

Prints de tela de erro ficam em `/opt/gestor-robo/dados/erros/`.

## Próximos passos

- PARCMEI (Receita): exige login com certificado no eCAC (ou o Integra Contador).
- Avisar vencimento de certificado A1 dos clientes.
