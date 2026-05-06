import fs from 'fs';
import dotenv from 'dotenv';

import {
  resolveGoogleAuthConfig,
  buildGoogleClients,
  resolveDocSharingConfig,
  validateGoogleAccess,
} from '../lib/google.js';
import { validatePersonas } from '../lib/personas.js';
import { APP_ROOT, ENV_PATH, PERSONAS_PATH } from '../lib/paths.js';

dotenv.config({ path: ENV_PATH });

function fail(message) {
  console.error(`[ERRO] ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[OK] ${message}`);
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) fail('.env nao encontrado.');
  ok('.env encontrado');

  if (!process.env.GROQ_API_KEY) fail('GROQ_API_KEY nao configurada.');
  ok('GROQ_API_KEY configurada');

  if (!fs.existsSync(PERSONAS_PATH)) fail('personas.json nao encontrado.');
  ok('personas.json encontrado');

  const personas = JSON.parse(fs.readFileSync(PERSONAS_PATH, 'utf8'));
  validatePersonas(personas);
  ok(`${personas.length} persona(s) carregada(s)`);

  const googleAuth = resolveGoogleAuthConfig(process.env, APP_ROOT);
  ok(`Autenticacao Google: ${googleAuth.mode}`);
  const docSharingConfig = resolveDocSharingConfig(process.env);
  ok(`Compartilhamento Docs: ${docSharingConfig.mode}`);

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null;
  const googleClients = buildGoogleClients(googleAuth);
  await validateGoogleAccess(googleAuth, googleClients, folderId);
  ok('Acesso ao Google validado');

  console.log('\nConfiguracao validada com sucesso.');
}

try {
  await main();
} catch (error) {
  fail(error.message ?? String(error));
}
