import { google } from 'googleapis';
import { createServer } from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'google-token.json');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:4000/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
  ],
});

console.log('\n=== Abra a URL abaixo no navegador ===');
console.log(authUrl);
console.log('======================================\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');

  const error = url.searchParams.get('error');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Erro no callback</h2><pre>URL recebida: ${req.url}\nErro Google: ${error ?? 'nenhum'}</pre>`);
    console.error('Callback sem código. URL:', req.url);
    console.error('Erro Google:', error ?? 'nenhum');
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Autenticação concluída! Pode fechar esta aba.</h2>');

    console.log('\n✅ Token salvo em google-token.json');
    console.log('   Refresh token:', tokens.refresh_token ? 'OK' : '⚠️ não retornado (revogue o acesso em myaccount.google.com/permissions e tente novamente)');
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500);
    res.end('Erro: ' + e.message);
    console.error('Erro ao obter token:', e.message);
    server.close();
    process.exit(1);
  }
});

server.listen(4000, () => {
  console.log('Aguardando callback em http://localhost:4000/callback ...');
});
