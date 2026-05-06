import assert from 'node:assert/strict';

import {
  buildHistoryPromptContext,
  dedupeArticles,
  filterSelectionAgainstHistory,
  normalizeArticleLink,
  recordSentArticles,
  resolveNewsHistoryConfig,
} from '../src/lib/history.js';
import { filterByPersona } from '../src/lib/ai.js';
import {
  filterClippingDocsForPersona,
  formatClippingDocDate,
  formatClippingDocTitle,
  isClippingDocTitleForPersona,
  resolveDocSharingConfig,
} from '../src/lib/google.js';
import { validatePersonas } from '../src/lib/personas.js';
import { isValidTitle, isWithinDays, parseDate } from '../src/lib/utils.js';

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
    name: 'filterSelectionAgainstHistory matches original title even after summary headline changes',
    run() {
      const history = { version: 1, personas: {} };
      recordSentArticles(
        history,
        { id: 'marcos' },
        [{
          title: 'Empresa anuncia aquisicao bilionaria no setor de energia',
          chamada: 'Gigante fecha acordo historico',
          link: 'https://site.com/energia/aquisicao-antiga',
        }],
        { lookbackDays: 14 },
      );

      const result = filterSelectionAgainstHistory(
        [0],
        [{
          title: 'Empresa anuncia aquisicao bilionaria no setor de energia',
          link: 'https://site.com/energia/aquisicao-nova',
        }],
        history,
        'marcos',
        10,
      );

      assert.deepEqual(result.keptIndices, []);
      assert.equal(result.removedCount, 1);
    },
  },
  {
    name: 'recordSentArticles stores link, chamada and resumo in history',
    run() {
      const history = { version: 1, personas: {} };
      recordSentArticles(
        history,
        { id: 'marcos' },
        [{
          title: 'Empresa anuncia aquisicao bilionaria no setor de energia',
          chamada: 'Gigante fecha acordo historico',
          resumo: 'A companhia confirmou a compra e detalhou impacto financeiro esperado.',
          link: 'https://site.com/energia/aquisicao',
        }],
        { lookbackDays: 14 },
      );

      assert.deepEqual(history.personas.marcos[0], {
        title: 'Empresa anuncia aquisicao bilionaria no setor de energia',
        chamada: 'Gigante fecha acordo historico',
        resumo: 'A companhia confirmou a compra e detalhou impacto financeiro esperado.',
        link: 'https://site.com/energia/aquisicao',
        normalizedLink: 'https://site.com/energia/aquisicao',
        titleKey: 'empresa anuncia aquisicao bilionaria no setor de energia',
        titleKeys: [
          'empresa anuncia aquisicao bilionaria no setor de energia',
          'gigante fecha acordo historico',
        ],
        sourceTitleKey: 'site.com::empresa anuncia aquisicao bilionaria no setor de energia',
        sourceTitleKeys: [
          'site.com::empresa anuncia aquisicao bilionaria no setor de energia',
          'site.com::gigante fecha acordo historico',
        ],
        source: null,
        sentAt: history.personas.marcos[0].sentAt,
        docTitle: null,
        docLink: null,
      });
    },
  },
  {
    name: 'buildHistoryPromptContext includes title, chamada, resumo and link with compact formatting',
    run() {
      const history = {
        version: 1,
        personas: {
          marcos: [{
            title: 'Empresa anuncia aquisicao bilionaria no setor de energia',
            chamada: 'Gigante fecha acordo historico',
            resumo: 'A companhia confirmou a compra e detalhou impacto financeiro esperado.',
            link: 'https://site.com/energia/aquisicao',
            sentAt: '2026-05-06T12:00:00Z',
          }],
        },
      };

      assert.deepEqual(
        buildHistoryPromptContext(history, 'marcos'),
        [
          'Titulo original: Empresa anuncia aquisicao bilionaria no setor de energia | ' +
          'Chamada enviada: Gigante fecha acordo historico | ' +
          'Resumo enviado: A companhia confirmou a compra e detalhou impacto financeiro esperado. | ' +
          'Link: https://site.com/energia/aquisicao',
        ],
      );
    },
  },
  {
    name: 'filterByPersona preserves original article indices after skipping invalid entries',
    async run() {
      const groq = {
        chat: {
          completions: {
            create: async () => ({
              choices: [{ message: { content: '{"selecionados":[2]}' } }],
            }),
          },
        },
      };

      const indices = await filterByPersona(
        groq,
        [
          { error: 'portal indisponivel' },
          { articles_found: 0, reason: 'nenhum item' },
          { title: 'Empresa anuncia aquisicao', link: 'https://site.com/m1' },
        ],
        { id: 'marcos', nome: 'Marcos', descricao: 'Executivo de negocios' },
      );

      assert.deepEqual(indices, [2]);
    },
  },
  {
    name: 'filterByPersona returns empty when there are no valid articles',
    async run() {
      const groq = {
        chat: {
          completions: {
            create: async () => {
              throw new Error('nao deveria chamar a IA sem artigos validos');
            },
          },
        },
      };

      const indices = await filterByPersona(
        groq,
        [
          { error: 'portal indisponivel' },
          { articles_found: 0, reason: 'nenhum item' },
        ],
        { id: 'marcos', nome: 'Marcos', descricao: 'Executivo de negocios' },
      );

      assert.deepEqual(indices, []);
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
    name: 'validatePersonas rejects duplicate ids',
    run() {
      assert.throws(
        () => validatePersonas([
          { id: 'marcos', nome: 'Marcos', descricao: 'Executivo' },
          { id: 'marcos', nome: 'Marcos 2', descricao: 'Outro executivo' },
        ]),
        /campo "id" duplicado/,
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
    name: 'formatClippingDocDate uses DD-MM-AAAA',
    run() {
      assert.equal(formatClippingDocDate(new Date('2026-05-06T12:00:00Z')), '06-05-2026');
    },
  },
  {
    name: 'formatClippingDocTitle uses date and persona name',
    run() {
      assert.equal(
        formatClippingDocTitle('Marcos Fernandes', new Date('2026-05-06T12:00:00Z')),
        '06-05-2026 | Marcos Fernandes',
      );
    },
  },
  {
    name: 'isClippingDocTitleForPersona accepts current format',
    run() {
      assert.equal(
        isClippingDocTitleForPersona('06-05-2026 | Marcos Fernandes', 'Marcos Fernandes'),
        true,
      );
    },
  },
  {
    name: 'isClippingDocTitleForPersona accepts legacy format',
    run() {
      assert.equal(
        isClippingDocTitleForPersona('Clipping Marcos Fernandes - 06/05/2026', 'Marcos Fernandes'),
        true,
      );
    },
  },
  {
    name: 'filterClippingDocsForPersona keeps only matching docs within lookback',
    run() {
      const files = [
        { name: '06-05-2026 | Marcos Fernandes', modifiedTime: '2026-05-06T12:00:00Z' },
        { name: 'Clipping Marcos Fernandes - 02/05/2026', modifiedTime: '2026-05-02T12:00:00Z' },
        { name: '28-04-2026 | Marcos Fernandes', modifiedTime: '2026-04-28T12:00:00Z' },
        { name: '06-05-2026 | Outro Cliente', modifiedTime: '2026-05-06T12:00:00Z' },
      ];

      const filtered = filterClippingDocsForPersona(
        files,
        'Marcos Fernandes',
        7,
        new Date('2026-05-06T15:00:00Z'),
      );

      assert.deepEqual(
        filtered.map((file) => file.name),
        [
          '06-05-2026 | Marcos Fernandes',
          'Clipping Marcos Fernandes - 02/05/2026',
        ],
      );
    },
  },
  {
    name: 'parseDate understands accented relative PT-BR dates',
    run() {
      const parsed = parseDate('há 2 horas');
      assert.equal(parsed instanceof Date, true);
      assert.equal(Number.isNaN(parsed.getTime()), false);
      assert.equal(isWithinDays(parsed, 1), true);
    },
  },
  {
    name: 'parseDate keeps relative days outside tight lookback',
    run() {
      const parsed = parseDate('há 3 dias');
      assert.equal(parsed instanceof Date, true);
      assert.equal(isWithinDays(parsed, 1), false);
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
