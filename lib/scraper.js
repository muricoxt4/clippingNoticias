import puppeteer from 'puppeteer';
import { parseDate, isWithinDays, isValidTitle } from './utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DYNAMIC_PORTALS = ['g1.globo.com', 'infomoney.com.br', 'exame.com'];

export async function createBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

/**
 * Scrapes a news portal and returns filtered articles plus diagnostic metadata.
 *
 * meta shape:
 *   raw_count      — candidate elements found on the page
 *   title_filtered — discarded by noise/length rules
 *   date_filtered  — valid titles but outside the date window
 *
 * @returns {{ articles: object[], meta: object }}
 */
export async function scrapeArticles(browser, url, daysBack) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  try {
    const hostname  = new URL(url).hostname;
    const isDynamic = DYNAMIC_PORTALS.some((d) => hostname.includes(d));

    await page.goto(url, {
      waitUntil: isDynamic ? 'networkidle2' : 'domcontentloaded',
      timeout  : isDynamic ? 45_000 : 30_000,
    });

    if (isDynamic) {
      await page.evaluate(() => {
        for (let i = 1; i <= 4; i++) window.scrollBy(0, window.innerHeight * i);
      });
      await new Promise((r) => setTimeout(r, 2500));
    }

    const rawArticles = await page.evaluate((currentUrl) => {
      const hostname = new URL(currentUrl).hostname;
      const results = [];
      const seen = new Set();

      if (hostname.includes('exame.com')) {
        const blockedSections = new Set([
          '',
          'invest',
          'negocios',
          'inteligencia-artificial',
          'esg',
          'ultimas-noticias',
          'brasil',
          'carreira',
          'economia',
          'insight',
          'mercado-imobiliario',
          'mundo',
          'casual',
          'marketing',
          'esporte',
          'agro',
          'tecnologia',
          'future-of-money',
          'ciencia',
          'pop',
          'colunistas',
          'reportagens-especiais',
          'videos',
          'newsletters',
          'edicoes',
          'institucional',
          'autor',
          'pagina-especial',
          'canais-especiais',
          'guia-do-cidadao',
          'exame-in',
          'mm',
          'negocios-em-expansao',
          'lei-transparencia-salarial',
        ]);
        const blockedPrefixes = [
          '/invest/guia/',
          '/invest/calculadoras/',
          '/tecnologia/examelab/',
          '/edicoes/',
          '/newsletters/',
          '/institucional/',
        ];

        const anchors = [...document.querySelectorAll('a[href]')];
        anchors.forEach((anchor) => {
          const link = anchor.href;
          if (!link?.startsWith('https://exame.com/')) return;

          const path = new URL(link).pathname;
          if (blockedPrefixes.some((prefix) => path.startsWith(prefix))) return;
          const parts = path.split('/').filter(Boolean);
          if (parts.length < 2) return;
          if (blockedSections.has(parts[0]) && parts.length === 1) return;
          if (parts[0] === 'autor' || parts[0] === 'canais-especiais' || parts[0] === 'pagina-especial')
            return;

          const cleanText = (value) => value
            ?.replace(/<[^>]+>/g, ' ')
            .replace(/^Imagem referente à notícia:\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();
          const text = cleanText(anchor.textContent ?? '');
          const imgAlt = cleanText(anchor.querySelector('img')?.getAttribute('alt') ?? '');
          const title = text || imgAlt;
          if (!title || title.length < 20 || seen.has(link)) return;

          const container = anchor.closest('div, li, section, main');
          const timeEl = container?.querySelector('time,[class*="date"],[class*="data"],[class*="hora"]');
          const dateStr = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim();

          seen.add(link);
          results.push({ title, link, dateStr: dateStr ?? null });
        });

        return results;
      }

      const candidates = [
        ...document.querySelectorAll('article'),
        ...document.querySelectorAll('[class*="news-item"]'),
        ...document.querySelectorAll('[class*="noticia"]'),
        ...document.querySelectorAll('[class*="card"]'),
        ...document.querySelectorAll('li[class*="item"]'),
        ...document.querySelectorAll('[data-testid*="card"]'),
        ...document.querySelectorAll('[class*="c-card"]'),
        ...document.querySelectorAll('a[href*="/noticia/"]'),
        ...document.querySelectorAll('a[href*="/noticias/"]'),
      ];
      candidates.forEach((el) => {
        const anchor  = el.tagName === 'A' ? el : el.querySelector('a[href]');
        const heading = el.querySelector('h1,h2,h3,h4');
        const timeEl  = el.querySelector('time,[class*="date"],[class*="data"],[class*="hora"]');
        const link    = anchor?.href;
        const title   = (heading?.textContent ?? el.innerText?.split('\n')[0])?.trim();
        const dateStr = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim();
        if (!title || title.length < 10 || !link || seen.has(link)) return;
        seen.add(link);
        results.push({ title, link, dateStr: dateStr ?? null });
      });
      return results;
    }, url);

    const afterTitle = rawArticles.filter((a) => isValidTitle(a.title));
    const afterDate  = afterTitle.filter((a) => isWithinDays(parseDate(a.dateStr), daysBack));

    // Most recent first; articles with no parseable date go to the end
    afterDate.sort((a, b) => {
      const da = parseDate(a.dateStr);
      const db = parseDate(b.dateStr);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db - da;
    });

    return {
      articles: afterDate,
      meta: {
        raw_count     : rawArticles.length,
        title_filtered: rawArticles.length - afterTitle.length,
        date_filtered : afterTitle.length - afterDate.length,
      },
    };
  } finally {
    await page.close();
  }
}

export async function fetchArticleText(browser, articleUrl) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  try {
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return await page.evaluate(() => {
      for (const sel of [
        'article',
        '[class*="content"]',
        '[class*="article-body"]',
        '[class*="post-body"]',
        'main',
      ]) {
        const el = document.querySelector(sel);
        if (el && el.innerText.length > 200) return el.innerText.replace(/\s+/g, ' ').trim();
      }
      return document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000);
    });
  } finally {
    await page.close();
  }
}
