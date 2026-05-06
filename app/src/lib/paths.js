import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = path.resolve(CURRENT_DIR, '..', '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');
export const CONFIG_DIR = path.join(APP_ROOT, 'config');
export const CREDENTIALS_DIR = path.join(APP_ROOT, 'credentials');
export const DATA_DIR = path.join(APP_ROOT, 'data');

export const LEGACY_ENV_PATH = path.join(REPO_ROOT, '.env');
export const ENV_EXAMPLE_PATH = path.join(CONFIG_DIR, '.env.example');
export const LEGACY_PERSONAS_PATH = path.join(REPO_ROOT, 'personas.json');
export const PERSONAS_EXAMPLE_PATH = path.join(CONFIG_DIR, 'personas.example.json');
export const LEGACY_GOOGLE_TOKEN_PATH = path.join(REPO_ROOT, 'google-token.json');
export const LEGACY_HISTORY_PATH = path.join(REPO_ROOT, 'news-history.json');

function pickExistingPath(primaryPath, fallbackPaths = []) {
  return [primaryPath, ...fallbackPaths].find((candidatePath) => fs.existsSync(candidatePath)) ?? primaryPath;
}

function uniquePaths(candidatePaths) {
  return [...new Set(
    candidatePaths
      .filter(Boolean)
      .map((candidatePath) => path.normalize(candidatePath)),
  )];
}

export const ENV_PATH = pickExistingPath(path.join(CONFIG_DIR, '.env'), [LEGACY_ENV_PATH]);
export const PERSONAS_PATH = pickExistingPath(path.join(CONFIG_DIR, 'personas.json'), [LEGACY_PERSONAS_PATH]);
export const GOOGLE_TOKEN_PATH = pickExistingPath(
  path.join(CREDENTIALS_DIR, 'google-token.json'),
  [LEGACY_GOOGLE_TOKEN_PATH],
);
export const DEFAULT_HISTORY_PATH = pickExistingPath(
  path.join(DATA_DIR, 'news-history.json'),
  [LEGACY_HISTORY_PATH],
);

export function resolveCompatibleProjectPath(configuredPath, options = {}) {
  const trimmedPath = configuredPath?.trim();
  if (!trimmedPath) {
    return { path: '', candidates: [] };
  }

  if (path.isAbsolute(trimmedPath)) {
    return { path: trimmedPath, candidates: [trimmedPath] };
  }

  const preferredBase = options.preferredBase ?? APP_ROOT;
  const fallbackBases = options.fallbackBases ?? [];
  const fallbackPaths = options.fallbackPaths ?? [];
  const candidates = uniquePaths([
    path.resolve(preferredBase, trimmedPath),
    ...fallbackBases.map((basePath) => path.resolve(basePath, trimmedPath)),
    ...fallbackPaths,
  ]);
  const existingPath = candidates.find((candidatePath) => fs.existsSync(candidatePath));

  return {
    path: existingPath ?? candidates[0] ?? path.resolve(preferredBase, trimmedPath),
    candidates,
  };
}

export function formatCandidatePaths(candidatePaths) {
  return candidatePaths.map((candidatePath) => `"${candidatePath}"`).join(', ');
}

export function toRepoRelative(targetPath) {
  return path.relative(REPO_ROOT, targetPath).split(path.sep).join('/');
}
