# WhatsApp do gestor num servidor 24h

Hoje a Evolution API (a ponte entre o WhatsApp do escritório e o gestor) roda em Docker no
computador do escritório, pelo `iniciar-gestor.bat`. Se o computador desliga, o gestor para de
receber tarefas, documentos e comprovantes pelos grupos, e para de mandar lembretes.

A solução é rodar a mesma Evolution API num servidor alugado (VPS), ligado o tempo todo. O código
do gestor não muda: só o endereço nas variáveis do Netlify.

## Custo

- VPS Linux com 1–2 GB de RAM: cerca de R$ 25 a 45 por mês (Hostinger, Contabo, Hetzner…).
- Endereço HTTPS: grátis, com `<ip-com-traços>.sslip.io` (o script sugere sozinho). Se preferir
  um domínio próprio (ex.: `whatsapp.seuescritorio.com.br`), aponte um registro A para o IP do
  servidor antes de rodar o script.

## Passo a passo

1. **Contratar o VPS** com Ubuntu 24.04 (ou 22.04). Anote o IP e a senha de root.

2. **Mandar o script para o servidor**, do computador do escritório (PowerShell, na pasta do projeto):

   ```
   scp deploy/whatsapp/instalar.sh root@IP-DO-SERVIDOR:
   ```

   (Ou abra o terminal do servidor pelo painel do provedor, rode `nano instalar.sh`, cole o
   conteúdo do arquivo e salve com Ctrl+O, Enter, Ctrl+X.)

3. **Rodar o script** no servidor:

   ```
   ssh root@IP-DO-SERVIDOR
   bash instalar.sh
   ```

   Ele pergunta o domínio (Enter aceita o sugerido) e o `WHATSAPP_WEBHOOK_SEGREDO`. Use o mesmo
   valor que já está no Netlify, ou dê Enter para gerar um novo. No fim, mostra os valores para o
   Netlify.

4. **Desligar a Evolution do computador**, para não haver duas conectadas ao mesmo número (cada
   mensagem viraria duas tarefas):

   ```
   docker stop evolution-api
   docker update --restart=no evolution-api
   ```

5. **Conectar o WhatsApp**: abra `https://SEU-DOMINIO/manager`, entre com a chave mostrada pelo
   script, abra a instância `gestor-escritorio`, clique em conectar e leia o QR Code com o celular
   do escritório (WhatsApp → Aparelhos conectados → Conectar um aparelho).

6. **Atualizar o Netlify** (Site configuration → Environment variables) com os quatro valores
   mostrados no fim do script: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` e
   `WHATSAPP_WEBHOOK_SEGREDO`. Depois, Deploys → Trigger deploy.

7. **Testar**: mande uma mensagem no grupo de tarefas e confira se a tarefa aparece no gestor;
   mande um lembrete de honorários e confira se chega.

Depois disso o `iniciar-gestor.bat` não é mais necessário.

## Manutenção

Tudo fica em `/opt/gestor-whatsapp` no servidor. Os containers voltam sozinhos se o servidor
reiniciar.

- Ver se está rodando: `cd /opt/gestor-whatsapp && docker compose ps`
- Ver os logs: `docker compose logs --tail 100 evolution`
- Reiniciar: `docker compose restart`
- Rever as chaves: `cat /opt/gestor-whatsapp/.env`

Se o WhatsApp desconectar (por exemplo, o celular ficou muito tempo sem internet ou o aparelho foi
removido), basta ler o QR Code de novo pelo `/manager`. As configurações continuam salvas.

## Observações

- A Evolution API usa o WhatsApp Web (não é a API oficial da Meta). Funciona com grupos, mas existe
  um risco pequeno de bloqueio se o número mandar muitas mensagens para quem não o tem salvo. A
  API oficial não serve aqui porque não funciona com grupos.
- A versão continua a 1.8.7, a mesma do computador. A 2.x muda o formato do webhook e exigiria
  ajustar o `whatsapp-webhook.js`.
- A chave da API deixa de ser `gestor123`: o script gera uma chave aleatória. E a API só responde
  por HTTPS.
