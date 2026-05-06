export function log(message) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

function normalizeDateText(value) {
  return value
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim() ?? '';
}

function subtractFromNow(amount, unit) {
  const now = new Date();
  const parsed = new Date(now);

  if (unit.startsWith('minuto')) {
    parsed.setMinutes(parsed.getMinutes() - amount);
    return parsed;
  }

  if (unit.startsWith('hora')) {
    parsed.setHours(parsed.getHours() - amount);
    return parsed;
  }

  if (unit.startsWith('dia')) {
    parsed.setDate(parsed.getDate() - amount);
    return parsed;
  }

  if (unit.startsWith('semana')) {
    parsed.setDate(parsed.getDate() - (amount * 7));
    return parsed;
  }

  return null;
}

export function parseDate(value) {
  if (!value) return null;

  let parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const normalizedValue = normalizeDateText(value);

  const brMatch = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    parsed = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const relativeMatch = normalizedValue.match(
    /\bha\s+(?:cerca de\s+)?(\d+)\s+(minuto|minutos|hora|horas|dia|dias|semana|semanas)\b/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const relativeDate = subtractFromNow(amount, relativeMatch[2].toLowerCase());
    if (relativeDate) return relativeDate;
  }

  const now = new Date();
  if (normalizedValue.includes('ontem')) {
    parsed = new Date(now);
    parsed.setDate(parsed.getDate() - 1);
    return parsed;
  }

  return null;
}

export function isWithinDays(date, days) {
  if (!date) return true;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

export const NOISE_PATTERNS = [
  /^[A-Z]{3,6}\d[\d.,]+(?:pts|R\$|%)/,
  /^[A-Z]{3,6}\d(?:R\$)?[\d.,%-]+/,
  /R\$[\d.,]+[-+][\d.,]+%/,
  /^\d+[\d.,]+pts/,
  /^(mais lidas?|redes sociais|onde investir|assine|newsletter|publicidade|login|cadastre)/i,
];

export function isValidTitle(title) {
  if (!title || title.length < 15) return false;
  return !NOISE_PATTERNS.some((pattern) => pattern.test(title));
}
