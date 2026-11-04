import { createFeedSource, parseFeed, stripMarkup } from '../../src/sources/feed.js';
import { dedupeKey, mergeNews, SourceRegistry } from '../../src/sources/registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/sources/types.js';
import { mapNews } from '../../src/sources/tinkoff.js';
import { collectNewsDigest, formatNewsDigest } from '../../src/tools/thematic/news-digest.js';

const RSS = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
<item><title>Сбербанк отчитался за квартал</title><link>https://a/1</link>
<description><![CDATA[<p>Чистая прибыль выросла</p>]]></description>
<category>Экономика</category><pubDate>Wed, 04 Nov 2026 10:00:00 +0300</pubDate>
<guid>1</guid></item>
<item><title>Ставка ЦБ: что изменится</title><link>https://a/2</link>
<description>Налоговые нюансы</description><pubDate>Tue, 03 Nov 2026 09:00:00 +0300</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Газпром: дивиденды</title><link href="https://b/1"/><updated>2026-11-02T09:00:00Z</updated>
<summary>Кратко</summary><category term="Рынок"/></entry></feed>`;

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  id: 'id',
  title: 'Заголовок',
  publishedAt: new Date().toISOString(),
  tags: [],
  source: 'test',
  ...overrides,
});

describe('адаптер лент', () => {
  it('разбирает RSS: заголовок, ссылка, аннотация, теги, дата', () => {
    const items = parseFeed(RSS, { format: 'rss', source: 'interfax' });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Сбербанк отчитался за квартал',
      url: 'https://a/1',
      summary: 'Чистая прибыль выросла',
      tags: ['Экономика'],
      source: 'interfax',
    });
    expect(items[0].publishedAt).toBe(new Date('2026-11-04T07:00:00Z').toISOString());
  });

  it('разбирает Atom: ссылка из атрибута href', () => {
    const items = parseFeed(ATOM, { format: 'atom', source: 'rbc' });

    expect(items[0]).toMatchObject({ title: 'Газпром: дивиденды', url: 'https://b/1' });
  });

  it('отклоняет HTML вместо XML и пустую ленту', () => {
    expect(() =>
      parseFeed('<html><body>нет ленты</body></html>', { format: 'rss', source: 'x' }),
    ).toThrow(/HTML/);
    expect(() => parseFeed('<rss><channel></channel></rss>', { format: 'rss', source: 'x' })).toThrow(
      /нет элементов/,
    );
  });

  it('оставляет элементы только за период и сортирует новые сверху', async () => {
    const source = createFeedSource({
      id: 'interfax',
      url: 'https://feed',
      format: 'rss',
      fetchText: async () => RSS,
    });

    const fresh = await source.fetchNews({ pages: 1, maxItems: 10, sinceDays: 1 });
    const all = await source.fetchNews({ pages: 1, maxItems: 10 });

    expect(all).toHaveLength(2);
    expect(all[0].publishedAt >= all[1].publishedAt).toBe(true);
    expect(fresh.length).toBeLessThanOrEqual(1);
  });

  it('убирает разметку и раскрывает сущности', () => {
    expect(stripMarkup('<p>A &amp; B</p>')).toBe('A & B');
  });
});

describe('слияние источников', () => {
  it('дедуплицирует по ссылке и сохраняет приоритет источника', () => {
    const merged = mergeNews([
      { source: 'interfax', items: [item({ id: '1', url: 'https://a/1', source: 'interfax' })] },
      { source: 'rbc', items: [item({ id: '2', url: 'https://a/1', source: 'rbc' })] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('interfax');
    expect(dedupeKey(merged[0])).toBe('https://a/1');
  });

  it('не прерывает сводку при отказе одного источника и пишет покрытие', async () => {
    const ok: NewsSourceAdapter = {
      id: 'ok',
      topics: ['news'],
      fetchNews: async () => [item({ url: 'https://ok/1', source: 'ok' })],
    };
    const broken: NewsSourceAdapter = {
      id: 'broken',
      topics: ['news'],
      fetchNews: async () => {
        throw new Error('HTTP 500');
      },
    };

    const digest = await new SourceRegistry([broken, ok]).newsDigest({ pages: 1, maxItems: 5 });

    expect(digest.items).toHaveLength(1);
    expect(digest.coverage).toEqual([
      { source: 'broken', status: 'missing', reason: 'HTTP 500' },
      { source: 'ok', status: 'ok', items: 1 },
    ]);
  });

  it('фильтрует источники по теме', () => {
    const news: NewsSourceAdapter = { id: 'n', topics: ['news'], fetchNews: async () => [] };
    const tax: NewsSourceAdapter = { id: 't', topics: ['tax'], fetchNews: async () => [] };
    const registry = new SourceRegistry([news, tax]);

    expect(registry.newsSourcesFor('news').map((source) => source.id)).toEqual(['n']);
    expect(registry.newsSourcesFor('tax').map((source) => source.id)).toEqual(['t']);
  });
});

describe('новости брокера', () => {
  it('превращает ответ инструмента в элементы с источником и курсором', () => {
    const { items, nextCursor } = mapNews(
      {
        items: [
          { id: '10', title: 'Заголовок', content: 'Текст новости', ts: '2026-11-04T10:00:00Z' },
        ],
        nextCursor: '9',
      },
      'tinkoff',
    );

    expect(items[0]).toMatchObject({ id: '10', title: 'Заголовок', source: 'tinkoff' });
    expect(nextCursor).toBe('9');
  });
});

describe('сводка новостей по периодам', () => {
  it('раскладывает новости по четырём периодам', async () => {
    const now = new Date('2026-11-04T12:00:00Z');
    const source: NewsSourceAdapter = {
      id: 'interfax',
      topics: ['news'],
      fetchNews: async () => [
        item({ title: 'сегодня', publishedAt: '2026-11-04T09:00:00Z', url: 'https://n/1' }),
        item({ title: 'месяц назад', publishedAt: '2026-10-10T09:00:00Z', url: 'https://n/2' }),
      ],
    };

    const result = await collectNewsDigest(new SourceRegistry([source]), {
      pages: 1,
      maxItems: 5,
      now,
    });

    expect(result.periods.map((period) => period.id)).toEqual([
      'fresh',
      'week',
      'month',
      'half_year',
    ]);
    expect(result.periods[0].items.map((entry) => entry.title)).toEqual(['сегодня']);
    expect(result.periods[2].items.map((entry) => entry.title)).toEqual([
      'сегодня',
      'месяц назад',
    ]);
    expect(formatNewsDigest(result)).toContain('Новости свежие:');
  });
});
