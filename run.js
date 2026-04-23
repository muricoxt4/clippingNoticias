import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

import { log } from './lib/utils.js';
import { createBrowser, scrapeArticles, fetchArticleText } from './lib/scraper.js';
import { summarize, preSelectByAllPersonas } from './lib/ai.js';
import { buildGoogleClients, createGoogleDoc } from './lib/google.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const MAX_PER_SITE    = 20; // artigos raspados por portal (título + link)
const MAX_PER_PERSONA = 15; // artigos extraídos e resumidos por persona

// ── Env validation ────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['GROQ_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const missing  = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`\n[ERRO] Variáveis obrigatórias não definidas: ${missing.join(', ')}`);
    console.error('       Copie .env.example para .env e preencha os valores.\n');
    process.exit(1);
  }

  const sites = (process.env.NEWS_SITES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!sites.length) {
    console.error('\n[ERRO] NEWS_SITES não configurado. Adicione URLs separadas por vírgula no .env.\n');
    process.exit(1);
  }

  const tokenPath = path.join(__dirname, 'google-token.json');
  if (!fs.existsSync(tokenPath)) {
    console.error('\n[ERRO] google-token.json não encontrado.');
    console.error('       Execute primeiro: node auth-google.js\n');
    process.exit(1);
  }

  const personasPath = path.join(__dirname, 'personas.json');
  if (!fs.existsSync(personasPath)) {
    console.error('\n[ERRO] personas.json não encontrado.');
    console.error('       Copie personas.example.json para personas.json e preencha os perfis.\n');
    process.exit(1);
  }

  return { sites, tokenPath, personasPath };
}

// ── Interactive prompt ────────────────────────────────────────────────────────

async function askDaysBack(envDefault) {
  if (!process.stdin.isTTY) return envDefault;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  Quantos dias retroativos buscar? [Enter = ${envDefault}]: `, (answer) => {
      rl.close();
      const parsed = parseInt(answer.trim(), 10);
      resolve(isNaN(parsed) || parsed < 1 ? envDefault : parsed);
    });
  });
}

// ── Display helpers ───────────────────────────────────────────────────────────

const SITE_COL = 28;

function siteLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function siteLine(host) {
  const dots = '.'.repeat(Math.max(3, SITE_COL - host.length));
  return `           → ${host} ${dots} `;
}

function noArticlesReason(meta, daysBack) {
  if (meta.raw_count === 0)
    return 'nenhum elemento compatível na página';
  if (meta.title_filtered === meta.raw_count)
    return 'possível bloqueio anti-bot (todos os títulos inválidos)';
  if (meta.date_filtered > 0)
    return `${meta.date_filtered} artigo(s) encontrado(s) — todos fora dos últimos ${daysBack} dia(s)`;
  return 'sem artigos válidos no período';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { sites, tokenPath, personasPath } = validateEnv();
const personas = JSON.parse(fs.readFileSync(personasPath, 'utf8'));
const groq     = new Groq({ apiKey: process.env.GROQ_API_KEY });

console.log('\n' + '='.repeat(54));
console.log('   CLIPPING DE NOTÍCIAS — Pipeline Automatizado');
console.log('='.repeat(54) + '\n');

const envDays   = parseInt(process.env.NEWS_DAYS_BACK ?? '3', 10);
const DAYS_BACK = await askDaysBack(envDays);
console.log();

// ── Step 1: Scraping (título + link apenas) ───────────────────────────────────

log(`[1/5] Raspando títulos em ${sites.length} portal(is) (últimos ${DAYS_BACK} dia(s))...`);

const browser  = await createBrowser();
const articles = []; // { site, title, link, dateStr }

for (const siteUrl of sites) {
  const host = siteLabel(siteUrl);
  process.stdout.write(siteLine(host));

  try {
    const { articles: found, meta } = await scrapeArticles(browser, siteUrl, DAYS_BACK);
    const limited = found.slice(0, MAX_PER_SITE);
    articles.push(...limited.map((a) => ({ site: siteUrl, ...a })));

    if (limited.length === 0) {
      console.log(`0 artigos  [${noArticlesReason(meta, DAYS_BACK)}]`);
    } else {
      const notes = [];
      if (found.length > MAX_PER_SITE)
        notes.push(`+${found.length - MAX_PER_SITE} excedentes descartados`);
      if (meta.date_filtered > 0)
        notes.push(`${meta.date_filtered} ignorados por data`);
      const suffix = notes.length ? `  (${notes.join(', ')})` : '';
      const undated = limited.filter((a) => !a.dateStr).length;
      const undatedNote = undated > 0 ? `  [${undated} sem data — avaliados por título]` : '';
      console.log(`${limited.length} artigo(s)${suffix}${undatedNote}`);
    }
  } catch (err) {
    const msg = /timeout/i.test(err.message)
      ? `timeout após ${err.message.includes('45') ? 45 : 30}s`
      : err.message.slice(0, 65);
    console.log(`ERRO: ${msg}`);
  }
}

console.log();
log(`       Total de títulos coletados: ${articles.length}`);
const undatedTotal = articles.filter((a) => !a.dateStr).length;
if (undatedTotal > 0)
  log(`       Sem data (avaliados por título): ${undatedTotal}`);
console.log();

if (!articles.length) {
  log('Nenhum artigo encontrado. Verifique os portais ou aumente os dias retroativos.');
  await browser.close();
  process.exit(0);
}

// ── Step 2: Pre-selection (1 chamada Groq, todas as personas) ─────────────────

log(`[2/5] Pré-selecionando artigos para ${personas.length} persona(s) (1 chamada IA)...`);

const selectionByPersona = await preSelectByAllPersonas(groq, articles, personas, MAX_PER_PERSONA);

// Collect the union of all selected indices (each article extracted only once)
const allSelectedIndices = [...new Set(Object.values(selectionByPersona).flat())]
  .sort((a, b) => a - b);

for (const persona of personas) {
  const count = selectionByPersona[persona.id].length;
  log(`           ${persona.nome}: ${count} artigo(s) pré-selecionado(s)`);
}
log(`           Total único para extração: ${allSelectedIndices.length} artigo(s)`);
console.log();

if (!allSelectedIndices.length) {
  log('Nenhum artigo relevante identificado para nenhuma persona.');
  await browser.close();
  process.exit(0);
}

// ── Step 3: Extract full text (only selected articles) ────────────────────────

log(`[3/5] Extraindo texto de ${allSelectedIndices.length} artigo(s) selecionado(s)...`);

for (const idx of allSelectedIndices) {
  const a     = articles[idx];
  const label = a.title.slice(0, 58);
  process.stdout.write(`           [${String(idx).padStart(3)}] ${label}... `);
  try {
    a.text = await fetchArticleText(browser, a.link);
    console.log('OK');
  } catch {
    a.text = '(não foi possível extrair)';
    console.log('FALHOU');
  }
}

await browser.close();
console.log();

// ── Step 4: Summarize (with cache — shared articles summarized only once) ──────

log(`[4/5] Resumindo com IA (Groq)...`);

const summaryCache = new Map(); // articleIndex → { chamada, resumo, link }

const porPersona = {};
for (const persona of personas) {
  const indices = selectionByPersona[persona.id];
  porPersona[persona.id] = {
    persona,
    artigos: indices.map((i) => articles[i]).filter(Boolean),
    indices,
  };
}

for (const { persona, artigos, indices } of Object.values(porPersona)) {
  for (let j = 0; j < artigos.length; j++) {
    const origIdx = indices[j];
    const a       = artigos[j];

    if (!summaryCache.has(origIdx)) {
      const s = await summarize(groq, a.title, a.text ?? '', a.link);
      summaryCache.set(origIdx, s);
    }

    const cached = summaryCache.get(origIdx);
    Object.assign(a, cached);
    log(`           [${persona.nome}] ${cached.chamada}`);
  }
}
console.log();

// ── Step 5: Create Google Docs ────────────────────────────────────────────────

log(`[5/5] Criando Google Docs por persona...`);
const { docs, drive } = buildGoogleClients(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  tokenPath,
);
const hoje = new Date().toLocaleDateString('pt-BR');

for (const { persona, artigos } of Object.values(porPersona)) {
  if (!artigos.length) {
    log(`           ${persona.nome}: sem artigos relevantes — doc não criado.`);
    continue;
  }
  const newsItems = artigos.map((a) => ({
    chamada: a.chamada ?? a.title,
    resumo : a.resumo  ?? '',
    link   : a.link,
  }));
  const docLink = await createGoogleDoc(
    docs,
    drive,
    `Clipping ${persona.nome} — ${hoje}`,
    newsItems,
    process.env.GOOGLE_DRIVE_FOLDER_ID || null,
  );
  log(`           OK  ${persona.nome}  (${artigos.length} artigo(s))`);
  console.log(`                   ${docLink}`);
}

console.log('\n' + '='.repeat(54));
log('Clipping concluído com sucesso!');
console.log('='.repeat(54) + '\n');
