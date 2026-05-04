export function log(message) {
  const timestamp = new Date().toLocaleTimeString('pt-BR');
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

export function parseDate(value) {
  if (!value) return null;

  let parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const brMatch = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    parsed = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const now = new Date();
  if (/ha\s+\d+\s+minuto/i.test(value) || /ha\s+\d+\s+hora/i.test(value)) return now;
  if (/ontem/i.test(value)) {
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
