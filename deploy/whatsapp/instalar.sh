#!/usr/bin/env bash
# Sobe a Evolution API (WhatsApp do gestor) num servidor Linux ligado 24h,
# no lugar do Docker do computador do escritório (iniciar-gestor.bat).
#
# Uso, no servidor (Ubuntu 22.04/24.04, como root):
#   bash instalar.sh
# Pode rodar de novo: mantém a chave, o domínio e a sessão do WhatsApp já salvos.
#
# Servidor que já rodava a 1.8.7: rodar este script de novo troca para a 2.x.
# A sessão da 1.x não serve na 2.x, então é preciso ler o QR Code de novo
# (antes, remova o aparelho antigo em WhatsApp → Aparelhos conectados). A
# chave e o endereço continuam os mesmos: o Netlify não muda, e o gestor
# descobre a versão sozinho (netlify/functions/lib/whatsapp.js).
#
# O que faz:
#   1. instala Docker e libera só as portas 22, 80 e 443;
#   2. cria /opt/gestor-whatsapp com a Evolution API 2.x, o Postgres que ela
#      exige e o Caddy na frente, que gera o certificado HTTPS sozinho;
#   3. cria a instância, configura o webhook para o Netlify e os grupos;
#   4. mostra o que colocar nas variáveis do Netlify.
set -euo pipefail

# 2.x: biblioteca do WhatsApp atualizada. Com a 1.8.7 o cliente passou a
# receber "Aguardando mensagem" no lugar do texto.
VERSAO_EVOLUTION="v2.3.7"
PASTA=/opt/gestor-whatsapp
ENV="$PASTA/.env"
WEBHOOK_BASE="https://gestorcount.netlify.app/.netlify/functions/whatsapp-webhook"

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo bash instalar.sh)."; exit 1; }
mkdir -p "$PASTA"
cd "$PASTA"

# ── 1. Docker e firewall ───────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  echo ">> Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ── 2. Configuração (gerada uma vez e guardada em .env) ────────────────
[ -f "$ENV" ] && . "$ENV"
if [ -z "${DOMINIO:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org)
  PADRAO="${IP//./-}.sslip.io"   # endereço grátis que aponta para o IP do servidor
  read -rp "Domínio do servidor [$PADRAO]: " DOMINIO
  DOMINIO=${DOMINIO:-$PADRAO}
fi
if [ -z "${WHATSAPP_WEBHOOK_SEGREDO:-}" ]; then
  read -rp "WHATSAPP_WEBHOOK_SEGREDO (o mesmo do Netlify; Enter para gerar um novo): " WHATSAPP_WEBHOOK_SEGREDO
  WHATSAPP_WEBHOOK_SEGREDO=${WHATSAPP_WEBHOOK_SEGREDO:-$(openssl rand -hex 24)}
fi
EVOLUTION_API_KEY=${EVOLUTION_API_KEY:-$(openssl rand -hex 24)}
EVOLUTION_INSTANCE=${EVOLUTION_INSTANCE:-gestor-escritorio}
POSTGRES_SENHA=${POSTGRES_SENHA:-$(openssl rand -hex 24)}

umask 077
cat > "$ENV" <<EOF
DOMINIO=$DOMINIO
EVOLUTION_API_KEY=$EVOLUTION_API_KEY
EVOLUTION_INSTANCE=$EVOLUTION_INSTANCE
WHATSAPP_WEBHOOK_SEGREDO=$WHATSAPP_WEBHOOK_SEGREDO
POSTGRES_SENHA=$POSTGRES_SENHA
EOF
umask 022

# Rotas extras de outros serviços no mesmo servidor (ex.: a tela remota do
# robô de parcelamentos, deploy/robo-parcelamentos/instalar.sh, grava
# Caddyfile.robo aqui). Sem elas, tudo vai para a Evolution, como antes.
EXTRA=""
for f in "$PASTA"/Caddyfile.*; do [ -f "$f" ] && EXTRA="$EXTRA$(cat "$f")"$'\n'; done
cat > Caddyfile <<EOF
{\$DOMINIO} {
$EXTRA	handle {
		reverse_proxy evolution:8080
	}
}
EOF

# A Evolution e o Postgres não publicam porta nenhuma: só o Caddy (HTTPS) fala com a Evolution.
# Os dados da 2.x ficam em dados-v2/ (os da 1.8.7, em dados/, não são usados mais).
cat > docker-compose.yml <<EOF
services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: \${POSTGRES_SENHA}
      POSTGRES_DB: evolution
    volumes:
      - ./dados-v2/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution -d evolution"]
      interval: 5s
      retries: 20
  evolution:
    image: evoapicloud/evolution-api:$VERSAO_EVOLUTION
    restart: always
    environment:
      SERVER_URL: https://\${DOMINIO}
      AUTHENTICATION_API_KEY: \${EVOLUTION_API_KEY}
      DEL_INSTANCE: "false"
      CONFIG_SESSION_PHONE_CLIENT: Gestor Escritorio
      CONFIG_SESSION_PHONE_NAME: Chrome
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:\${POSTGRES_SENHA}@postgres:5432/evolution?schema=public
      DATABASE_CONNECTION_CLIENT_NAME: gestor
      DATABASE_SAVE_DATA_INSTANCE: "true"
      # mensagens novas ficam salvas: é de onde sai o arquivo quando o webhook
      # chega sem o base64 (getBase64FromMediaMessage no whatsapp-webhook.js)
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      DATABASE_SAVE_MESSAGE_UPDATE: "false"
      DATABASE_SAVE_DATA_CONTACTS: "false"
      DATABASE_SAVE_DATA_CHATS: "false"
      DATABASE_SAVE_DATA_LABELS: "false"
      DATABASE_SAVE_DATA_HISTORIC: "false"
      CACHE_REDIS_ENABLED: "false"
      CACHE_LOCAL_ENABLED: "true"
      WEBHOOK_GLOBAL_ENABLED: "false"
    volumes:
      - ./dados-v2/instances:/evolution/instances
    depends_on:
      postgres:
        condition: service_healthy
  caddy:
    image: caddy:2.8
    restart: always
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMINIO: \${DOMINIO}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      - evolution
volumes:
  caddy_data:
EOF

mkdir -p dados-v2/instances dados-v2/postgres
echo ">> Subindo os containers..."
docker compose --env-file "$ENV" up -d

# ── 3. Instância, webhook e grupos ─────────────────────────────────────
API="https://$DOMINIO"
echo ">> Esperando a API responder em $API (o certificado pode levar 1 minuto)..."
for _ in $(seq 1 60); do
  curl -fsS "$API" >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS "$API" >/dev/null || { echo "A API não respondeu. Veja: docker compose logs"; exit 1; }

# Para na hora se a Evolution recusar a configuração (ela responde 400 com o motivo).
chamar() {
  local resp
  resp=$(curl -sS -X POST "$API$1" -H "Content-Type: application/json" -H "apikey: $EVOLUTION_API_KEY" -d "$2")
  case "$resp" in *'"status":4'*|*'"status":5'*) echo "Erro em $1: $resp"; exit 1;; esac
  echo "$resp"
}

if ! curl -fsS "$API/instance/connectionState/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" >/dev/null 2>&1; then
  echo ">> Criando a instância $EVOLUTION_INSTANCE..."
  chamar /instance/create "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true}" >/dev/null
fi

echo ">> Configurando o webhook e os grupos..."
# formato da 2.x: webhook dentro de "webhook" e as opções em camelCase
chamar "/webhook/set/$EVOLUTION_INSTANCE" "{\"webhook\":{\"url\":\"$WEBHOOK_BASE?segredo=$WHATSAPP_WEBHOOK_SEGREDO\",\"enabled\":true,\"byEvents\":false,\"base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}}" >/dev/null
# groupsIgnore false: o gestor lê os grupos de tarefas, documentos e pagamentos
chamar "/settings/set/$EVOLUTION_INSTANCE" '{"groupsIgnore":false,"alwaysOnline":false,"readMessages":false,"readStatus":false,"rejectCall":false,"msgCall":"","syncFullHistory":false}' >/dev/null

# ── 4. Resumo ──────────────────────────────────────────────────────────
cat <<EOF

========================================================================
 Pronto. Falta:

 1. Ler o QR Code com o WhatsApp do escritório:
      $API/manager
    (entre com a chave abaixo, abra a instância $EVOLUTION_INSTANCE e clique em conectar)

 2. No Netlify (Site configuration → Environment variables), trocar:
      EVOLUTION_API_URL        = $API
      EVOLUTION_API_KEY        = $EVOLUTION_API_KEY
      EVOLUTION_INSTANCE       = $EVOLUTION_INSTANCE
      WHATSAPP_WEBHOOK_SEGREDO = $WHATSAPP_WEBHOOK_SEGREDO
    e fazer um novo deploy (Deploys → Trigger deploy).

 Estes valores ficam guardados em $ENV (só o root lê).
========================================================================
EOF
