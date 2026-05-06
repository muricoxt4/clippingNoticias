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

export async function scrapeArticles(browser, url, daysBack) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  try {
    const hostname = new URL(url).hostname;
    const isDynamic = DYNAMIC_PORTALS.some((portal) => hostname.includes(portal));

    await page.goto(url, {
      waitUntil: isDynamic ? 'networkidle2' : 'domcontentloaded',
      timeout: isDynamic ? 45_000 : 30_000,
    });

    if (isDynamic) {
      await page.evaluate(() => {
        for (let step = 1; step <= 4; step += 1) {
          window.scrollBy(0, window.innerHeight * step);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    const rawArticles = await page.evaluate((currentUrl) => {
      const pageHostname = new URL(currentUrl).hostname;
      const results = [];
      const seen = new Set();

      const normalizeText = (value) => value
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/^Imagem referente a noticia:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageHostname.includes('exame.com')) {
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

          const parsedUrl = new URL(link);
          if (blockedPrefixes.some((prefix) => parsedUrl.pathname.startsWith(prefix))) return;

          const parts = parsedUrl.pathname.split('/').filter(Boolean);
          if (parts.length < 2) return;
          if (blockedSections.has(parts[0]) && parts.length === 1) return;
          if (parts[0] === 'autor' || parts[0] === 'canais-especiais' || parts[0] === 'pagina-especial') return;

          const text = normalizeText(anchor.textContent ?? '');
          const imageAlt = normalizeText(anchor.querySelector('img')?.getAttribute('alt') ?? '');
          const title = text || imageAlt;
          if (!title || title.length < 20 || seen.has(link)) return;

          const container = anchor.closest('div, li, section, main');
          const timeElement = container?.querySelector('time,[class*="date"],[class*="data"],[class*="hora"]');
          const dateStr = timeElement?.getAttribute('datetime') || timeElement?.textContent?.trim();

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

      candidates.forEach((element) => {
        const anchor = element.tagName === 'A' ? element : element.querySelector('a[href]');
        const heading = element.querySelector('h1,h2,h3,h4');
        const timeElement = element.querySelector('time,[class*="date"],[class*="data"],[class*="hora"]');
        const link = anchor?.href;
        const title = (heading?.textContent ?? element.innerText?.split('\n')[0])?.trim();
        const dateStr = timeElement?.getAttribute('datetime') || timeElement?.textContent?.trim();

        if (!title || title.length < 10 || !link || seen.has(link)) return;

        seen.add(link);
        results.push({ title, link, dateStr: dateStr ?? null });
      });

      return results;
    }, url);

    const afterTitle = rawArticles.filter((article) => isValidTitle(article.title));
    const afterDate = afterTitle.filter((article) => isWithinDays(parseDate(article.dateStr), daysBack));

    afterDate.sort((left, right) => {
      const leftDate = parseDate(left.dateStr);
      const rightDate = parseDate(right.dateStr);
      if (!leftDate && !rightDate) return 0;
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      return rightDate - leftDate;
    });

    return {
      articles: afterDate,
      meta: {
        raw_count: rawArticles.length,
        title_filtered: rawArticles.length - afterTitle.length,
        date_filtered: afterTitle.length - afterDate.length,
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
      for (const selector of [
        'article',
        '[class*="content"]',
        '[class*="article-body"]',
        '[class*="post-body"]',
        'main',
      ]) {
        const element = document.querySelector(selector);
        if (element && element.innerText.length > 200) {
          return element.innerText.replace(/\s+/g, ' ').trim();
        }
      }

      return document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 3000);
    });
  } finally {
    await page.close();
  }
}
