#!/usr/bin/env bash
# Instala o certificado A1 do escritório para o robô do e-CAC (ecac.py).
#
# Uso, no servidor, como root (depois de copiar o .pfx com scp):
#   bash /opt/gestor-robo/configurar-ecac.sh /root/certificado.pfx
#
# - pede a senha sem mostrar na tela e confere se abre o certificado;
# - regrava o .pfx no formato moderno (AES) — certificados antigos (RC2) não
#   abrem no OpenSSL 3 que o navegador do robô usa;
# - guarda certificado e senha em /opt/gestor-robo/dados/certificado (só root
#   lê) e reinicia o robô.
set -euo pipefail

PASTA=/opt/gestor-robo
DEST="$PASTA/dados/certificado"
ORIGEM=${1:-}

[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
[ -n "$ORIGEM" ] && [ -f "$ORIGEM" ] || { echo "Uso: bash configurar-ecac.sh /caminho/do/certificado.pfx"; exit 1; }

mkdir -p "$DEST"
chmod 700 "$DEST"
read -rsp "Senha do certificado (não aparece ao digitar): " CERT_SENHA; echo
export CERT_SENHA

TMP=$(mktemp -d)
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

# abre o .pfx (tenta o formato antigo se o normal falhar)
if ! openssl pkcs12 -in "$ORIGEM" -nodes -passin env:CERT_SENHA -out "$TMP/tudo.pem" 2>/dev/null; then
  openssl pkcs12 -legacy -in "$ORIGEM" -nodes -passin env:CERT_SENHA -out "$TMP/tudo.pem" 2>/dev/null \
    || { echo "Não abriu: senha errada ou arquivo não é um certificado .pfx/.p12."; exit 1; }
fi

echo ">> Certificado:"
openssl x509 -in "$TMP/tudo.pem" -noout -subject -enddate | sed 's/^/   /'
if ! openssl x509 -in "$TMP/tudo.pem" -noout -checkend 0 >/dev/null; then
  echo "   ATENÇÃO: este certificado já venceu."
fi

openssl pkcs12 -export -in "$TMP/tudo.pem" -out "$TMP/certificado.pfx" \
  -passout env:CERT_SENHA -certpbe AES-256-CBC -keypbe AES-256-CBC -macalg sha256

install -m 600 "$TMP/certificado.pfx" "$DEST/certificado.pfx"
printf '%s' "$CERT_SENHA" > "$DEST/senha.txt"
chmod 600 "$DEST/senha.txt"

cd "$PASTA"
docker compose restart robo >/dev/null
cat <<EOF

========================================================================
 Certificado instalado em $DEST.
 Apague a cópia que você subiu:   shred -u "$ORIGEM"

 Primeira vez: rode a calibração com o CNPJ de uma empresa e acompanhe
 pela tela remota (o captcha do login chega no WhatsApp):
   cd $PASTA && docker compose exec robo python robo.py ecac-explorar CNPJ
 Depois, a consulta completa:
   cd $PASTA && docker compose exec robo python robo.py ecac
========================================================================
EOF
