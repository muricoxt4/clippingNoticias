import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import {
  resolveGoogleAuthConfig,
  buildGoogleClients,
  resolveDocSharingConfig,
  validateGoogleAccess,
} from './lib/google.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

function fail(message) {
  console.error(`[ERRO] ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`[OK] ${message}`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalStringArray(value) {
  return value == null || (
    Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function validatePersonas(personas) {
  if (!Array.isArray(personas) || !personas.length) {
    fail('personas.json esta vazio ou invalido.');
  }

  personas.forEach((persona, index) => {
    if (!isNonEmptyString(persona.id)) fail(`persona ${index + 1}: campo "id" ausente ou invalido.`);
    if (!isNonEmptyString(persona.nome)) fail(`persona ${index + 1}: campo "nome" ausente ou invalido.`);
    if (!isNonEmptyString(persona.descricao)) fail(`persona ${index + 1}: campo "descricao" ausente ou invalido.`);
    if (!isOptionalStringArray(persona.prioridades)) fail(`persona ${persona.id}: campo "prioridades" invalido.`);
    if (!isOptionalStringArray(persona.evitar)) fail(`persona ${persona.id}: campo "evitar" invalido.`);
  });
}

async function main() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) fail('.env nao encontrado.');
  ok('.env encontrado');

  if (!process.env.GROQ_API_KEY) fail('GROQ_API_KEY nao configurada.');
  ok('GROQ_API_KEY configurada');

  const personasPath = path.join(__dirname, 'personas.json');
  if (!fs.existsSync(personasPath)) fail('personas.json nao encontrado.');
  ok('personas.json encontrado');

  const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
  validatePersonas(personas);
  ok(`${personas.length} persona(s) carregada(s)`);

  const googleAuth = resolveGoogleAuthConfig(process.env, __dirname);
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
