import assert from 'node:assert/strict';

import {
  dedupeArticles,
  filterSelectionAgainstHistory,
  normalizeArticleLink,
  recordSentArticles,
  resolveNewsHistoryConfig,
} from '../lib/history.js';
import { resolveDocSharingConfig } from '../lib/google.js';
import { isValidTitle } from '../lib/utils.js';

const tests = [
  {
    name: 'normalizeArticleLink removes tracking params and hash',
    run() {
      const normalized = normalizeArticleLink(
        'https://site.com/path/?utm_source=x&b=2#top',
      );
      assert.equal(normalized, 'https://site.com/path?b=2');
    },
  },
  {
    name: 'dedupeArticles removes duplicate links and titles',
    run() {
      const { uniqueArticles, removedArticles } = dedupeArticles([
        { title: 'Mercado sobe com corte de juros', link: 'https://site.com/m1?utm_source=x' },
        { title: 'Mercado sobe com corte de juros', link: 'https://site.com/m1?utm_medium=y' },
        { title: 'Empresa anuncia aquisicao', link: 'https://site.com/m2' },
      ]);

      assert.equal(uniqueArticles.length, 2);
      assert.equal(removedArticles.length, 1);
    },
  },
  {
    name: 'filterSelectionAgainstHistory removes already sent item for persona',
    run() {
      const articles = [
        { title: 'Mercado sobe com corte de juros', link: 'https://site.com/m1' },
        { title: 'Empresa anuncia aquisicao', link: 'https://site.com/m2' },
      ];
      const history = { version: 1, personas: {} };
      recordSentArticles(history, { id: 'marcos' }, [articles[0]], { lookbackDays: 14 });

      const result = filterSelectionAgainstHistory([0, 1], articles, history, 'marcos', 10);
      assert.deepEqual(result.keptIndices, [1]);
      assert.equal(result.removedCount, 1);
    },
  },
  {
    name: 'resolveNewsHistoryConfig blocks paths outside project',
    run() {
      assert.throws(
        () => resolveNewsHistoryConfig(
          { NEWS_HISTORY_PATH: 'C:\\fora\\news-history.json' },
          'C:\\repo',
        ),
        /NEWS_HISTORY_PATH deve apontar para um arquivo dentro do projeto/,
      );
    },
  },
  {
    name: 'resolveDocSharingConfig defaults to restricted',
    run() {
      assert.deepEqual(resolveDocSharingConfig({}), { mode: 'restricted' });
    },
  },
  {
    name: 'resolveDocSharingConfig accepts anyone_reader',
    run() {
      assert.deepEqual(
        resolveDocSharingConfig({ GOOGLE_DOC_SHARE_MODE: 'anyone_reader' }),
        { mode: 'anyone_reader' },
      );
    },
  },
  {
    name: 'resolveDocSharingConfig rejects invalid mode',
    run() {
      assert.throws(
        () => resolveDocSharingConfig({ GOOGLE_DOC_SHARE_MODE: 'public' }),
        /GOOGLE_DOC_SHARE_MODE invalido/,
      );
    },
  },
  {
    name: 'isValidTitle rejects ticker-only quote titles',
    run() {
      assert.equal(isValidTitle('PETR4R$49,641,14%'), false);
      assert.equal(isValidTitle('ABEV3R$14,520,07%'), false);
      assert.equal(isValidTitle('WEG amplia fabrica e acelera expansao global'), true);
    },
  },
];

let failures = 0;

for (const test of tests) {
  try {
    await test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${test.name}`);
    console.error(error.stack ?? error.message);
  }
}

if (failures > 0) {
  console.error(`\n${failures} teste(s) falharam.`);
  process.exit(1);
}

console.log(`\n${tests.length} teste(s) passaram.`);
