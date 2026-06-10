@echo off
echo ========================================
echo   Iniciando Gestor Escritorio Contabil
echo ========================================

echo.
echo [1/4] Iniciando Evolution API...
docker start evolution-api 2>nul || (
  echo Container nao existe, criando...
  docker run -d --name evolution-api -p 8080:8080 -e "AUTHENTICATION_API_KEY=gestor123" -e "DATABASE_PROVIDER=sqlite" -e "GROUPS_IGNORE=false" atendai/evolution-api:v1.8.2
)

echo.
echo [2/4] Aguardando Evolution API inicializar...
timeout /t 5 /nobreak >nul

echo.
echo [3/4] Configurando webhook...
curl -s -X POST http://localhost:8080/webhook/set/gestor-escritorio -H "Content-Type: application/json" -H "apikey: gestor123" -d "{\"url\":\"https://gestorcount.netlify.app/.netlify/functions/whatsapp-webhook\",\"enabled\":true,\"events\":[\"MESSAGES_UPSERT\"]}" >nul

echo.
echo [4/4] Configurando grupos...
curl -s -X POST http://localhost:8080/settings/set/gestor-escritorio -H "Content-Type: application/json" -H "apikey: gestor123" -d "{\"groups_ignore\":false,\"always_online\":false,\"read_messages\":false,\"read_status\":false,\"reject_call\":false,\"sync_full_history\":false}" >nul

echo.
echo ========================================
echo   Tudo pronto!
echo   Evolution API: http://localhost:8080/manager
echo   App: https://gestorcount.netlify.app
echo ========================================
echo.
pause
