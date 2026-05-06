import { google } from 'googleapis';
import { createServer } from 'http';
import { randomBytes } from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
import { CREDENTIALS_DIR, ENV_PATH, GOOGLE_TOKEN_PATH, toRepoRelative } from '../lib/paths.js';

dotenv.config({ path: ENV_PATH });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:4000/callback';
const OAUTH_STATE = randomBytes(24).toString('hex');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('[ERRO] GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET sao obrigatorios para o fluxo OAuth.');
  console.error('       Se voce usa service account, este script e opcional.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  state: OAUTH_STATE,
  scope: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
  ],
});

console.log('\n=== Abra a URL abaixo no navegador ===');
console.log(authUrl);
console.log('=====================================\n');

const server = createServer(async (req, res) => {
  const callbackUrl = new URL(req.url, REDIRECT_URI);
  const code = callbackUrl.searchParams.get('code');
  const error = callbackUrl.searchParams.get('error');
  const state = callbackUrl.searchParams.get('state');

  if (state !== OAUTH_STATE) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>Estado OAuth invalido. Feche esta aba e execute o fluxo novamente.</h2>');
    console.error('Callback OAuth com state invalido.');
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Erro no callback</h2><pre>URL recebida: ${req.url}\nErro Google: ${error ?? 'nenhum'}</pre>`);
    console.error('Callback sem codigo. URL:', req.url);
    console.error('Erro Google:', error ?? 'nenhum');
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const tokenPayload = {
      ...tokens,
      token_created_at: Date.now(),
    };

    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
    fs.writeFileSync(GOOGLE_TOKEN_PATH, JSON.stringify(tokenPayload, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Autenticacao concluida. Pode fechar esta aba.</h2>');

    console.log(`\nToken salvo em ${toRepoRelative(GOOGLE_TOKEN_PATH)}`);
    console.log(
      'Refresh token:',
      tokens.refresh_token
        ? 'OK'
        : 'nao retornado (revogue o acesso em myaccount.google.com/permissions e tente novamente)',
    );

    if (Number.isFinite(tokenPayload.refresh_token_expires_in)) {
      const days = Math.round(tokenPayload.refresh_token_expires_in / 86400);
      console.log(`Validade estimada do refresh token: ${days} dia(s).`);
      console.log('Se o app OAuth estiver em modo Testing, mude para In production para evitar expiracao semanal.');
    }

    server.close();
    process.exit(0);
  } catch (requestError) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Erro: ${requestError.message}`);
    console.error('Erro ao obter token:', requestError.message);
    server.close();
    process.exit(1);
  }
});

server.listen(4000, () => {
  console.log('Aguardando callback em http://localhost:4000/callback ...');
});
