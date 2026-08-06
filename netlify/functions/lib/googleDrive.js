// netlify/functions/lib/googleDrive.js
//
// Upload de arquivo pro Google Drive autenticando como o próprio usuário
// via OAuth (refresh token), sem SDK do Google — só fetch nativo. Contas
// de serviço não têm cota de armazenamento em Drive pessoal (só em Drives
// Compartilhados do Workspace), por isso o upload é feito em nome do
// usuário dono do Drive. Fica numa subpasta (lib/) pra não virar uma
// Netlify Function própria — só é usado via require() por quem precisar
// (hoje: whatsapp-webhook.js).
//
// Variáveis de ambiente necessárias no Netlify:
//   GOOGLE_OAUTH_CLIENT_ID       — Client ID do OAuth Client (tipo "Web application")
//   GOOGLE_OAUTH_CLIENT_SECRET   — Client Secret do mesmo OAuth Client
//   GOOGLE_OAUTH_REFRESH_TOKEN   — refresh token obtido uma vez via OAuth Playground
//   GOOGLE_DRIVE_FOLDER_ID       — id da pasta do Drive de destino

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

async function obterAccessToken() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN não configuradas.');
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao autenticar no Google (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.access_token;
}

// Sobe um arquivo (base64) pra pasta configurada via multipart upload
// (metadata JSON + bytes do arquivo numa requisição só).
async function uploadArquivo({ nomeArquivo, mimeType, base64, folderId }) {
  const accessToken = await obterAccessToken();
  const pastaDestino = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!pastaDestino) throw new Error('GOOGLE_DRIVE_FOLDER_ID não configurada.');

  const boundary = 'gestor-drive-upload-' + crypto.randomBytes(8).toString('hex');
  const metadata = JSON.stringify({ name: nomeArquivo, parents: [pastaDestino] });
  const bodyBuffer = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\ncontent-type: ${mimeType}\r\ncontent-transfer-encoding: base64\r\n\r\n`
    ),
    Buffer.from(base64),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const resp = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body: bodyBuffer,
  });
  if (!resp.ok) {
    throw new Error(`Falha ao subir pro Drive (${resp.status}): ${await resp.text()}`);
  }
  return resp.json(); // { id, name, webViewLink }
}

module.exports = { obterAccessToken, uploadArquivo };
