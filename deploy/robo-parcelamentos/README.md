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

## e-CAC: situação fiscal e pagamentos (`ecac.py`)

Entra no e-CAC com o **certificado A1 do escritório** e, para cada empresa ativa com CNPJ
(menos as desmarcadas na tela Fiscal → Situação e-CAC), troca o perfil para a empresa
(procuração) e:

1. baixa o **Relatório de Situação Fiscal** (uma vez por semana, `ECAC_SITUACAO_DIAS`) e lê
   com a mesma IA do upload manual → aparece no painel do cliente e na tela Situação e-CAC;
2. consulta os **pagamentos** (DARF/DAS) dos últimos `ECAC_DIAS_PAGAMENTOS` dias e cruza com
   as guias anexadas: primeiro pelo número do documento (que vai dentro da linha digitável),
   depois por valor + vencimento quando só uma guia bate. A guia que bater fica **paga**
   (`baixa_por = robô e-CAC`); pagamento sem guia fica listado na tela para conferência.

Roda às `ECAC_HORA` nos dias da semana de `ECAC_DIAS_SEMANA` (padrão segunda e quinta, 08:00).
O login do gov.br pede **um captcha por execução** (não um por empresa): o aviso chega no
WhatsApp com o link da tela remota, igual aos parcelamentos.

### Configurar (uma vez)

1. No Supabase (SQL Editor), rode `supabase-schema-ecac.sql`.
2. Copie o certificado para o servidor e instale (a senha é pedida sem aparecer na tela e fica
   só no servidor, em `/opt/gestor-robo/dados/certificado`):
   ```
   scp certificado.pfx root@IP-DO-SERVIDOR:/root/
   ssh root@IP-DO-SERVIDOR bash /opt/gestor-robo/configurar-ecac.sh /root/certificado.pfx
   ```
3. Calibração, acompanhando pela tela remota:
   `docker compose exec robo python robo.py ecac-explorar CNPJ-DE-UMA-EMPRESA`
   — salva print e HTML de cada tela em `/opt/gestor-robo/dados/ecac/explorar/`. Se o
   e-CAC mudou algum nome de menu, ajuste `ECAC_TEXTO_SITUACAO` / `ECAC_TEXTO_PAGAMENTOS`
   (ou `ECAC_URL_SITUACAO` / `ECAC_URL_PAGAMENTOS` com o endereço direto) no `.env`.

### Comandos

```
docker compose exec robo python robo.py ecac                    # todas as empresas agora
docker compose exec robo python robo.py ecac --situacao         # força baixar o relatório de todas
docker compose exec robo python robo.py ecac 12345678000190     # só uma empresa
```

Empresa sem procuração para o certificado aparece como "sem procuração" na tela. Prints dos
erros ficam em `/opt/gestor-robo/dados/erros/ecac_*`.

## Próximos passos

- PARCMEI (Receita): agora dá pra emitir pela mesma sessão do e-CAC (`ecac.py`).
- Baixar o PDF do comprovante de cada pagamento achado no e-CAC.
- Avisar vencimento de certificado A1 dos clientes.
