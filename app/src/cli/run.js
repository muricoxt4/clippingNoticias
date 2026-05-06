import readline from 'readline';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import Groq from 'groq-sdk';

import { log } from '../lib/utils.js';
import {
  buildHistoryPromptContext,
  dedupeArticles,
  filterSelectionAgainstHistory,
  loadNewsHistory,
  recordSentArticles,
  resolveNewsHistoryConfig,
  saveNewsHistory,
} from '../lib/history.js';
import { createBrowser, scrapeArticles, fetchArticleText } from '../lib/scraper.js';
import { summarize, preSelectByAllPersonas } from '../lib/ai.js';
import {
  resolveGoogleAuthConfig,
  buildGoogleClients,
  createGoogleDoc,
  findRecentClippingDocsForPersona,
  formatClippingDocTitle,
  readGoogleDocText,
  resolveDocSharingConfig,
  validateGoogleAccess,
} from '../lib/google.js';
import { validatePersonas } from '../lib/personas.js';
import { printPipelineFailure, printPipelineWarnings } from '../lib/errors.js';
import {
  APP_ROOT,
  ENV_EXAMPLE_PATH,
  ENV_PATH,
  PERSONAS_EXAMPLE_PATH,
  PERSONAS_PATH,
  toRepoRelative,
} from '../lib/paths.js';

dotenv.config({ path: ENV_PATH });

function readPositiveInt(envKey, fallback) {
  const parsed = parseInt(process.env[envKey] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_PER_SITE = readPositiveInt('MAX_ARTICLES_PER_SITE', 20);
const MAX_PER_PERSONA = readPositiveInt('MAX_ARTICLES_PER_PERSONA', 15);
const PRESELECT_MULTIPLIER = 2;

function validateEnv() {
  const required = ['GROQ_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `[ERRO] Variaveis obrigatorias nao definidas: ${missing.join(', ')}\n` +
      `       Copie ${toRepoRelative(ENV_EXAMPLE_PATH)} para ${toRepoRelative(ENV_PATH)} e preencha os valores.`,
    );
  }

  const sites = (process.env.NEWS_SITES ?? '')
    .split(',')
    .map((site) => site.trim())
    .filter(Boolean);

  if (!sites.length) {
    throw new Error(
      '[ERRO] NEWS_SITES nao configurado.\n' +
      `       Adicione URLs separadas por virgula em ${toRepoRelative(ENV_PATH)}.`,
    );
  }

  const googleAuth = resolveGoogleAuthConfig(process.env, APP_ROOT);

  if (!fs.existsSync(PERSONAS_PATH)) {
    throw new Error(
      '[ERRO] personas.json nao encontrado.\n' +
      `       Copie ${toRepoRelative(PERSONAS_EXAMPLE_PATH)} para ${toRepoRelative(PERSONAS_PATH)} e preencha os perfis.`,
    );
  }

  const historyConfig = resolveNewsHistoryConfig(process.env, APP_ROOT);

  return { sites, googleAuth, personasPath: PERSONAS_PATH, historyConfig };
}

async function askDaysBack(defaultValue) {
  if (!process.stdin.isTTY) return defaultValue;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  Quantos dias retroativos buscar? [Enter = ${defaultValue}]: `, (answer) => {
      rl.close();
      const parsed = parseInt(answer.trim(), 10);
      resolve(Number.isNaN(parsed) || parsed < 1 ? defaultValue : parsed);
    });
  });
}

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function siteLine(host) {
  const labelColumn = 28;
  const dots = '.'.repeat(Math.max(3, labelColumn - host.length));
  return `           -> ${host} ${dots} `;
}

function noArticlesReason(meta, daysBack) {
  if (meta.raw_count === 0) return 'nenhum elemento compativel na pagina';
  if (meta.title_filtered === meta.raw_count) return 'possivel bloqueio anti-bot (todos os titulos invalidos)';
  if (meta.date_filtered > 0) {
    return `${meta.date_filtered} artigo(s) encontrado(s) - todos fora dos ultimos ${daysBack} dia(s)`;
  }
  return 'sem artigos validos no periodo';
}

function parseNewsItemsFromDocText(documentText) {
  const lines = documentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const newsItems = [];
  let currentItem = null;

  for (const line of lines) {
    if (/^CLIPPING DE NOTICIAS\b/i.test(line)) {
      continue;
    }

    const titleMatch = line.match(/^\d+\.\s+(.+)$/);
    if (titleMatch) {
      currentItem = {
        title: titleMatch[1].trim(),
        chamada: titleMatch[1].trim(),
        resumoLines: [],
      };
      continue;
    }

    const linkMatch = line.match(/^Link:\s+(https?:\/\/\S+)$/i);
    if (linkMatch && currentItem) {
      newsItems.push({
        title: currentItem.title,
        chamada: currentItem.chamada,
        resumo: currentItem.resumoLines.join(' ').trim(),
        link: linkMatch[1],
      });
      currentItem = null;
      continue;
    }

    if (currentItem) {
      currentItem.resumoLines.push(line);
    }
  }

  return newsItems;
}

function createRunState() {
  return {
    currentStep: 'Inicializacao',
    currentPersona: null,
    currentArticleTitle: null,
    titlesCollected: 0,
    selectedUniqueCount: 0,
    summariesCompleted: 0,
    docsCreated: [],
    scrapeWarnings: [],
    extractionWarnings: [],
  };
}

async function closeBrowserSafely(browser) {
  if (!browser) return;

  try {
    await browser.close();
  } catch {
    // nothing to do
  }
}

async function hydrateHistoryFromPreviousDocs(history, historyConfig, personas, docs, drive, folderId) {
  let importedPersonas = 0;
  let importedDocs = 0;
  let importedArticles = 0;

  for (const persona of personas) {
    if (Array.isArray(history.personas?.[persona.id]) && history.personas[persona.id].length) {
      continue;
    }

    try {
      const recentDocs = await findRecentClippingDocsForPersona(
        drive,
        persona.nome,
        folderId,
        historyConfig.lookbackDays,
      );
      if (!recentDocs.length) continue;

      let importedAnythingForPersona = false;

      for (const doc of recentDocs) {
        const documentText = await readGoogleDocText(docs, doc.id);
        const importedItems = parseNewsItemsFromDocText(documentText);
        if (!importedItems.length) continue;

        recordSentArticles(history, persona, importedItems, {
          docTitle: doc.name ?? null,
          docLink: doc.webViewLink ?? `https://docs.google.com/document/d/${doc.id}/edit`,
          sentAt: doc.modifiedTime ?? new Date().toISOString(),
          lookbackDays: historyConfig.lookbackDays,
        });
        importedAnythingForPersona = true;
        importedDocs += 1;
        importedArticles += importedItems.length;
      }

      if (importedAnythingForPersona) {
        importedPersonas += 1;
      }
    } catch (error) {
      log(`Historico previo nao carregado para ${persona.nome}: ${error.message.slice(0, 90)}`);
    }
  }

  if (importedArticles > 0) {
    saveNewsHistory(historyConfig, history);
  }

  return { importedPersonas, importedDocs, importedArticles };
}

async function main() {
  const state = createRunState();
  let browser;

  try {
    const { sites, googleAuth, personasPath, historyConfig } = validateEnv();
    const personas = validatePersonas(JSON.parse(fs.readFileSync(personasPath, 'utf8')));
    const history = loadNewsHistory(historyConfig);
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const googleFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null;
    const docSharingConfig = resolveDocSharingConfig(process.env);
    const googleClients = buildGoogleClients(googleAuth);
    await validateGoogleAccess(googleAuth, googleClients, googleFolderId);
    const { docs, drive } = googleClients;
    const importedHistory = await hydrateHistoryFromPreviousDocs(
      history,
      historyConfig,
      personas,
      docs,
      drive,
      googleFolderId,
    );

    console.log('\n' + '='.repeat(54));
    console.log('   CLIPPING DE NOTICIAS - Pipeline Automatizado');
    console.log('='.repeat(54) + '\n');

    const envDays = readPositiveInt('NEWS_DAYS_BACK', 3);
    const daysBack = await askDaysBack(envDays);
    console.log();
    log(`Historico anti-repeticao: ${path.basename(historyConfig.historyPath)} (${historyConfig.lookbackDays} dia(s))`);
    log(`Compartilhamento Google Docs: ${docSharingConfig.mode}`);
    if (importedHistory.importedArticles > 0) {
      log(
        `Historico inicial carregado de ${importedHistory.importedDocs} doc(s) anterior(es) ` +
        `para ${importedHistory.importedPersonas} persona(s): ` +
        `${importedHistory.importedArticles} artigo(s)`,
      );
    }

    state.currentStep = '1/5 - Raspando titulos';
    log(`[1/5] Raspando titulos em ${sites.length} portal(is) (ultimos ${daysBack} dia(s))...`);

    browser = await createBrowser();
    let articles = [];

    for (const siteUrl of sites) {
      const host = siteLabel(siteUrl);
      process.stdout.write(siteLine(host));

      try {
        const { articles: found, meta } = await scrapeArticles(browser, siteUrl, daysBack);
        const limited = found.slice(0, MAX_PER_SITE);
        articles.push(...limited.map((article) => ({ site: siteUrl, ...article })));

        if (!limited.length) {
          console.log(`0 artigos  [${noArticlesReason(meta, daysBack)}]`);
          continue;
        }

        const notes = [];
        if (found.length > MAX_PER_SITE) notes.push(`+${found.length - MAX_PER_SITE} excedentes descartados`);
        if (meta.date_filtered > 0) notes.push(`${meta.date_filtered} ignorados por data`);
        const suffix = notes.length ? `  (${notes.join(', ')})` : '';
        const undated = limited.filter((article) => !article.dateStr).length;
        const undatedNote = undated > 0 ? `  [${undated} sem data - avaliados por titulo]` : '';
        console.log(`${limited.length} artigo(s)${suffix}${undatedNote}`);
      } catch (error) {
        const message = /timeout/i.test(error.message)
          ? `timeout apos ${error.message.includes('45') ? 45 : 30}s`
          : error.message.slice(0, 90);
        state.scrapeWarnings.push(`${host}: ${message}`);
        console.log(`ERRO: ${message}`);
      }
    }

    console.log();
    const rawCollectedCount = articles.length;
    const { uniqueArticles, removedArticles } = dedupeArticles(articles);
    articles = uniqueArticles;
    state.titlesCollected = articles.length;

    log(`       Total de titulos coletados: ${rawCollectedCount}`);
    if (removedArticles.length > 0) {
      log(`       Duplicados removidos antes da IA: ${removedArticles.length}`);
    }
    log(`       Titulos unicos apos limpeza: ${articles.length}`);

    const undatedTotal = articles.filter((article) => !article.dateStr).length;
    if (undatedTotal > 0) {
      log(`       Sem data (avaliados por titulo): ${undatedTotal}`);
    }
    console.log();

    if (!articles.length) {
      log('Nenhum artigo encontrado. Verifique os portais ou aumente os dias retroativos.');
      printPipelineWarnings(state);
      return 0;
    }

    state.currentStep = '2/5 - Pre-selecao com IA';
    log(`[2/5] Pre-selecionando artigos para ${personas.length} persona(s) (1 chamada IA)...`);

    const preselectionLimit = Math.min(
      articles.length,
      Math.max(MAX_PER_PERSONA, MAX_PER_PERSONA * PRESELECT_MULTIPLIER),
    );
    const historyByPersona = Object.fromEntries(
      personas.map((persona) => [persona.id, buildHistoryPromptContext(history, persona.id)]),
    );
    const rawSelectionByPersona = await preSelectByAllPersonas(groq, articles, personas, {
      maxPerPersona: preselectionLimit,
      historyByPersona,
    });
    const selectionByPersona = {};

    for (const persona of personas) {
      const { keptIndices, removedCount } = filterSelectionAgainstHistory(
        rawSelectionByPersona[persona.id] ?? [],
        articles,
        history,
        persona.id,
        MAX_PER_PERSONA,
      );
      selectionByPersona[persona.id] = keptIndices;

      const duplicateNote = removedCount > 0
        ? ` (${removedCount} repetido(s) removido(s) pelo historico)`
        : '';
      log(`           ${persona.nome}: ${keptIndices.length} artigo(s) pre-selecionado(s)${duplicateNote}`);
    }

    const allSelectedIndices = [...new Set(Object.values(selectionByPersona).flat())]
      .sort((left, right) => left - right);

    state.selectedUniqueCount = allSelectedIndices.length;
    log(`           Total unico para extracao: ${allSelectedIndices.length} artigo(s)`);
    console.log();

    if (!allSelectedIndices.length) {
      log('Nenhum artigo novo e relevante identificado para nenhuma persona.');
      printPipelineWarnings(state);
      return 0;
    }

    state.currentStep = '3/5 - Extracao de texto';
    log(`[3/5] Extraindo texto de ${allSelectedIndices.length} artigo(s) selecionado(s)...`);

    for (const index of allSelectedIndices) {
      const article = articles[index];
      state.currentArticleTitle = article.title;
      const label = article.title.slice(0, 58);
      process.stdout.write(`           [${String(index).padStart(3)}] ${label}... `);

      try {
        article.text = await fetchArticleText(browser, article.link);
        console.log('OK');
      } catch {
        article.text = '(nao foi possivel extrair)';
        state.extractionWarnings.push(article.title);
        console.log('FALHOU');
      }
    }

    await closeBrowserSafely(browser);
    browser = null;
    state.currentArticleTitle = null;
    console.log();

    state.currentStep = '4/5 - Resumindo com IA';
    log('[4/5] Resumindo com IA (Groq)...');

    const summaryCache = new Map();
    const porPersona = {};

    for (const persona of personas) {
      const indices = selectionByPersona[persona.id];
      porPersona[persona.id] = {
        persona,
        artigos: indices.map((index) => articles[index]).filter(Boolean),
        indices,
      };
    }

    for (const { persona, artigos, indices } of Object.values(porPersona)) {
      state.currentPersona = persona.nome;

      for (let current = 0; current < artigos.length; current += 1) {
        const originalIndex = indices[current];
        const article = artigos[current];
        state.currentArticleTitle = article.title;

        if (!summaryCache.has(originalIndex)) {
          const summary = await summarize(groq, article.title, article.text ?? '', article.link);
          summaryCache.set(originalIndex, summary);
          state.summariesCompleted = summaryCache.size;
        }

        const cached = summaryCache.get(originalIndex);
        Object.assign(article, cached);
        log(`           [${persona.nome}] ${cached.chamada}`);
      }
    }
    console.log();

    state.currentStep = '5/5 - Criando Google Docs';
    log('[5/5] Criando Google Docs por persona...');
    const runDate = new Date();

    for (const { persona, artigos } of Object.values(porPersona)) {
      state.currentPersona = persona.nome;

      if (!artigos.length) {
        log(`           ${persona.nome}: sem artigos relevantes - doc nao criado.`);
        continue;
      }

      const newsItems = artigos.map((article) => ({
        chamada: article.chamada ?? article.title,
        resumo: article.resumo ?? '',
        link: article.link,
      }));
      const docTitle = formatClippingDocTitle(persona.nome, runDate);

      const docLink = await createGoogleDoc(
        docs,
        drive,
        docTitle,
        newsItems,
        googleFolderId,
        googleAuth,
        docSharingConfig,
      );
      recordSentArticles(history, persona, artigos, {
        docTitle,
        docLink,
        lookbackDays: historyConfig.lookbackDays,
      });
      saveNewsHistory(historyConfig, history);

      state.docsCreated.push({ persona: persona.nome, link: docLink });
      log(`           OK  ${persona.nome}  (${artigos.length} artigo(s))`);
      console.log(`                   ${docLink}`);
    }

    printPipelineWarnings(state);

    console.log('\n' + '='.repeat(54));
    log('Clipping concluido com sucesso!');
    console.log('='.repeat(54) + '\n');
    return 0;
  } catch (error) {
    await closeBrowserSafely(browser);
    printPipelineFailure(error, state);
    return 1;
  }
}

process.exitCode = await main();
