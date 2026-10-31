# Robô de parcelamentos: Chromium visível numa tela virtual (Xvfb), que pode
# ser aberta pelo celular via noVNC (atrás do Caddy, com senha) pra resolver
# o captcha do SISPAR.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

ENV DEBIAN_FRONTEND=noninteractive TZ=America/Sao_Paulo DISPLAY=:99 PYTHONUNBUFFERED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify supervisor tzdata fonts-dejavu \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py supervisord.conf ./

EXPOSE 6080
CMD ["supervisord", "-c", "/app/supervisord.conf"]
