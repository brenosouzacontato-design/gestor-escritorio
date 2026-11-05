#!/usr/bin/env bash
# Guarda o login do Emissor (sistema.emissor.app) para o robô de NF-e de
# venda (emissor.py) entrar sozinho quando a sessão cair.
#
# Uso, no servidor, como root:
#   bash /opt/gestor-robo/configurar-emissor.sh
#
# Pede o e-mail e a senha (a senha não aparece ao digitar) e grava em
# /opt/gestor-robo/dados/emissor/login.txt, que só o root lê. Sem esse
# arquivo o robô também funciona: quando precisar entrar, avisa no WhatsApp
# e espera alguém fazer o login pela tela remota.
# Dica: crie no Emissor um usuário só para o robô (Configurações → Usuários).
set -euo pipefail

PASTA=/opt/gestor-robo
DEST="$PASTA/dados/emissor"

[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"
read -rp "E-mail de login no Emissor: " EMAIL
read -rsp "Senha do Emissor (não aparece ao digitar): " SENHA; echo
[ -n "$EMAIL" ] && [ -n "$SENHA" ] || { echo "E-mail e senha são obrigatórios."; exit 1; }
umask 077
printf '%s\n%s\n' "$EMAIL" "$SENHA" > "$DEST/login.txt"
chmod 600 "$DEST/login.txt"
echo ">> Login guardado em $DEST/login.txt (só root lê)."
cd "$PASTA" && docker compose restart robo >/dev/null && echo ">> Robô reiniciado."
