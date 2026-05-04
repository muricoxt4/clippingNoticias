import fs from 'fs';
import path from 'path';

const DEFAULT_HISTORY_FILENAME = 'news-history.json';
const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_HISTORY_ITEMS_FOR_PROMPT = 12;
const TRACKING_QUERY_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gs_l',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ref',
]);

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPathInsideProject(projectRoot, targetPath) {
  const relativePath = path.relative(projectRoot, targetPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function createEmptyHistory() {
  return {
    version: 1,
    personas: {},
  };
}

function normalizeWhitespace(value) {
  return value
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';
}

function normalizeTitle(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArticleLink(link) {
  const trimmed = link?.trim() ?? '';
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    for (const key of [...parsed.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith('utm_') || TRACKING_QUERY_PARAMS.has(normalizedKey)) {
        parsed.searchParams.delete(key);
      }
    }

    parsed.searchParams.sort();
    const queryString = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname}${queryString ? `?${queryString}` : ''}`;
  } catch {
    return trimmed;
  }
}

function getArticleIdentity(article) {
  const normalizedLink = normalizeArticleLink(article.link);
  const titleKey = normalizeTitle(article.chamada ?? article.title ?? '');

  let host = '';
  try {
    host = new URL(normalizedLink || article.link).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }

  return {
    normalizedLink,
    titleKey,
    sourceTitleKey: titleKey ? `${host || 'unknown'}::${titleKey}` : '',
  };
}

function keepRecentEntries(entries, lookbackDays) {
  const cutoffMs = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
  return entries.filter((entry) => {
    const sentAtMs = Date.parse(entry?.sentAt ?? '');
    if (Number.isNaN(sentAtMs)) return true;
    return sentAtMs >= cutoffMs;
  });
}

export function resolveNewsHistoryConfig(env, projectRoot) {
  const configuredPath = env.NEWS_HISTORY_PATH?.trim();
  const historyPath = configuredPath
    ? (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(projectRoot, configuredPath))
    : path.join(projectRoot, DEFAULT_HISTORY_FILENAME);

  if (!isPathInsideProject(projectRoot, historyPath)) {
    throw new Error(
      `[ERRO] NEWS_HISTORY_PATH deve apontar para um arquivo dentro do projeto.\n` +
      `       Projeto: ${projectRoot}\n` +
      `       Caminho resolvido: ${historyPath}`,
    );
  }

  return {
    historyPath,
    lookbackDays: readPositiveInt(env.NEWS_REPEAT_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS),
  };
}

export function loadNewsHistory(config) {
  if (!fs.existsSync(config.historyPath)) {
    return createEmptyHistory();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(config.historyPath, 'utf8'));
  } catch {
    throw new Error(
      `[ERRO] Nao foi possivel ler o historico de noticias em "${config.historyPath}".\n` +
      '       Corrija ou apague o arquivo para que ele seja recriado automaticamente.',
    );
  }

  const history = {
    version: 1,
    personas: parsed?.personas && typeof parsed.personas === 'object' ? parsed.personas : {},
  };

  for (const [personaId, entries] of Object.entries(history.personas)) {
    history.personas[personaId] = keepRecentEntries(Array.isArray(entries) ? entries : [], config.lookbackDays);
  }

  return history;
}

export function saveNewsHistory(config, history) {
  fs.mkdirSync(path.dirname(config.historyPath), { recursive: true });
  fs.writeFileSync(config.historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

export function dedupeArticles(articles) {
  const seenKeys = new Set();
  const uniqueArticles = [];
  const removedArticles = [];

  for (const article of articles) {
    const { normalizedLink, sourceTitleKey } = getArticleIdentity(article);
    const keys = [normalizedLink, sourceTitleKey].filter(Boolean);
    const isDuplicate = keys.some((key) => seenKeys.has(key));

    if (isDuplicate) {
      removedArticles.push(article);
      continue;
    }

    keys.forEach((key) => seenKeys.add(key));
    uniqueArticles.push(article);
  }

  return { uniqueArticles, removedArticles };
}

function getPersonaEntries(history, personaId) {
  return Array.isArray(history.personas?.[personaId]) ? history.personas[personaId] : [];
}

export function buildHistoryPromptContext(history, personaId, maxItems = MAX_HISTORY_ITEMS_FOR_PROMPT) {
  return getPersonaEntries(history, personaId)
    .slice()
    .sort((left, right) => Date.parse(right.sentAt ?? '') - Date.parse(left.sentAt ?? ''))
    .slice(0, maxItems)
    .map((entry) => entry.title)
    .filter(Boolean);
}

export function filterSelectionAgainstHistory(indices, articles, history, personaId, maxPerPersona) {
  const personaEntries = getPersonaEntries(history, personaId);
  const seenLinks = new Set(personaEntries.map((entry) => entry.normalizedLink).filter(Boolean));
  const seenSourceTitles = new Set(personaEntries.map((entry) => entry.sourceTitleKey).filter(Boolean));
  const selectedKeys = new Set();
  const keptIndices = [];
  let removedCount = 0;

  for (const index of indices) {
    const article = articles[index];
    if (!article) continue;

    const { normalizedLink, sourceTitleKey } = getArticleIdentity(article);
    const matchesHistory = (
      (normalizedLink && seenLinks.has(normalizedLink))
      || (sourceTitleKey && seenSourceTitles.has(sourceTitleKey))
    );

    if (matchesHistory) {
      removedCount += 1;
      continue;
    }

    const keys = [normalizedLink, sourceTitleKey].filter(Boolean);
    const isDuplicateInSelection = keys.some((key) => selectedKeys.has(key));
    if (isDuplicateInSelection) {
      removedCount += 1;
      continue;
    }

    keys.forEach((key) => selectedKeys.add(key));
    keptIndices.push(index);

    if (keptIndices.length >= maxPerPersona) {
      break;
    }
  }

  return { keptIndices, removedCount };
}

export function recordSentArticles(history, persona, articles, metadata = {}) {
  const personaEntries = getPersonaEntries(history, persona.id);
  const sentAt = metadata.sentAt ?? new Date().toISOString();

  for (const article of articles) {
    const { normalizedLink, sourceTitleKey } = getArticleIdentity(article);
    if (!normalizedLink && !sourceTitleKey) continue;

    const nextEntry = {
      title: article.chamada ?? article.title ?? '',
      link: article.link ?? '',
      normalizedLink,
      sourceTitleKey,
      source: article.site ?? null,
      sentAt,
      docTitle: metadata.docTitle ?? null,
      docLink: metadata.docLink ?? null,
    };

    const existingIndex = personaEntries.findIndex((entry) => (
      (normalizedLink && entry.normalizedLink === normalizedLink)
      || (sourceTitleKey && entry.sourceTitleKey === sourceTitleKey)
    ));

    if (existingIndex >= 0) {
      personaEntries[existingIndex] = nextEntry;
    } else {
      personaEntries.push(nextEntry);
    }
  }

  history.personas[persona.id] = keepRecentEntries(personaEntries, metadata.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
  return history;
}
