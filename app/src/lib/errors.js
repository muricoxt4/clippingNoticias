function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(1, Math.ceil(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (!minutes) return `${remainingSeconds}s`;
  if (!remainingSeconds) return `${minutes}m`;
  return `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`;
}

function parseRetryAfterSeconds(error) {
  const retryAfterHeader = error?.headers?.['retry-after']
    ?? error?.response?.headers?.['retry-after'];

  return toPositiveNumber(retryAfterHeader);
}

function extractGroqModel(message) {
  const match = message?.match(/model `([^`]+)`/i);
  return match?.[1] ?? null;
}

function isGroqRateLimitError(error) {
  return error?.status === 429
    || error?.error?.error?.code === 'rate_limit_exceeded'
    || /rate limit/i.test(error?.message ?? '');
}

function formatKnownError(error) {
  if (typeof error?.message === 'string' && error.message.startsWith('[ERRO]')) {
    return error.message;
  }

  if (isGroqRateLimitError(error)) {
    const apiMessage = error?.error?.error?.message ?? error?.message ?? 'limite atingido';
    const model = extractGroqModel(apiMessage);
    const retryAfterSeconds = parseRetryAfterSeconds(error);
    const lines = [
      '[ERRO] A chamada para a Groq foi bloqueada por limite de uso.',
      '       Servico: Groq',
      '       Tipo: rate_limit_exceeded',
    ];

    if (model) lines.push(`       Modelo: ${model}`);
    if (retryAfterSeconds) lines.push(`       Tente novamente em: ${formatDuration(retryAfterSeconds)}`);
    lines.push(`       Detalhe: ${apiMessage}`);
    lines.push('       Ajuste sugerido: reduza a quantidade de artigos/personas ou aguarde o reset da cota.');

    return lines.join('\n');
  }

  if (/timeout/i.test(error?.message ?? '')) {
    return [
      '[ERRO] A operacao excedeu o tempo limite.',
      `       Detalhe: ${error.message}`,
      '       Ajuste sugerido: tente novamente ou reduza a quantidade de portais/artigos.',
    ].join('\n');
  }

  if (error?.status || error?.response?.status) {
    const status = error.status ?? error.response?.status;
    const apiMessage = error?.response?.data?.error?.message
      ?? error?.response?.data?.message
      ?? error?.message;

    return [
      '[ERRO] A operacao falhou em uma chamada externa.',
      `       Status: ${status}`,
      `       Detalhe: ${apiMessage}`,
    ].join('\n');
  }

  return [
    '[ERRO] O pipeline foi interrompido por uma falha inesperada.',
    `       Detalhe: ${error?.message ?? String(error)}`,
  ].join('\n');
}

function appendWarningLines(lines, label, warnings) {
  if (!warnings.length) return;

  lines.push(`       ${label}: ${warnings.length}`);
  warnings.slice(0, 3).forEach((warning) => {
    lines.push(`         - ${warning}`);
  });

  if (warnings.length > 3) {
    lines.push(`         - ... e mais ${warnings.length - 3}`);
  }
}

export function printPipelineFailure(error, state) {
  const lines = [
    '',
    '='.repeat(62),
    '[ERRO] Pipeline interrompido.',
    `       Etapa: ${state.currentStep ?? 'nao informada'}`,
  ];

  if (state.currentPersona) lines.push(`       Persona atual: ${state.currentPersona}`);
  if (state.currentArticleTitle) lines.push(`       Artigo atual: ${state.currentArticleTitle}`);

  lines.push(
    '',
    '       Progresso acumulado:',
    `         - Titulos coletados: ${state.titlesCollected ?? 0}`,
    `         - Artigos selecionados: ${state.selectedUniqueCount ?? 0}`,
    `         - Resumos concluidos: ${state.summariesCompleted ?? 0}`,
    `         - Docs criados: ${state.docsCreated?.length ?? 0}`,
  );

  appendWarningLines(lines, 'Portais com falha', state.scrapeWarnings ?? []);
  appendWarningLines(lines, 'Artigos sem extracao completa', state.extractionWarnings ?? []);

  lines.push('', formatKnownError(error), '='.repeat(62), '');
  console.error(lines.join('\n'));
}

export function printPipelineWarnings(state) {
  const warnings = [];
  appendWarningLines(warnings, 'Portais com falha', state.scrapeWarnings ?? []);
  appendWarningLines(warnings, 'Artigos sem extracao completa', state.extractionWarnings ?? []);

  if (!warnings.length) return;

  console.log('');
  console.log('Avisos do processamento:');
  warnings.forEach((line) => console.log(line));
  console.log('');
}

export function formatToolError(error) {
  return formatKnownError(error);
}
