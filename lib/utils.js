export function log(msg) {
  const ts = new Date().toLocaleTimeString('pt-BR');
  process.stdout.write(`[${ts}] ${msg}\n`);
}

export function parseDate(str) {
  if (!str) return null;

  let d = new Date(str);
  if (!isNaN(d)) return d;

  const br = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const [, day, month, year] = br;
    const fullYear = year.length === 2 ? `20${year}` : year;
    d = new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    if (!isNaN(d)) return d;
  }

  const now = new Date();
  if (/há\s+\d+\s+minuto/i.test(str) || /há\s+\d+\s+hora/i.test(str)) return now;
  if (/ontem/i.test(str)) {
    d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
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
  /R\$[\d.,]+[-+][\d.,]+%/,
  /^\d+[\d.,]+pts/,
  /^(mais lidas?|redes sociais|onde investir|assine|newsletter|publicidade|login|cadastre)/i,
];

export function isValidTitle(title) {
  if (!title || title.length < 15) return false;
  return !NOISE_PATTERNS.some((re) => re.test(title));
}
