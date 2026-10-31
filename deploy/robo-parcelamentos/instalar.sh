#!/usr/bin/env bash
# Sobe o robô de guias de parcelamento no mesmo servidor da Evolution API
# (deploy/whatsapp). Precisa que o deploy/whatsapp/instalar.sh já tenha rodado.
#
# Uso, no servidor, como root, de dentro desta pasta copiada pro servidor:
#   bash instalar.sh
# Pode rodar de novo (atualização): mantém o .env e a senha da tela remota.
#
# O que faz:
#   1. copia o robô para /opt/gestor-robo e pede as configurações (uma vez);
#   2. publica a tela remota (noVNC) em https://SEU-DOMINIO/robo/, com senha,
#      pelo Caddy que já atende a Evolution;
#   3. constrói e sobe o container e manda uma mensagem de teste no WhatsApp.
set -euo pipefail

ORIGEM=$(cd "$(dirname "$0")" && pwd)
PASTA=/opt/gestor-robo
WPP=/opt/gestor-whatsapp
ENV="$PASTA/.env"

[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo bash instalar.sh)."; exit 1; }
[ -f "$WPP/.env" ] || { echo "Não achei $WPP/.env — rode antes o deploy/whatsapp/instalar.sh."; exit 1; }
# shellcheck disable=SC1091
. "$WPP/.env"   # DOMINIO, EVOLUTION_API_KEY, EVOLUTION_INSTANCE

mkdir -p "$PASTA/dados"
cp "$ORIGEM"/{Dockerfile,docker-compose.yml,requirements.txt,supervisord.conf,*.py} "$PASTA"/
cd "$PASTA"

# ── 1. Configuração (perguntada uma vez, guardada em .env) ─────────────
[ -f "$ENV" ] && . "$ENV"
if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  read -rp "SUPABASE_URL [https://kaheieshcaqmhqzvwino.supabase.co]: " SUPABASE_URL
  SUPABASE_URL=${SUPABASE_URL:-https://kaheieshcaqmhqzvwino.supabase.co}
  read -rsp "SUPABASE_SERVICE_KEY (a mesma do Netlify; não aparece ao digitar): " SUPABASE_SERVICE_KEY; echo
fi
if [ -z "${NOTIFICAR_WHATSAPP:-}" ]; then
  read -rp "WhatsApp que recebe os avisos (só números, com 55 e DDD; vários separados por vírgula): " NOTIFICAR_WHATSAPP
fi
ROBO_USUARIO=${ROBO_USUARIO:-breno}
if [ -z "${ROBO_SENHA:-}" ]; then
  ROBO_SENHA=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
fi
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
DIAS_EXECUCAO=${DIAS_EXECUCAO:-20,25}
HORA_EXECUCAO=${HORA_EXECUCAO:-09:00}
MINUTOS_CAPTCHA=${MINUTOS_CAPTCHA:-30}

umask 077
cat > "$ENV" <<EOF
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY
EVOLUTION_API_URL=http://evolution:8080
EVOLUTION_API_KEY=$EVOLUTION_API_KEY
EVOLUTION_INSTANCE=$EVOLUTION_INSTANCE
NOTIFICAR_WHATSAPP=$NOTIFICAR_WHATSAPP
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
LINK_TELA_REMOTA="https://$DOMINIO/robo/vnc.html?autoconnect=1&resize=scale&path=robo/websockify"
DIAS_EXECUCAO=$DIAS_EXECUCAO
HORA_EXECUCAO=$HORA_EXECUCAO
MINUTOS_CAPTCHA=$MINUTOS_CAPTCHA
ROBO_USUARIO=$ROBO_USUARIO
ROBO_SENHA=$ROBO_SENHA
TZ=America/Sao_Paulo
EOF
umask 022

# ── 2. Tela remota no Caddy da Evolution ───────────────────────────────
HASH=$(docker run --rm caddy:2.8 caddy hash-password --plaintext "$ROBO_SENHA")
cat > "$WPP/Caddyfile.robo" <<EOF
	handle_path /robo/* {
		basic_auth {
			$ROBO_USUARIO $HASH
		}
		reverse_proxy robo-parcelamentos:6080
	}
EOF
# mesmo modelo de Caddyfile do deploy/whatsapp/instalar.sh (que também inclui Caddyfile.*)
EXTRA=""
for f in "$WPP"/Caddyfile.*; do [ -f "$f" ] && EXTRA="$EXTRA$(cat "$f")"$'\n'; done
cat > "$WPP/Caddyfile" <<EOF
{\$DOMINIO} {
$EXTRA	handle {
		reverse_proxy evolution:8080
	}
}
EOF

# ── 3. Sobe o robô e recarrega o Caddy ─────────────────────────────────
echo ">> Construindo o robô (a primeira vez demora alguns minutos)..."
docker compose build -q
docker compose up -d
(cd "$WPP" && docker compose --env-file "$WPP/.env" restart caddy >/dev/null)

sleep 8
echo ">> Mandando mensagem de teste..."
docker compose exec -T robo python robo.py testar-aviso || true

cat <<EOF

========================================================================
 Robô no ar. Ele roda sozinho nos dias $DIAS_EXECUCAO às $HORA_EXECUCAO
 (se cair em fim de semana, na segunda) e avisa no WhatsApp.

 Tela remota (pra resolver o captcha, abre no celular):
   https://$DOMINIO/robo/vnc.html?autoconnect=1&resize=scale&path=robo/websockify
   usuário: $ROBO_USUARIO
   senha:   $ROBO_SENHA

 Rodar agora:        cd $PASTA && docker compose exec robo python robo.py rodar
 Ver o que ele faz:  cd $PASTA && docker compose logs -f robo
 Configurações:      $ENV (dias, hora, números, Telegram) — depois: docker compose up -d
========================================================================
EOF
