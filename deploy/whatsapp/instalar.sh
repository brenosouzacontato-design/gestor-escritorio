#!/usr/bin/env bash
# Sobe a Evolution API (WhatsApp do gestor) num servidor Linux ligado 24h,
# no lugar do Docker do computador do escritório (iniciar-gestor.bat).
#
# Uso, no servidor (Ubuntu 22.04/24.04, como root):
#   bash instalar.sh
# Pode rodar de novo: mantém a chave, o domínio e a sessão do WhatsApp já salvos.
#
# O que faz:
#   1. instala Docker e libera só as portas 22, 80 e 443;
#   2. cria /opt/gestor-whatsapp com a Evolution API (mesma versão de antes) e o
#      Caddy na frente, que gera o certificado HTTPS sozinho;
#   3. cria a instância, configura o webhook para o Netlify e os grupos;
#   4. mostra o que colocar nas variáveis do Netlify.
set -euo pipefail

VERSAO_EVOLUTION="v1.8.7"   # a mesma do iniciar-gestor.bat; o formato do webhook muda na v2
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

umask 077
cat > "$ENV" <<EOF
DOMINIO=$DOMINIO
EVOLUTION_API_KEY=$EVOLUTION_API_KEY
EVOLUTION_INSTANCE=$EVOLUTION_INSTANCE
WHATSAPP_WEBHOOK_SEGREDO=$WHATSAPP_WEBHOOK_SEGREDO
EOF
umask 022

cat > Caddyfile <<'EOF'
{$DOMINIO} {
	reverse_proxy evolution:8080
}
EOF

# A Evolution não publica porta nenhuma: só o Caddy (HTTPS) fala com ela.
cat > docker-compose.yml <<EOF
services:
  evolution:
    image: evoapicloud/evolution-api:$VERSAO_EVOLUTION
    restart: always
    environment:
      SERVER_URL: https://\${DOMINIO}
      AUTHENTICATION_API_KEY: \${EVOLUTION_API_KEY}
      DEL_INSTANCE: "false"
      CONFIG_SESSION_PHONE_CLIENT: Gestor Escritorio
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store
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
  evolution_instances:
  evolution_store:
  caddy_data:
EOF

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

chamar() { curl -sS -X POST "$API$1" -H "Content-Type: application/json" -H "apikey: $EVOLUTION_API_KEY" -d "$2"; echo; }

if ! curl -fsS "$API/instance/connectionState/$EVOLUTION_INSTANCE" -H "apikey: $EVOLUTION_API_KEY" >/dev/null 2>&1; then
  echo ">> Criando a instância $EVOLUTION_INSTANCE..."
  chamar /instance/create "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"qrcode\":true}" >/dev/null
fi

echo ">> Configurando o webhook e os grupos..."
chamar "/webhook/set/$EVOLUTION_INSTANCE" "{\"url\":\"$WEBHOOK_BASE?segredo=$WHATSAPP_WEBHOOK_SEGREDO\",\"enabled\":true,\"webhook_by_events\":false,\"webhook_base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}" >/dev/null
chamar "/settings/set/$EVOLUTION_INSTANCE" '{"groups_ignore":false,"always_online":false,"read_messages":false,"read_status":false,"reject_call":false,"sync_full_history":false}' >/dev/null

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
