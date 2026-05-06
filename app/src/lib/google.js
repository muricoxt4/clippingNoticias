import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import {
  CREDENTIALS_DIR,
  ENV_PATH,
  GOOGLE_TOKEN_PATH,
  REPO_ROOT,
  resolveCompatibleProjectPath,
  formatCandidatePaths,
} from './paths.js';

const GOOGLE_REDIRECT_URI = 'http://localhost:4000/callback';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
];
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_DOC_SHARE_MODES = new Set(['restricted', 'anyone_reader']);

function normalizeSearchText(value) {
  return value
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim() ?? '';
}

export function formatClippingDocDate(date = new Date()) {
  const safeDate = date instanceof Date ? date : new Date(date);
  const day = String(safeDate.getDate()).padStart(2, '0');
  const month = String(safeDate.getMonth() + 1).padStart(2, '0');
  const year = String(safeDate.getFullYear()).padStart(4, '0');
  return `${day}-${month}-${year}`;
}

export function formatClippingDocTitle(personaName, date = new Date()) {
  return `${formatClippingDocDate(date)} | ${personaName.trim()}`;
}

export function isClippingDocTitleForPersona(fileName, personaName) {
  const normalizedFileName = normalizeSearchText(fileName);
  const normalizedPersonaName = normalizeSearchText(personaName);

  if (!normalizedFileName || !normalizedPersonaName) {
    return false;
  }

  const currentFormatMatch = normalizedFileName.match(/^(\d{2}-\d{2}-\d{4}) \| (.+)$/);
  if (currentFormatMatch?.[2] === normalizedPersonaName) {
    return true;
  }

  const legacyPrefix = normalizeSearchText(`Clipping ${personaName} -`);
  return normalizedFileName.startsWith(legacyPrefix);
}

function isWithinLookback(modifiedTime, lookbackDays, referenceDate = new Date()) {
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    return true;
  }

  const modifiedAtMs = Date.parse(modifiedTime ?? '');
  if (Number.isNaN(modifiedAtMs)) {
    return true;
  }

  const cutoffMs = referenceDate.getTime() - (lookbackDays * 24 * 60 * 60 * 1000);
  return modifiedAtMs >= cutoffMs;
}

export function filterClippingDocsForPersona(files, personaName, lookbackDays = null, referenceDate = new Date()) {
  return (files ?? [])
    .filter((file) => isClippingDocTitleForPersona(file.name ?? '', personaName))
    .filter((file) => (
      lookbackDays == null || isWithinLookback(file.modifiedTime, lookbackDays, referenceDate)
    ))
    .sort((left, right) => Date.parse(right.modifiedTime ?? '') - Date.parse(left.modifiedTime ?? ''));
}

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function resolveDocSharingConfig(env) {
  const rawMode = env.GOOGLE_DOC_SHARE_MODE?.trim().toLowerCase() || 'restricted';
  if (!GOOGLE_DOC_SHARE_MODES.has(rawMode)) {
    throw new Error(
      '[ERRO] GOOGLE_DOC_SHARE_MODE invalido.\n' +
      '       Valores aceitos: restricted, anyone_reader.',
    );
  }

  return { mode: rawMode };
}

function resolveConfigPath(projectRoot, configuredPath, fallbackPaths = []) {
  return resolveCompatibleProjectPath(configuredPath, {
    preferredBase: projectRoot,
    fallbackBases: [path.dirname(ENV_PATH), REPO_ROOT],
    fallbackPaths,
  });
}

function readGoogleTokens(tokenPath, searchedPaths = [tokenPath]) {
  if (!fs.existsSync(tokenPath)) {
    const checkedPaths = formatCandidatePaths(searchedPaths);
    throw new Error(
      `google-token.json nao encontrado em "${tokenPath}". ` +
      `Caminhos verificados: ${checkedPaths}. Execute: npm run auth-google`,
    );
  }

  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  } catch {
    throw new Error(`Nao foi possivel ler "${tokenPath}". Gere novamente com: npm run auth-google`);
  }
}

function readServiceAccountCredentials(serviceAccountPath, searchedPaths = [serviceAccountPath]) {
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Arquivo da service account nao encontrado em "${serviceAccountPath}". ` +
      `Caminhos verificados: ${formatCandidatePaths(searchedPaths)}. ` +
      'Baixe a chave JSON e ajuste GOOGLE_SERVICE_ACCOUNT_PATH.',
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  } catch {
    throw new Error(
      `Nao foi possivel ler "${serviceAccountPath}". ` +
      'Verifique se o arquivo contem um JSON valido da service account.',
    );
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      `O arquivo "${serviceAccountPath}" nao parece ser uma chave valida de service account ` +
      '(campos client_email/private_key ausentes).',
    );
  }

  return credentials;
}

function getTokenSavedAtMs(tokenPath, tokens) {
  if (typeof tokens.token_created_at === 'number' && Number.isFinite(tokens.token_created_at)) {
    return tokens.token_created_at;
  }

  return fs.statSync(tokenPath).mtimeMs;
}

function getRefreshTokenExpiry(tokenPath, tokens) {
  const seconds = Number(tokens.refresh_token_expires_in);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const savedAtMs = getTokenSavedAtMs(tokenPath, tokens);
  return {
    savedAtMs,
    expiresAtMs: savedAtMs + (seconds * 1000),
  };
}

function formatDateTime(timestampMs) {
  return new Date(timestampMs).toLocaleString('pt-BR');
}

function buildReauthMessage(tokenPath, tokens, reason) {
  const lines = [
    '[ERRO] A autenticacao do Google nao esta valida.',
    `       Motivo: ${reason}`,
    '       Execute novamente: npm run auth-google',
  ];

  const expiry = getRefreshTokenExpiry(tokenPath, tokens);
  if (expiry) {
    lines.push(`       Token salvo em: ${formatDateTime(expiry.savedAtMs)}`);
    lines.push(`       Expira em: ${formatDateTime(expiry.expiresAtMs)}`);
    lines.push('       Observacao: apps OAuth em modo "Testing" podem emitir refresh tokens com validade de 7 dias.');
    lines.push('       Para evitar isso, altere o Publishing status para "In production" no Google Cloud.');
  }

  return lines.join('\n');
}

function buildReauthError(tokenPath, tokens, reason, cause = null) {
  const error = new Error(buildReauthMessage(tokenPath, tokens, reason));
  if (cause) error.cause = cause;
  return error;
}

function buildServiceAccountError(authConfig, reason, extraLines = [], cause = null) {
  const lines = [
    '[ERRO] A configuracao da service account nao esta pronta.',
    `       Motivo: ${reason}`,
    `       Arquivo: ${authConfig.serviceAccountPath}`,
    `       Conta: ${authConfig.serviceAccountEmail}`,
  ];

  if (authConfig.impersonatedUser) {
    lines.push(`       Impersonando: ${authConfig.impersonatedUser}`);
  } else {
    lines.push('       Sem GOOGLE_IMPERSONATE_USER: use uma pasta em Shared Drive para criar os Docs.');
  }

  lines.push(...extraLines);

  const error = new Error(lines.join('\n'));
  if (cause) error.cause = cause;
  return error;
}

function normalizeGoogleAuthError(error, authConfig, tokens = null) {
  const grantError = error?.response?.data?.error === 'invalid_grant'
    || error?.response?.data?.error_description === 'Token has been expired or revoked.'
    || error?.message?.includes('invalid_grant');

  if (!grantError) return error;

  const safeTokens = tokens ?? readGoogleTokens(authConfig.tokenPath);
  return buildReauthError(
    authConfig.tokenPath,
    safeTokens,
    'o refresh token salvo expirou ou foi revogado.',
    error,
  );
}

function normalizeServiceAccountError(error, authConfig, folderId = null) {
  const status = error?.response?.status ?? error?.code;
  const message = error?.response?.data?.error?.message ?? error?.message ?? 'erro desconhecido';
  const accessError = status === 403
    || status === 404
    || /permission|forbidden|insufficient|not found|access denied/i.test(message);

  if (!accessError) return error;

  const extraLines = [];
  if (folderId) {
    extraLines.push(`       Pasta alvo: ${folderId}`);
    extraLines.push('       Compartilhe essa pasta com a service account ou use uma pasta em Shared Drive com permissao de escrita.');
  } else {
    extraLines.push('       Defina GOOGLE_DRIVE_FOLDER_ID apontando para uma pasta em Shared Drive.');
  }
  extraLines.push(`       Resposta do Google: ${message}`);

  return buildServiceAccountError(
    authConfig,
    'a service account nao conseguiu acessar ou criar o Google Doc.',
    extraLines,
    error,
  );
}

export function resolveGoogleAuthConfig(env, projectRoot) {
  const serviceAccountSetting = env.GOOGLE_SERVICE_ACCOUNT_PATH?.trim();
  if (serviceAccountSetting) {
    const serviceAccountFileName = path.basename(serviceAccountSetting);
    const resolvedServiceAccount = resolveConfigPath(projectRoot, serviceAccountSetting, [
      path.join(CREDENTIALS_DIR, serviceAccountFileName),
      path.join(REPO_ROOT, 'credentials', serviceAccountFileName),
    ]);
    const serviceAccountPath = resolvedServiceAccount.path;
    const credentials = readServiceAccountCredentials(
      serviceAccountPath,
      resolvedServiceAccount.candidates,
    );

    return {
      mode: 'service_account',
      serviceAccountPath,
      serviceAccountEmail: credentials.client_email,
      privateKey: credentials.private_key,
      impersonatedUser: env.GOOGLE_IMPERSONATE_USER?.trim() || null,
    };
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const missing = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(
      `Variaveis Google obrigatorias nao definidas: ${missing.join(', ')}. ` +
      'Configure GOOGLE_SERVICE_ACCOUNT_PATH ou preencha as credenciais OAuth.',
    );
  }

  return {
    mode: 'oauth',
    clientId,
    clientSecret,
    tokenPath: GOOGLE_TOKEN_PATH,
  };
}

export function buildGoogleClients(authConfig) {
  if (authConfig.mode === 'service_account') {
    const auth = new google.auth.JWT(
      authConfig.serviceAccountEmail,
      null,
      authConfig.privateKey,
      GOOGLE_SCOPES,
      authConfig.impersonatedUser || undefined,
    );

    return {
      auth,
      docs : google.docs({ version: 'v1', auth }),
      drive: google.drive({ version: 'v3', auth }),
    };
  }

  const tokens = readGoogleTokens(authConfig.tokenPath);
  if (!tokens.refresh_token) {
    throw new Error(`"${path.basename(authConfig.tokenPath)}" nao contem refresh_token. Execute: npm run auth-google`);
  }

  const refreshTokenExpiry = getRefreshTokenExpiry(authConfig.tokenPath, tokens);
  if (refreshTokenExpiry && Date.now() >= refreshTokenExpiry.expiresAtMs) {
    throw buildReauthError(authConfig.tokenPath, tokens, 'o refresh token salvo ja expirou.');
  }

  const auth = new google.auth.OAuth2(
    authConfig.clientId,
    authConfig.clientSecret,
    GOOGLE_REDIRECT_URI,
  );
  auth.setCredentials(tokens);

  return {
    auth,
    docs : google.docs({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

export async function validateGoogleAccess(authConfig, clients, folderId = null) {
  const { auth, drive } = clients;

  if (authConfig.mode === 'service_account') {
    try {
      await auth.authorize();
    } catch (error) {
      throw buildServiceAccountError(
        authConfig,
        'nao foi possivel autenticar com a chave JSON informada.',
        ['       Verifique se a chave ainda esta ativa e se a Docs API e Drive API estao habilitadas.'],
        error,
      );
    }

    if (!folderId && !authConfig.impersonatedUser) {
      throw buildServiceAccountError(
        authConfig,
        'service accounts sem impersonacao nao devem criar arquivos fora de uma pasta de Shared Drive.',
        ['       Defina GOOGLE_DRIVE_FOLDER_ID com uma pasta em Shared Drive, ou configure GOOGLE_IMPERSONATE_USER com delegacao de dominio.'],
      );
    }
  } else {
    const tokens = readGoogleTokens(authConfig.tokenPath);

    try {
      await auth.getAccessToken();
    } catch (error) {
      throw normalizeGoogleAuthError(error, authConfig, tokens);
    }
  }

  if (!folderId) return;

  let folder;
  try {
    folder = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType, driveId, capabilities(canAddChildren)',
      supportsAllDrives: true,
    });
  } catch (error) {
    if (authConfig.mode === 'service_account') {
      throw buildServiceAccountError(
        authConfig,
        'a pasta configurada em GOOGLE_DRIVE_FOLDER_ID nao esta acessivel para a service account.',
        [
          `       Pasta alvo: ${folderId}`,
          '       Compartilhe a pasta com esse email ou use uma pasta em Shared Drive com permissao de escrita.',
        ],
        error,
      );
    }
    throw error;
  }

  if (folder.data.mimeType !== GOOGLE_FOLDER_MIME) {
    throw new Error(`GOOGLE_DRIVE_FOLDER_ID (${folderId}) nao aponta para uma pasta do Google Drive.`);
  }

  if (authConfig.mode === 'service_account' && !authConfig.impersonatedUser && !folder.data.driveId) {
    throw buildServiceAccountError(
      authConfig,
      'a pasta configurada parece estar no My Drive, nao em Shared Drive.',
      [
        `       Pasta alvo: ${folderId}`,
        '       Para service account pura, use uma pasta em Shared Drive.',
        '       Se voce precisa gravar no My Drive de um usuario, configure GOOGLE_IMPERSONATE_USER com domain-wide delegation.',
      ],
    );
  }

  if (folder.data.capabilities?.canAddChildren === false) {
    const baseMessage = authConfig.mode === 'service_account'
      ? buildServiceAccountError(
        authConfig,
        'a conta autenticada nao tem permissao para criar arquivos na pasta configurada.',
        [
          `       Pasta alvo: ${folderId}`,
          '       Conceda permissao de escrita nessa pasta antes de executar o pipeline.',
        ],
      )
      : new Error(`A conta Google autenticada nao tem permissao para criar arquivos na pasta ${folderId}.`);

    throw baseMessage;
  }
}

async function listCandidateClippingDocsForPersona(drive, personaName, folderId = null, pageSize = 50) {
  const rawTokens = personaName
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((token) => token.length >= 3);
  const searchToken = rawTokens.at(-1) ?? personaName;
  const queryParts = [
    `mimeType='${GOOGLE_DOC_MIME}'`,
    'trashed=false',
    `name contains '${escapeDriveQueryValue(searchToken)}'`,
  ];

  if (folderId) {
    queryParts.push(`'${escapeDriveQueryValue(folderId)}' in parents`);
  }

  const response = await drive.files.list({
    q: queryParts.join(' and '),
    pageSize,
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name, modifiedTime, webViewLink)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files ?? [];
}

export async function findRecentClippingDocsForPersona(
  drive,
  personaName,
  folderId = null,
  lookbackDays = null,
  pageSize = 50,
) {
  const files = await listCandidateClippingDocsForPersona(drive, personaName, folderId, pageSize);
  return filterClippingDocsForPersona(files, personaName, lookbackDays);
}

export async function findLatestClippingDocForPersona(drive, personaName, folderId = null) {
  const files = await findRecentClippingDocsForPersona(drive, personaName, folderId, null, 20);
  return files[0] ?? null;
}

export async function readGoogleDocText(docs, documentId) {
  const response = await docs.documents.get({ documentId });
  const chunks = [];

  for (const block of response.data.body?.content ?? []) {
    for (const element of block.paragraph?.elements ?? []) {
      const text = element.textRun?.content;
      if (text) chunks.push(text);
    }
  }

  return chunks.join('');
}

export async function createGoogleDoc(
  docs,
  drive,
  docTitle,
  newsItems,
  folderId = null,
  authConfig = null,
  sharingConfig = { mode: 'restricted' },
) {
  try {
    const createRes = await drive.files.create({
      requestBody: {
        name: docTitle,
        mimeType: GOOGLE_DOC_MIME,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    const docId = createRes.data.id;

    const today = formatClippingDocDate();

    const requests = [];
    let cursor = 1;

    const header = `CLIPPING DE NOTICIAS - ${today}\n\n`;
    requests.push({ insertText: { location: { index: cursor }, text: header } });
    requests.push({
      updateParagraphStyle: {
        range         : { startIndex: cursor, endIndex: cursor + header.length - 1 },
        paragraphStyle: { namedStyleType: 'HEADING_1' },
        fields        : 'namedStyleType',
      },
    });
    cursor += header.length;

    newsItems.forEach((item, i) => {
      const chamadaText = `${i + 1}. ${item.chamada}\n`;
      const resumoText  = `${item.resumo}\n`;
      const linkText    = `Link: ${item.link}\n\n`;

      requests.push({ insertText: { location: { index: cursor }, text: chamadaText } });
      requests.push({
        updateParagraphStyle: {
          range         : { startIndex: cursor, endIndex: cursor + chamadaText.length - 1 },
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          fields        : 'namedStyleType',
        },
      });
      cursor += chamadaText.length;

      requests.push({ insertText: { location: { index: cursor }, text: resumoText } });
      cursor += resumoText.length;

      requests.push({ insertText: { location: { index: cursor }, text: linkText } });
      requests.push({
        updateTextStyle: {
          range    : { startIndex: cursor + 6, endIndex: cursor + linkText.length - 2 },
          textStyle: {
            foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.1, green: 0.3 } } },
            underline: true,
          },
          fields: 'foregroundColor,underline',
        },
      });
      cursor += linkText.length;
    });

    await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

    if (sharingConfig.mode === 'anyone_reader') {
      await drive.permissions.create({
        fileId: docId,
        requestBody: { role: 'reader', type: 'anyone' },
        supportsAllDrives: true,
      });
    }

    return createRes.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
  } catch (error) {
    if (authConfig?.mode === 'service_account') {
      throw normalizeServiceAccountError(error, authConfig, folderId);
    }
    if (authConfig?.mode === 'oauth') {
      throw normalizeGoogleAuthError(error, authConfig);
    }
    throw error;
  }
}
