// netlify/functions/lib/googleDrive.js
//
// Upload de arquivo pro Google Drive usando uma conta de serviço (sem SDK
// do Google, só fetch + crypto nativo do Node — mesmo estilo enxuto dos
// outros arquivos deste projeto). Fica numa subpasta (lib/) pra não virar
// uma Netlify Function própria — só é usado via require() por quem
// precisar (hoje: whatsapp-webhook.js).
//
// Variáveis de ambiente necessárias no Netlify:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL    — client_email do JSON da conta de serviço
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — private_key do JSON (com \n literais, ver conversão abaixo)
//   GOOGLE_DRIVE_FOLDER_ID          — id da pasta do Drive (compartilhada com a conta de serviço)

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
const SCOPE = 'https://www.googleapis.com/auth/drive';

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Monta e assina o JWT do fluxo "conta de serviço" (RFC 7523), sem
// depender da lib googleapis — só o crypto nativo do Node (RSA-SHA256).
function assinarJwt(clientEmail, privateKeyPem) {
  const agora = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: agora,
    exp: agora + 3600,
  }));
  const assinatura = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKeyPem);
  const assinaturaUrl = Buffer.from(assinatura).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${assinaturaUrl}`;
}

async function obterAccessToken() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // no Netlify a variável vem numa linha só, com "\n" literal em vez de
  // quebra de linha de verdade — converte de volta antes de usar a chave
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY não configuradas.');
  }
  console.log('DEBUG_KEY clientEmail=' + clientEmail + ' rawLen=' + (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').length + ' keyLen=' + privateKey.length + ' first30=' + privateKey.slice(0, 30) + ' last30=' + privateKey.slice(-30))

  const jwt = assinarJwt(clientEmail, privateKey);
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
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
