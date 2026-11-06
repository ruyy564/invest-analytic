import { readFileSync } from 'node:fs';
import { createFeedSource } from '../../src/news/sources/feed.js';
import { HttpGateway } from '../../src/platform/http/index.js';
import { loadNewsPolicy, resetNewsPolicyCache } from '../../src/capabilities/news/index.js';

const RSS = readFileSync('test/fixtures/golden/interfax.rss', 'utf8');
const gateway = (): HttpGateway => new HttpGateway(async () => RSS, { retries: 0 });

beforeAll(() => {
  resetNewsPolicyCache();
});

describe('политика в источнике-ленте', () => {
  it('с политикой оставляет только инвестиционную повестку и отдаёт причины', async () => {
    const source = createFeedSource({
      id: 'interfax',
      url: 'https://example.test/rss',
      format: 'rss',
      gateway: gateway(),
      policy: loadNewsPolicy('data/policy/news.yaml'),
    });

    const result = await source.fetchNewsWithReport?.({ pages: 1, maxItems: 10 });

    expect(result?.items.map((item) => item.title)).toEqual([
      'Индекс Мосбиржи вырос на 1,2 %',
    ]);
    expect(result?.dropped).toEqual(
      expect.arrayContaining([
        { reason: 'digest', count: 1 },
        { reason: 'no_marker', count: 1 },
      ]),
    );
  });

  it('без политики работает прежнее поведение (только отсев дайджестов)', async () => {
    const source = createFeedSource({
      id: 'interfax',
      url: 'https://example.test/rss',
      format: 'rss',
      gateway: gateway(),
    });

    const items = await source.fetchNews({ pages: 1, maxItems: 10 });

    expect(items.map((item) => item.title)).toEqual([
      'Индекс Мосбиржи вырос на 1,2 %',
      'В АдГ заявили, что визиты дорого обходятся немцам',
    ]);
    expect(source.fetchNewsWithReport).toBeDefined();
  });
});
